const crypto = require('crypto');
const Job = require('../models/Job');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const PlatformSettings = require('../models/PlatformSettings');
const { createNotification } = require('./notificationController');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const newOtp = () => String(crypto.randomInt(100000, 1000000)); // 6 digits

const isEnabled = async () => {
  const s = await PlatformSettings.getSettings();
  return s.paymentOtpEnabled !== false;
};

// ── Posting rule ───────────────────────────────────────────────────────────
// A poster is blocked from creating a new job while ANY of their completed
// jobs still has an unconfirmed payment. Blocked only if the feature is ON and
// the admin has not granted this user an override.
const PENDING_POST_LIMIT = 4;
const getPostingBlock = async (user) => {
  if (!(await isEnabled())) return { blocked: false, pending: 0 };
  if (user.postingOverride) return { blocked: false, pending: 0, overridden: true };
  const jobs = await Job.find({
    postedBy: user._id,
    applicants: { $elemMatch: { paymentStatus: 'pending' } },
  }).select('title createdAt applicants.worker applicants.paymentStatus');
  let pending = 0;
  for (const j of jobs) pending += j.applicants.filter(a => a.paymentStatus === 'pending').length;
  if (pending === 0) return { blocked: false, pending: 0 };
  // While a code is still not entered, the poster may keep posting, up to
  // PENDING_POST_LIMIT new jobs since the oldest unconfirmed job was posted.
  const oldest = jobs.reduce((m, j) => (!m || j.createdAt < m ? j.createdAt : m), null);
  const postsSince = await Job.countDocuments({
    postedBy: user._id, createdAt: { $gt: oldest }, _id: { $nin: jobs.map(j => j._id) },
  });
  return {
    blocked: postsSince >= PENDING_POST_LIMIT, pending,
    postsLeft: Math.max(0, PENDING_POST_LIMIT - postsSince), limit: PENDING_POST_LIMIT,
    jobTitles: jobs.map(j => j.title).slice(0, 3),
  };
};

// Called from completeWork. Returns the fields to set on the applicant.
const startPaymentOnComplete = async () => {
  if (!(await isEnabled())) return { enabled: false };
  return { enabled: true, otp: newOtp() };
};

const recordWalletEntries = async (job, workerId, posterId, note = '') => {
  try {
    // A team leader is paid for the whole team: wage x crewSize.
    const mine = (job.applicants || []).find(a => String((a.worker && a.worker._id) || a.worker) === String(workerId));
    const wage = (Number(job.wage) || 0) * Math.max(1, Number(mine && mine.crewSize) || 1);
    if (wage > 0) {
      await Transaction.create({ user: workerId, type: 'credit', amount: wage, job: job._id, counterparty: posterId, note: `Earned for "${job.title}"${note}` });
      await Transaction.create({ user: posterId, type: 'debit', amount: wage, job: job._id, counterparty: workerId, note: `Paid for "${job.title}"${note}` });
    }
  } catch (e) {
    console.error('Wallet record error:', e.message);
  }
};

// Atomically flip pending -> confirmed and close contact. Returns true if THIS
// call did the flip (so wallet rows / notifications happen exactly once).
const closePayment = async (jobId, workerId, byAdmin) => {
  const res = await Job.findOneAndUpdate(
    { _id: jobId, applicants: { $elemMatch: { worker: workerId, paymentStatus: 'pending' } } },
    {
      $set: {
        'applicants.$.paymentStatus': 'confirmed',
        'applicants.$.paymentConfirmedAt': new Date(),
        'applicants.$.paymentResolvedByAdmin': !!byAdmin,
        'applicants.$.chatUnlocked': false,
        'applicants.$.contactClosed': true,
      },
      $unset: { 'applicants.$.paymentOtp': '' },
    },
    { new: true }
  );
  return res;
};

