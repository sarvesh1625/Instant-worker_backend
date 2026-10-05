const Job = require('../models/Job');
const User = require('../models/User');
const PlatformSettings = require('../models/PlatformSettings');
const UserSubscription = require('../models/UserSubscription');
const { createNotification } = require('../controllers/notificationController');

// ─────────────────────────────────────────────────────────────────────────────
// Job → nearby-worker notification flow
//
//   Stage 1: workers within  6 km  — right away
//   Stage 2: workers within 15 km  — 10 minutes after the job was posted
//   Stage 3: workers within 25 km  — 15 minutes after the job was posted
//   Nobody beyond 25 km is ever notified.
//
// Who is notified: role worker, active account, SAME skill as the job, and
// worker.availability === true (switched "Online"). A worker with no stored
// location can't be placed in a radius, so they get nothing until they tap
// Go Online in the app (that call stores their GPS point).
//
// Two audiences, only when the admin has turned subscriptions ON:
//   premium  = workers with an active subscription → the times above
//   standard = everyone else → the SAME stages, each delayed by
//              PlatformSettings.earlyAccessMinutes (set it to 5 in Admin)
// When subscriptions are OFF, everybody follows the premium times.
//
// The flow stops by itself: it only ever processes jobs with status 'open',
// and your existing accept logic sets status 'closed' once all slots are full.
//
// Stage timing is derived from job.createdAt, and progress is stored on the
// job (notifyProgress), so a server restart loses nothing. Each stage is
// claimed with one atomic update, so two runs can never send the same stage.
//
// TESTING: set NOTIFY_TIME_SCALE=0.1 in your env and every wait becomes 10%
// as long (10 min → 1 min, 15 → 1.5, 5 → 0.5).
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = [
  { radiusKm: 6,  afterMin: 0 },
  { radiusKm: 15, afterMin: 10 },
  { radiusKm: 25, afterMin: 15 },
];

const SCALE = Number(process.env.NOTIFY_TIME_SCALE) > 0 ? Number(process.env.NOTIFY_TIME_SCALE) : 1;
const EARTH_RADIUS_KM = 6378.1;
const SCHEDULER_INTERVAL_MS = 30 * 1000;

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pure helper — when is a stage due for an audience? (exported for testing)
const stageDueAt = (createdAt, stageIndex, audience, delayMin) => {
  const extra = audience === 'standard' ? delayMin : 0;
  return new Date(createdAt).getTime() + (STAGES[stageIndex].afterMin + extra) * SCALE * 60 * 1000;
};

const getAudienceConfig = async () => {
  const settings = await PlatformSettings.getSettings();
  const enabled = !!settings.subscriptionsEnabled;
  const delayMin = enabled ? Math.max(0, Number(settings.earlyAccessMinutes) || 0) : 0;
  return { enabled, delayMin, audiences: enabled ? ['premium', 'standard'] : ['premium'] };
};

const findEligibleWorkers = async (job, stageIndex) => {
  const base = {
    role: 'worker',
    accountStatus: 'active',
    'worker.skill': job.skill,
    'worker.availability': true,
  };

  const coords = job.location?.point?.coordinates;
  if (Array.isArray(coords) && coords.length === 2) {
    const [lng, lat] = coords;
    return User.find({
      ...base,
      'worker.location': {
        $geoWithin: { $centerSphere: [[lng, lat], STAGES[stageIndex].radiusKm / EARTH_RADIUS_KM] },
      },
    }).select('_id');
  }

  // The job has no coordinates at all (unknown city, no GPS) — no radius is
  // possible, so fall back to matching on city name once, at stage 1 only.
  if (stageIndex !== 0 || !job.location?.city) return [];
  return User.find({
    ...base,
    city: new RegExp(`^${escapeRegex(job.location.city.trim())}$`, 'i'),
  }).select('_id');
};

