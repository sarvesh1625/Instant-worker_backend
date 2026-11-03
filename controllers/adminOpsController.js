const mongoose = require('mongoose');
const User = require('../models/User');
const Job = require('../models/Job');
const Report = require('../models/Report');
const DeletionRequest = require('../models/DeletionRequest');
const AuthEvent = require('../models/AuthEvent');
const UserStats = require('../models/UserStats');
const AdminAction = require('../models/AdminAction');
const TrainingVideo = require('../models/TrainingVideo');
const TrainingProgress = require('../models/TrainingProgress');
const { adminResolvePayment } = require('./paymentController');

const DAY = 24 * 60 * 60 * 1000;
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = (res, e) => res.status(500).json({ success: false, message: e.message });
const isId = (v) => mongoose.Types.ObjectId.isValid(v);

const log = (req, action, o = {}) => AdminAction.create({
  admin: req.user._id, action,
  targetType: o.targetType || '', targetId: String(o.targetId || ''),
  summary: o.summary || '', reason: o.reason || '', meta: o.meta || {},
}).catch(() => {});

// Middleware: records every time an admin opens a private chat. Mount on /api/admin BEFORE adminRoutes.
const logChatAccess = (req, res, next) => {
  const m = req.method === 'GET' && (/^\/chat\/[^/]+/.test(req.path) ? 'chat' : /^\/users\/[^/]+\/conversations/.test(req.path) ? 'convos' : null);
  if (!m) return next();
  res.on('finish', () => {
    if (res.statusCode !== 200 || !req.user) return;
    const parts = req.path.split('/');
    log(req, m === 'chat' ? 'chat_read' : 'chat_list', {
      targetType: m === 'chat' ? 'chat' : 'user',
      targetId: m === 'chat' ? parts[2] : parts[2],
      summary: m === 'chat' ? 'Admin opened a conversation' : 'Admin opened a user\'s conversation list',
    });
  });
  next();
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
const overview = async (req, res) => {
  try {
    const now = Date.now();
    const since = (d) => new Date(now - d * DAY);
    const onlineQ = { role: 'worker', accountStatus: 'active', 'worker.availability': true, 'worker.location.coordinates.0': { $exists: true } };

    const [
      totalWorkers, totalPosters, onlineNow, newToday, new7,
      payments24, paymentsAll, deletionsPending, verifPending, reportsOpen,
      jobsOpen, jobsProgress, jobsStale, jobsToday,
      loginsToday, failedToday, forgotToday, registeredToday,
      onlineByCity, onlineBySkill, signups,
    ] = await Promise.all([
      User.countDocuments({ role: 'worker' }),
      User.countDocuments({ role: 'user' }),
      User.countDocuments(onlineQ),
      User.countDocuments({ role: { $ne: 'admin' }, createdAt: { $gte: since(1) } }),
      User.countDocuments({ role: { $ne: 'admin' }, createdAt: { $gte: since(7) } }),
      Job.countDocuments({ applicants: { $elemMatch: { paymentStatus: 'pending', workCompletedAt: { $lte: since(1) } } } }),
      Job.countDocuments({ applicants: { $elemMatch: { paymentStatus: 'pending' } } }),
      DeletionRequest.countDocuments({ status: 'pending' }),
      User.countDocuments({ 'idVerification.status': 'pending' }),
      Report.countDocuments({ status: { $in: ['pending', 'open'] } }),
      Job.countDocuments({ status: 'open' }),
      Job.countDocuments({ status: 'in_progress' }),
      Job.countDocuments({ status: 'open', createdAt: { $lte: since(2) }, applicants: { $size: 0 } }),
      Job.countDocuments({ createdAt: { $gte: since(1) } }),
      AuthEvent.countDocuments({ type: 'login', success: true, createdAt: { $gte: since(1) } }),
      AuthEvent.countDocuments({ type: 'login', success: false, createdAt: { $gte: since(1) } }),
      AuthEvent.countDocuments({ type: 'forgot_password', createdAt: { $gte: since(1) } }),
      AuthEvent.countDocuments({ type: 'register', success: true, createdAt: { $gte: since(1) } }),
      User.aggregate([{ $match: onlineQ }, { $group: { _id: { $ifNull: ['$city', ''] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
      User.aggregate([{ $match: onlineQ }, { $unwind: '$worker.skills' }, { $group: { _id: '$worker.skills', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
      User.aggregate([
        { $match: { role: { $ne: 'admin' }, createdAt: { $gte: since(14) } } },
        { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, r: '$role' }, n: { $sum: 1 } } },
      ]),
    ]);

    const byDay = {};
    signups.forEach(s => { const k = s._id.d; byDay[k] = byDay[k] || { date: k, worker: 0, user: 0 }; byDay[k][s._id.r] = s.n; });
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const k = new Date(now - i * DAY + 5.5 * 3600000).toISOString().slice(0, 10);
      series.push(byDay[k] || { date: k, worker: 0, user: 0 });
    }

    // Training completion (only for videos that are active)
    let training = [];
    try {
      const vids = await TrainingVideo.find({ active: true }).select('title audience');
      training = await Promise.all(vids.map(async v => {
        const total = await User.countDocuments({ role: v.audience });
        const done = await TrainingProgress.countDocuments({ video: v._id });
        return { id: v._id, title: v.title, audience: v.audience, total, done };
      }));
    } catch {}

    res.json({
      success: true,
      attention: { payments24, paymentsAll, deletionsPending, verifPending, reportsOpen, jobsStale },
      users: { totalWorkers, totalPosters, onlineNow, newToday, new7 },
      jobs: { open: jobsOpen, inProgress: jobsProgress, postedToday: jobsToday, stale: jobsStale },
      auth: { loginsToday, failedToday, forgotToday, registeredToday },
      onlineByCity: onlineByCity.map(x => ({ city: x._id || 'Unknown', n: x.n })),
      onlineBySkill: onlineBySkill.map(x => ({ skill: x._id, n: x.n })),
      signups: series,
      training,
    });
  } catch (e) { fail(res, e); }
};

// ── Workers list (local areas / who is available) ─────────────────────────────
const listWorkers = async (req, res) => {
  try {
    const { city, area, skill, online, q, page = 1, limit = 30 } = req.query;
    const query = { role: 'worker' };
    if (city) query.city = new RegExp('^' + esc(city) + '$', 'i');
    if (area) query.area = new RegExp(esc(area), 'i');
    if (skill) query['worker.skills'] = new RegExp('^' + esc(skill) + '$', 'i');
    if (online === 'true') {
      query['worker.availability'] = true; query.accountStatus = 'active';
      query['worker.location.coordinates.0'] = { $exists: true };
    }
    if (q) { const r = new RegExp(esc(q), 'i'); query.$or = [{ name: r }, { phone: r }]; }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, workers, areas] = await Promise.all([
      User.countDocuments(query),
      User.find(query).select('name phone city area state worker.skills worker.skill worker.availability worker.locationUpdatedAt worker.rating worker.totalJobsDone createdAt accountStatus isVerified')
        .sort({ 'worker.locationUpdatedAt': -1, createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      User.aggregate([
        { $match: { role: 'worker', 'worker.availability': true, accountStatus: 'active', 'worker.location.coordinates.0': { $exists: true } } },
        { $group: { _id: { city: '$city', area: '$area' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 40 },
      ]),
    ]);
    res.json({ success: true, total, pages: Math.ceil(total / limit), workers, onlineAreas: areas.map(a => ({ city: a._id.city || '', area: a._id.area || '', n: a.n })) });
  } catch (e) { fail(res, e); }
};

// ── Job detail ────────────────────────────────────────────────────────────────
const jobDetail = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Bad id' });
    const job = await Job.findById(req.params.id)
      .populate('postedBy', 'name phone accountStatus postingOverride')
      .populate('applicants.worker', 'name phone accountStatus')
      .lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    const ids = [job._id];
    const [reports, actions] = await Promise.all([
      Report.find({ job: job._id }).populate('reportedBy reportedUser', 'name phone').lean().catch(() => []),
      AdminAction.find({ targetType: 'job', targetId: String(job._id) }).sort({ createdAt: -1 }).limit(30).populate('admin', 'name').lean(),
    ]);
    // Timeline built from stored timestamps
    const tl = [{ at: job.createdAt, text: `Job posted by ${job.postedBy ? job.postedBy.name : 'unknown'}` }];
    (job.applicants || []).forEach(a => {
      const n = a.worker ? a.worker.name : 'Worker';
      if (a.appliedAt) tl.push({ at: a.appliedAt, text: `${n} applied${a.autoAccepted ? ' (auto-accepted)' : ''}` });
      if (a.workStartedAt) tl.push({ at: a.workStartedAt, text: `${n} started work` });
      if (a.workCompletedAt) tl.push({ at: a.workCompletedAt, text: `${n} marked work complete` });
      if (a.paymentConfirmedAt) tl.push({ at: a.paymentConfirmedAt, text: `Payment confirmed for ${n}${a.paymentResolvedByAdmin ? ' (by admin)' : ''}` });
    });
    actions.forEach(a => tl.push({ at: a.createdAt, text: `Admin ${a.admin ? a.admin.name : ''}: ${a.summary}${a.reason ? ' — ' + a.reason : ''}` }));
    tl.sort((x, y) => new Date(x.at) - new Date(y.at));
    res.json({ success: true, job, reports, timeline: tl });
  } catch (e) { fail(res, e); }
};

const closeJob = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ success: false, message: 'Write a reason (at least 5 characters).' });
    const job = await Job.findByIdAndUpdate(req.params.id, { status: 'closed' }, { new: true }).select('title status');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    await log(req, 'job_close', { targetType: 'job', targetId: job._id, summary: `Closed job "${job.title}"`, reason });
    res.json({ success: true, message: 'Job closed', job });
  } catch (e) { fail(res, e); }
};

// Confirm a payment on behalf of the poster. Reason is REQUIRED, then the normal resolver does the work.
const confirmPayment = async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ success: false, message: 'Write why you are confirming this payment (at least 5 characters).' });
  const { jobId, workerId } = req.params;
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200 && body && body.success) {
      log(req, 'payment_confirm', { targetType: 'job', targetId: jobId, summary: 'Confirmed payment on behalf of poster', reason, meta: { workerId } });
    }
    return origJson(body);
  };
  return adminResolvePayment(req, res);
};

