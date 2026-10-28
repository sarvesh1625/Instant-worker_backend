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