const crypto = require('crypto');
const Job = require('../models/Job');

// "Start code": before work begins the WORKER opens a 4-digit code in the app and tells it to the
// poster; the poster types it in to start the work. Proves the two met. Mirrors the payment code
// used when work is completed. The poster's API never returns the code (select:false).
//
// ON by default. Set the environment variable START_CODE=off to turn it off.

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const startCodeRequired = () => String(process.env.START_CODE || 'on').toLowerCase() !== 'off';
const newCode = () => String(crypto.randomInt(1000, 10000)); // 4 digits

// GET /api/jobs/:id/start-code  (worker) — creates the code on first call, then returns the same one.
const getMyStartCode = async (req, res) => {
  try {
    if (!startCodeRequired()) return res.status(404).json({ success: false, message: 'A start code is not needed right now.' });
    const jobId = req.params.id, me = req.user._id;
    const waiting = { applicants: { $elemMatch: { worker: me, status: 'accepted', workStatus: 'not_started', contactClosed: { $ne: true } } } };

    const exists = await Job.findOne({ _id: jobId, ...waiting }).select('_id');
    if (!exists) return res.status(404).json({ success: false, message: 'No work is waiting to start for this job.' });

    // Only fills it if empty, so two quick taps cannot create two different codes.
    await Job.updateOne(
      { _id: jobId, applicants: { $elemMatch: { worker: me, startOtp: { $in: [null] } } } },
      { $set: { 'applicants.$.startOtp': newCode() } }
    );
    const job = await Job.findOne({ _id: jobId, ...waiting }).select('+applicants.startOtp title');
    const mine = job && job.applicants.find(a => a.worker.toString() === me.toString());
    if (!mine || !mine.startOtp) return res.status(500).json({ success: false, message: 'Could not load your code' });
    res.status(200).json({ success: true, otp: mine.startOtp, title: job.title });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Used by startWork. Returns { ok:true } or { ok:false, status, code, message }.
const checkStartCode = async (jobId, workerId, enteredRaw) => {
  const entered = String(enteredRaw || '').trim();
  if (!/^\d{4}$/.test(entered)) {
    return { ok: false, status: 400, code: 'START_CODE_REQUIRED', message: 'Ask the worker for their 4-digit start code.' };
  }
  const job = await Job.findById(jobId).select('+applicants.startOtp');
  const app = job && job.applicants.find(a => a.worker.toString() === String(workerId));
  if (!app) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Worker not found' };

  if (app.startLockedUntil && app.startLockedUntil > new Date()) {
    const mins = Math.ceil((app.startLockedUntil - Date.now()) / 60000);
    return { ok: false, status: 429, code: 'LOCKED', message: `Too many wrong codes. Try again in ${mins} min.` };
  }
  if (!app.startOtp) {
    return { ok: false, status: 400, code: 'START_CODE_NOT_READY', message: 'The worker has not opened their start code yet. Ask them to tap "Show start code".' };
  }

  const a = Buffer.from(entered), b = Buffer.from(String(app.startOtp));
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true };

  const upd = await Job.findOneAndUpdate(
    { _id: jobId, 'applicants.worker': workerId },
    { $inc: { 'applicants.$.startOtpAttempts': 1 } },
    { new: true }
  );
  const attempts = upd.applicants.find(x => x.worker.toString() === String(workerId)).startOtpAttempts;
  if (attempts >= MAX_ATTEMPTS) {
    await Job.updateOne(
      { _id: jobId, 'applicants.worker': workerId },
      { $set: { 'applicants.$.startLockedUntil': new Date(Date.now() + LOCK_MINUTES * 60000), 'applicants.$.startOtpAttempts': 0 } }
    );
    return { ok: false, status: 429, code: 'LOCKED', message: `Too many wrong codes. Locked for ${LOCK_MINUTES} minutes.` };
  }
  return { ok: false, status: 400, code: 'WRONG_CODE', message: `Wrong code. ${MAX_ATTEMPTS - attempts} tries left.` };
};

const clearStartCode = (jobId, workerId) => Job.updateOne(
  { _id: jobId, 'applicants.worker': workerId },
  { $unset: { 'applicants.$.startOtp': '' }, $set: { 'applicants.$.startOtpAttempts': 0 } }
);

module.exports = { startCodeRequired, getMyStartCode, checkStartCode, clearStartCode };