// GET /api/jobs/:id/payment-otp  (worker) — the worker reads the code and tells
// the poster in person / by chat. The poster's API never returns it.
const getMyPaymentOtp = async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.id,
      applicants: { $elemMatch: { worker: req.user._id, paymentStatus: 'pending' } },
    }).select('+applicants.paymentOtp');
    if (!job) return res.status(404).json({ success: false, message: 'No payment waiting for this job' });
    const mine = job.applicants.find(a => a.worker.toString() === req.user._id.toString());
    res.status(200).json({ success: true, otp: mine.paymentOtp, title: job.title, wage: job.wage, crewSize: mine.crewSize || 1 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/jobs/:id/applicants/:workerId/confirm-payment  (poster) { otp }
const confirmPayment = async (req, res) => {
  try {
    const { id, workerId } = req.params;
    const entered = String(req.body.otp || '').trim();
    if (!/^\d{6}$/.test(entered)) {
      return res.status(400).json({ success: false, message: 'Enter the 6-digit code from the worker.' });
    }

    const job = await Job.findById(id).select('+applicants.paymentOtp');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const app = job.applicants.find(a => a.worker.toString() === workerId);
    if (!app || app.paymentStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'No payment is waiting for this worker.' });
    }
    if (app.paymentLockedUntil && app.paymentLockedUntil > new Date()) {
      const mins = Math.ceil((app.paymentLockedUntil - Date.now()) / 60000);
      return res.status(429).json({ success: false, code: 'LOCKED', message: `Too many wrong codes. Try again in ${mins} min, or contact support.` });
    }

    const a = Buffer.from(entered);
    const b = Buffer.from(String(app.paymentOtp || ''));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!ok) {
      // Atomic counter so parallel guesses can't dodge the limit.
      const upd = await Job.findOneAndUpdate(
        { _id: id, 'applicants.worker': workerId },
        { $inc: { 'applicants.$.paymentOtpAttempts': 1 } },
        { new: true }
      );
      const attempts = upd.applicants.find(x => x.worker.toString() === workerId).paymentOtpAttempts;
      if (attempts >= MAX_ATTEMPTS) {
        await Job.updateOne(
          { _id: id, 'applicants.worker': workerId },
          { $set: { 'applicants.$.paymentLockedUntil': new Date(Date.now() + LOCK_MINUTES * 60000), 'applicants.$.paymentOtpAttempts': 0 } }
        );
        return res.status(429).json({ success: false, code: 'LOCKED', message: `Too many wrong codes. Locked for ${LOCK_MINUTES} minutes.` });
      }
      return res.status(400).json({ success: false, message: `Wrong code. ${MAX_ATTEMPTS - attempts} tries left.` });
    }

    const closed = await closePayment(id, workerId, false);
    if (!closed) {
      return res.status(409).json({ success: false, message: 'This payment was already confirmed.' });
    }

    await recordWalletEntries(job, workerId, req.user._id);
    await createNotification({
      recipient: workerId,
      type: 'payment_confirmed',
      title: 'Payment confirmed ✅',
      body: `${req.user.name} confirmed payment for "${job.title}". Chat and call with this poster are now closed.`,
      link: '/wallet',
      meta: { actorName: req.user.name, jobTitle: job.title, amount: (Number(job.wage) || 0) * Math.max(1, Number((job.applicants.find(x => String((x.worker && x.worker._id) || x.worker) === String(workerId)) || {}).crewSize) || 1) },
    }).catch(() => {});

    res.status(200).json({ success: true, message: 'Payment confirmed. This job is closed.', contactClosed: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/jobs/my/ongoing  (poster OR worker) — feeds the dashboard card.
const getOngoing = async (req, res) => {
  try {
    const me = req.user._id.toString();
    const isWorker = req.user.role === 'worker';
    const items = [];

    if (isWorker) {
      const jobs = await Job.find({ applicants: { $elemMatch: { worker: req.user._id, status: 'accepted' } } })
        .populate('postedBy', 'name phone profilePhoto').sort({ updatedAt: -1 });
      for (const j of jobs) {
        const a = j.applicants.find(x => x.worker.toString() === me);
        if (!a || a.status !== 'accepted') continue;
        if (a.contactClosed || (a.workStatus === 'completed' && a.paymentStatus !== 'pending')) continue;
        const other = j.postedBy && j.postedBy.toObject ? j.postedBy.toObject() : j.postedBy;
        items.push({
          jobId: j._id, title: j.title, skill: j.skill, wage: j.wage, location: j.location,
          workStatus: a.workStatus, paymentStatus: a.paymentStatus, crewSize: a.crewSize || 1,
          other: other && { _id: other._id, name: other.name, profilePhoto: other.profilePhoto, phone: a.chatUnlocked ? other.phone : undefined },
          canChat: !!a.chatUnlocked,
        });
      }
    } else {
      const jobs = await Job.find({ postedBy: req.user._id, 'applicants.status': 'accepted' })
        .populate('applicants.worker', 'name phone profilePhoto').sort({ updatedAt: -1 });
      for (const j of jobs) {
        for (const a of j.applicants) {
          if (a.status !== 'accepted') continue;
          if (a.contactClosed || (a.workStatus === 'completed' && a.paymentStatus !== 'pending')) continue;
          const w = a.worker;
          items.push({
            jobId: j._id, title: j.title, skill: j.skill, wage: j.wage, location: j.location,
            workStatus: a.workStatus, paymentStatus: a.paymentStatus, crewSize: a.crewSize || 1,
            other: w && { _id: w._id, name: w.name, profilePhoto: w.profilePhoto, phone: a.chatUnlocked ? w.phone : undefined },
            canChat: !!a.chatUnlocked,
          });
        }
      }
    }

    const postingBlock = isWorker ? { blocked: false, pending: 0 } : await getPostingBlock(req.user);
    res.status(200).json({ success: true, items, postingBlocked: postingBlock.blocked, pendingPayments: postingBlock.pending || 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/jobs/my/posting-status  (poster) — lightweight check for Post Job screen
const getPostingStatus = async (req, res) => {
  try {
    const b = await getPostingBlock(req.user);
    res.status(200).json({ success: true, blocked: b.blocked, pending: b.pending || 0, postsLeft: b.postsLeft, limit: b.limit, jobTitles: b.jobTitles || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Admin ──────────────────────────────────────────────────────────────────

// GET /api/admin/payments  — every unconfirmed payment, oldest first
const adminListPending = async (req, res) => {
  try {
    const jobs = await Job.find({ applicants: { $elemMatch: { paymentStatus: 'pending' } } })
      .populate('postedBy', 'name phone postingOverride')
      .populate('applicants.worker', 'name phone')
      .sort({ updatedAt: 1 });
    const rows = [];
    for (const j of jobs) {
      for (const a of j.applicants) {
        if (a.paymentStatus !== 'pending') continue;
        rows.push({
          jobId: j._id, title: j.title, wage: j.wage,
          poster: j.postedBy, worker: a.worker,
          completedAt: a.workCompletedAt, locked: !!(a.paymentLockedUntil && a.paymentLockedUntil > new Date()),
        });
      }
    }
    res.status(200).json({ success: true, payments: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/admin/payments/:jobId/:workerId/resolve — admin confirms on behalf
const adminResolvePayment = async (req, res) => {
  try {
    const { jobId, workerId } = req.params;
    const closed = await closePayment(jobId, workerId, true);
    if (!closed) return res.status(400).json({ success: false, message: 'No pending payment for this worker.' });
    await recordWalletEntries(closed, workerId, closed.postedBy, ' (admin confirmed)');
    await createNotification({
      recipient: workerId, type: 'payment_confirmed', title: 'Payment confirmed by support ✅',
      body: `Support confirmed payment for "${closed.title}".`, link: '/wallet', meta: { jobTitle: closed.title },
    }).catch(() => {});
    await createNotification({
      recipient: closed.postedBy, type: 'payment_confirmed', title: 'Payment marked as done',
      body: `Support marked the payment for "${closed.title}" as done. You can post jobs again.`, link: '/dashboard', meta: { jobTitle: closed.title },
    }).catch(() => {});
    res.status(200).json({ success: true, message: 'Payment resolved. Contact closed.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/admin/users/:id/posting-override { allow: true|false }
const adminSetPostingOverride = async (req, res) => {
  try {
    const allow = !!req.body.allow;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { postingOverride: allow, postingOverrideBy: req.user._id, postingOverrideAt: new Date() },
      { new: true }
    ).select('name phone postingOverride');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (allow) {
      await createNotification({
        recipient: user._id, type: 'posting_allowed', title: 'You can post jobs again',
        body: 'Support has allowed you to post new jobs.', link: '/jobs/post', meta: {},
      }).catch(() => {});
    }
    res.status(200).json({ success: true, message: allow ? 'User can post jobs again' : 'Override removed', user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/admin/settings/payment-otp { enabled }
const adminTogglePaymentOtp = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    settings.paymentOtpEnabled = !!req.body.enabled;
    await settings.save();
    res.status(200).json({ success: true, message: settings.paymentOtpEnabled ? 'Payment OTP is ON' : 'Payment OTP is OFF', settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getPostingBlock, startPaymentOnComplete, recordWalletEntries,
  getMyPaymentOtp, confirmPayment, getOngoing, getPostingStatus,
  adminListPending, adminResolvePayment, adminSetPostingOverride, adminTogglePaymentOtp,
};