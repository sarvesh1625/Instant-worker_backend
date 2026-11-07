const Job = require('../models/Job');
const TravelStatus = require('../models/TravelStatus');
const { createNotification } = require('./notificationController');

const idStr = (x) => String((x && x._id) || x);
const crewOf = (a) => Math.max(1, Number(a && a.crewSize) || 1);
const seatsTaken = (job) => job.applicants.filter(a => a.status === 'accepted').reduce((n, a) => n + crewOf(a), 0);
const acceptedApp = (job, workerId) => job.applicants.find(a => idStr(a.worker) === String(workerId) && a.status === 'accepted');

// GET /api/travel/job/:jobId
// The poster gets every worker's status for the job; a worker gets only their own.
const getTravel = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId).select('postedBy');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    const isPoster = idStr(job.postedBy) === String(req.user._id);
    const filter = isPoster ? { job: job._id } : { job: job._id, worker: req.user._id };
    const items = await TravelStatus.find(filter)
      .select('worker status onTheWayAt reachedAt cancelledBy cancelledAt lateCancel')
      .lean();
    res.status(200).json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/travel/job/:jobId   { status: 'on_the_way' | 'reached' }   (worker only)
const setStatus = async (req, res) => {
  try {
    const status = req.body && req.body.status;
    if (!['on_the_way', 'reached'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be on_the_way or reached' });
    }
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const app = acceptedApp(job, req.user._id);
    if (!app) return res.status(403).json({ success: false, message: 'You are not accepted for this job' });
    if (app.contactClosed) return res.status(400).json({ success: false, message: 'This job is closed' });
    if (app.workStatus !== 'not_started') return res.status(400).json({ success: false, message: 'Work has already started' });

    const existing = await TravelStatus.findOne({ job: job._id, worker: req.user._id });
    if (existing && existing.status === status) return res.status(200).json({ success: true, status, unchanged: true });

    const now = new Date();
    const set = { status };
    if (status === 'on_the_way') set.onTheWayAt = existing?.onTheWayAt || now;
    if (status === 'reached')    { set.reachedAt = now; set.onTheWayAt = existing?.onTheWayAt || now; }
    await TravelStatus.findOneAndUpdate(
      { job: job._id, worker: req.user._id },
      { $set: set, $unset: { cancelledAt: 1, cancelledBy: 1, cancelReason: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const reached = status === 'reached';
    await createNotification({
      recipient: job.postedBy,
      type: reached ? 'worker_reached' : 'worker_on_the_way',
      title: reached ? `${req.user.name} has reached 📍` : `${req.user.name} is on the way 🚶`,
      body: reached
        ? `${req.user.name} reached the place for "${job.title}".`
        : `${req.user.name} is coming for "${job.title}".`,
      link: `/jobs/${job._id}`,
      meta: { actorName: req.user.name, jobTitle: job.title },
    });

    res.status(200).json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/travel/job/:jobId/cancel   { workerId?, reason? }
// Worker: cancels their own place.  Poster: removes the worker named in workerId.
// Only allowed before the work has started. The place is freed and the other side is told.
// Cancelling AFTER "on the way" / "reached" is marked lateCancel = true (recorded, no automatic penalty).
const cancel = async (req, res) => {
  try {
    const reasonIn = String((req.body && req.body.reason) || '').trim();
    if (reasonIn.length < 3) return res.status(400).json({ success: false, message: 'Please choose a reason' });

    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const byPoster = idStr(job.postedBy) === String(req.user._id);
    const workerId = byPoster ? (req.body && req.body.workerId) : req.user._id;
    if (!workerId) return res.status(400).json({ success: false, message: 'workerId is required' });

    const app = acceptedApp(job, workerId);
    if (!app) return res.status(404).json({ success: false, message: 'No accepted worker found for this job' });
    if (app.workStatus !== 'not_started') {
      return res.status(400).json({ success: false, message: 'Work has already started. Please contact support to cancel.' });
    }
    if (app.contactClosed) return res.status(400).json({ success: false, message: 'This job is closed' });

    const existing = await TravelStatus.findOne({ job: job._id, worker: workerId });
    const late = !!existing && ['on_the_way', 'reached'].includes(existing.status);
    const wasFull = seatsTaken(job) >= job.workersNeeded;

    app.status = 'rejected';
    app.chatUnlocked = false;
    if (wasFull && job.status === 'closed') job.status = 'open';   // a place is free again
    await job.save();

    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 200);
    await TravelStatus.findOneAndUpdate(
      { job: job._id, worker: workerId },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: byPoster ? 'poster' : 'worker', cancelledById: req.user._id, cancelReason: reason, lateCancel: late } },
      { upsert: true, setDefaultsOnInsert: true }
    );

    await createNotification({
      recipient: byPoster ? workerId : job.postedBy,
      type: 'job_cancelled',
      title: byPoster ? 'You were removed from a job' : `${req.user.name} cancelled`,
      body: byPoster
        ? `The poster removed you from "${job.title}".`
        : `${req.user.name} cancelled "${job.title}". The place is free again.`,
      link: byPoster ? '/my-work' : `/jobs/${job._id}`,
      meta: { actorName: req.user.name, jobTitle: job.title },
    });

    res.status(200).json({ success: true, late });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getTravel, setStatus, cancel };