// ── Audit log ─────────────────────────────────────────────────────────────────
const listActions = async (req, res) => {
  try {
    const { action, page = 1, limit = 40 } = req.query;
    const q = action ? { action } : {};
    const [total, actions] = await Promise.all([
      AdminAction.countDocuments(q),
      AdminAction.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).populate('admin', 'name phone').lean(),
    ]);
    res.json({ success: true, total, pages: Math.ceil(total / limit), actions });
  } catch (e) { fail(res, e); }
};

// ── Deletion requests ─────────────────────────────────────────────────────────
const listDeletions = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const list = await DeletionRequest.find(status === 'all' ? {} : { status })
      .sort({ requestedAt: -1 }).limit(200).populate('user', 'name phone role city createdAt').lean();
    // warn if the person still has unfinished work
    for (const d of list) {
      if (!d.user) continue;
      d.openJobs = await Job.countDocuments({
        $or: [
          { postedBy: d.user._id, status: { $in: ['open', 'in_progress'] } },
          { applicants: { $elemMatch: { worker: d.user._id, status: 'accepted', $or: [{ workStatus: { $ne: 'completed' } }, { paymentStatus: 'pending' }] } } },
        ],
      });
    }
    res.json({ success: true, requests: list });
  } catch (e) { fail(res, e); }
};