// Keeps only the workers that belong to this audience.
const filterByAudience = async (workers, audience, enabled) => {
  if (!enabled) return audience === 'premium' ? workers : [];
  if (workers.length === 0) return [];
  const subs = await UserSubscription.find({
    user: { $in: workers.map(w => w._id) },
    status: 'active',
  }).select('user');
  const subscribed = new Set(subs.map(s => s.user.toString()));
  return workers.filter(w => (audience === 'premium') === subscribed.has(w._id.toString()));
};

const sendStage = async (job, audience, stageIndex, enabled) => {
  const candidates = await findEligibleWorkers(job, stageIndex);

  // Never notify the same worker twice for one job, across stages/audiences.
  // (urgentNotifiedWorkers is the existing field — it now tracks every job type.)
  const already = new Set((job.urgentNotifiedWorkers || []).map(id => id.toString()));
  const fresh = candidates.filter(w => !already.has(w._id.toString()));

  const targets = await filterByAudience(fresh, audience, enabled);
  if (targets.length === 0) return;

  // Record first, then send — a retry can never double-send.
  await Job.updateOne(
    { _id: job._id },
    { $addToSet: { urgentNotifiedWorkers: { $each: targets.map(w => w._id) } } }
  );

  const isUrgent = job.jobType === 'urgent';
  const results = await Promise.allSettled(targets.map(w =>
    createNotification({
      recipient: w._id,
      type: isUrgent ? 'urgent_job' : 'job_applied',
      title: isUrgent ? '🔴 Urgent work nearby!' : '📍 New job near you',
      body: isUrgent
        ? `${job.title} — ${job.skill} needed NOW in ${job.location.city}. ₹${job.wage}/day. Tap to respond fast!`
        : `${job.title} — ${job.skill} job posted near you in ${job.location.city}. ₹${job.wage}/day.`,
      link: isUrgent ? `/jobs/urgent/${job._id}` : `/jobs/${job._id}`,
      meta: { jobTitle: job.title, skill: job.skill, city: job.location.city, wage: job.wage },
    })
  ));

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    console.error(`Job ${job._id} stage ${stageIndex + 1}: ${failed.length}/${targets.length} notifications failed:`, failed[0].reason?.message);
  }
};

// Runs every overdue stage of ONE job, in order, for each audience.
const processJobStages = async (jobId, config) => {
  const { enabled, delayMin, audiences } = config || await getAudienceConfig();

  for (const audience of audiences) {
    for (let i = 0; i < STAGES.length; i++) {
      const job = await Job.findById(jobId);
      if (!job || job.status !== 'open') return;           // filled / closed → stop everything

      const done = job.notifyProgress?.[audience];
      if (typeof done !== 'number' || done >= STAGES.length) break;   // missing = job from before this feature; leave it alone
      if (Date.now() < stageDueAt(job.createdAt, done, audience, delayMin)) break;  // next stage not due yet

      // Atomic claim: only one run can take a given stage.
      const claimed = await Job.findOneAndUpdate(
        { _id: jobId, status: 'open', [`notifyProgress.${audience}`]: done },
        { $set: { [`notifyProgress.${audience}`]: done + 1 } },
        { new: true }
      );
      if (!claimed) break;

      await sendStage(claimed, audience, done, enabled);
    }
  }
};

// One scheduler pass over every open job that still has stages left.
const runDueStages = async () => {
  try {
    const config = await getAudienceConfig();
    const pending = await Job.find({
      status: 'open',
      $or: config.audiences.map(a => ({ [`notifyProgress.${a}`]: { $lt: STAGES.length } })),
    }).select('_id');

    for (const j of pending) await processJobStages(j._id, config);
  } catch (err) {
    console.error('Notification scheduler error:', err.message);
  }
};

let started = false;
const startNotificationScheduler = () => {
  if (started) return;
  started = true;
  setInterval(runDueStages, SCHEDULER_INTERVAL_MS);
  console.log(`Job notification scheduler started (every ${SCHEDULER_INTERVAL_MS / 1000}s, time scale ${SCALE})`);
};

// Starts as soon as this file is first required (jobController requires it
// at server boot), so index.js doesn't need to change.
startNotificationScheduler();

module.exports = { processJobStages, runDueStages, startNotificationScheduler, stageDueAt, STAGES };