const reviewDeletion = async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Choose approved or rejected' });
    const d = await DeletionRequest.findByIdAndUpdate(req.params.id,
      { status, adminNote: String(note || ''), reviewedAt: new Date(), reviewedBy: req.user._id }, { new: true });
    if (!d) return res.status(404).json({ success: false, message: 'Request not found' });
    await log(req, 'deletion_' + status, { targetType: 'user', targetId: d.user, summary: `Deletion request ${status}`, reason: note });
    res.json({ success: true, request: d });
  } catch (e) { fail(res, e); }
};

// ── Support tools ─────────────────────────────────────────────────────────────
const lookup = async (req, res) => {
  try {
    const digits = String(req.query.phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length < 6) return res.status(400).json({ success: false, message: 'Type at least 6 digits of the phone number' });
    const user = await User.findOne({ phone: new RegExp(digits + '$') })
      .select('name phone role city area accountStatus loginAttempts lockUntil createdAt isVerified postingOverride idVerification.status worker.availability worker.skills').lean();
    if (!user) return res.status(404).json({ success: false, message: 'No user with this number' });
    const [stats, events, jobsPosted, jobsApplied, pendingPay] = await Promise.all([
      UserStats.findOne({ user: user._id }).lean(),
      AuthEvent.find({ $or: [{ user: user._id }, { phone: digits }] }).sort({ createdAt: -1 }).limit(15).lean(),
      Job.countDocuments({ postedBy: user._id }),
      Job.countDocuments({ 'applicants.worker': user._id }),
      Job.countDocuments({ $or: [{ postedBy: user._id }, { 'applicants.worker': user._id }], applicants: { $elemMatch: { paymentStatus: 'pending' } } }),
    ]);
    res.json({ success: true, user, stats: stats || {}, events, jobsPosted, jobsApplied, pendingPay, locked: !!(user.lockUntil && user.lockUntil > new Date()) });
  } catch (e) { fail(res, e); }
};

const unlockAccount = async (req, res) => {
  try {
    if (!isId(req.params.userId)) return res.status(400).json({ success: false, message: 'Bad id' });
    const u = await User.findByIdAndUpdate(req.params.userId, { loginAttempts: 0, lockUntil: null }, { new: true }).select('name phone');
    if (!u) return res.status(404).json({ success: false, message: 'User not found' });
    await log(req, 'unlock_account', { targetType: 'user', targetId: u._id, summary: `Unlocked login for ${u.name} (${u.phone})`, reason: req.body.reason });
    res.json({ success: true, message: 'Login unlocked' });
  } catch (e) { fail(res, e); }
};

// Clears "too many wrong codes" locks (start code + payment code) on this person's jobs.
const clearCodeLocks = async (req, res) => {
  try {
    if (!isId(req.params.userId)) return res.status(400).json({ success: false, message: 'Bad id' });
    const uid = new mongoose.Types.ObjectId(req.params.userId);
    const r = await Job.updateMany(
      { $or: [{ 'applicants.worker': uid }, { postedBy: uid }] },
      { $set: { 'applicants.$[a].startOtpAttempts': 0, 'applicants.$[a].paymentOtpAttempts': 0 },
        $unset: { 'applicants.$[a].startLockedUntil': '', 'applicants.$[a].paymentLockedUntil': '' } },
      { arrayFilters: [{ $or: [{ 'a.startLockedUntil': { $exists: true } }, { 'a.paymentLockedUntil': { $exists: true } }, { 'a.startOtpAttempts': { $gt: 0 } }, { 'a.paymentOtpAttempts': { $gt: 0 } }] }] }
    );
    await log(req, 'clear_code_locks', { targetType: 'user', targetId: uid, summary: 'Cleared start/payment code locks', reason: req.body.reason });
    res.json({ success: true, message: 'Code locks cleared', jobsTouched: r.modifiedCount || 0 });
  } catch (e) { fail(res, e); }
};

// ── Activity (logins, forgot-password, join dates) ────────────────────────────
const activity = async (req, res) => {
  try {
    const { type, success, days = 7, page = 1, limit = 50 } = req.query;
    const since = new Date(Date.now() - Number(days) * DAY);
    const q = { createdAt: { $gte: since } };
    if (type) q.type = type;
    if (success === 'true') q.success = true;
    if (success === 'false') q.success = false;
    const [total, events, summary, topForgot, recent] = await Promise.all([
      AuthEvent.countDocuments(q),
      AuthEvent.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).populate('user', 'name role').lean(),
      AuthEvent.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { t: '$type', s: '$success' }, n: { $sum: 1 } } }]),
      UserStats.find({ forgotPasswordCount: { $gt: 0 } }).sort({ forgotPasswordCount: -1 }).limit(10).populate('user', 'name phone role').lean(),
      User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 }).limit(15).select('name phone role city createdAt').lean(),
    ]);
    res.json({ success: true, total, pages: Math.ceil(total / limit), events, summary: summary.map(s => ({ type: s._id.t, success: s._id.s, n: s.n })), topForgot, recent });
  } catch (e) { fail(res, e); }
};

// ── Training progress ─────────────────────────────────────────────────────────
const trainingProgress = async (req, res) => {
  try {
    const videos = await TrainingVideo.find({ active: true }).sort({ audience: 1, order: 1 }).lean();
    const out = [];
    for (const v of videos) {
      const done = await TrainingProgress.find({ video: v._id }).distinct('user');
      const total = await User.countDocuments({ role: v.audience });
      const pending = await User.find({ role: v.audience, _id: { $nin: done } }).sort({ createdAt: -1 }).limit(100).select('name phone city createdAt').lean();
      out.push({ id: v._id, title: v.title, audience: v.audience, total, done: done.length, requireExisting: v.requireExisting, pending });
    }
    res.json({ success: true, videos: out });
  } catch (e) { fail(res, e); }
};

module.exports = {
  logChatAccess, overview, listWorkers, jobDetail, closeJob, confirmPayment,
  listActions, listDeletions, reviewDeletion, lookup, unlockAccount, clearCodeLocks, activity, trainingProgress,
};