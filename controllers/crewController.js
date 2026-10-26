const Job     = require('../models/Job');
const Message = require('../models/Message');
const { createNotification } = require('./notificationController');
const { pushToUser } = require('../services/pushService');
const { startCodeRequired } = require('./startCodeController');

// Tools for jobs that need several workers (e.g. "I need 15 workers today"),
// so the poster does not have to handle every worker one by one.
// All three are poster-only.

const loadOwnJob = async (req, res) => {
  const job = await Job.findById(req.params.id).populate('applicants.worker', 'name');
  if (!job) { res.status(404).json({ success: false, message: 'Job not found' }); return null; }
  if (job.postedBy.toString() !== req.user._id.toString()) {
    res.status(403).json({ success: false, message: 'Not authorized' }); return null;
  }
  return job;
};

// PATCH /jobs/:id/accept-all — accept waiting applicants, first applied first, until the job is full.
const acceptAll = async (req, res) => {
  try {
    const job = await loadOwnJob(req, res); if (!job) return;

    const crewOf = (x) => Math.max(1, Number(x && x.crewSize) || 1);
    const taken = job.applicants.filter(a => a.status === 'accepted').reduce((n, a) => n + crewOf(a), 0);
    let seats = job.workersNeeded - taken;
    if (seats <= 0) return res.status(400).json({ success: false, message: 'This job is already fully staffed' });

    // First applied first; a team is accepted only if the whole team still fits.
    const pending = [];
    job.applicants
      .filter(a => a.status === 'pending' && !a.contactClosed)
      .sort((x, y) => new Date(x.appliedAt || 0) - new Date(y.appliedAt || 0))
      .forEach(a => { if (crewOf(a) <= seats) { pending.push(a); seats -= crewOf(a); } });
    if (pending.length === 0) return res.status(400).json({ success: false, message: 'No waiting applicants fit the places left' });

    pending.forEach(a => { a.status = 'accepted'; a.chatUnlocked = true; a.workStatus = 'not_started'; });
    if (seats <= 0 && job.status === 'open') job.status = 'closed';
    await job.save();

    await Promise.allSettled(pending.map(a => createNotification({
      recipient: a.worker._id, type: 'applicant_accepted', title: 'You got the job! 🎉',
      body: `Your application for "${job.title}" was accepted. You can now chat with the poster.`,
      link: `/chat/${job.postedBy}`, meta: { jobTitle: job.title },
    })));

    res.status(200).json({ success: true, accepted: pending.length, message: `${pending.length} worker${pending.length !== 1 ? 's' : ''} accepted` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /jobs/:id/start-all — mark work started for every accepted worker who has not started yet.
const startAll = async (req, res) => {
  try {
    if (startCodeRequired()) {
      return res.status(400).json({ success: false, code: 'START_CODE_REQUIRED', message: 'Each worker has their own start code. Start them one by one with their code.' });
    }
    const job = await loadOwnJob(req, res); if (!job) return;

    const todo = job.applicants.filter(a => a.status === 'accepted' && a.workStatus === 'not_started' && !a.contactClosed);
    if (todo.length === 0) return res.status(400).json({ success: false, message: 'No workers waiting to start' });

    const now = new Date();
    todo.forEach(a => { a.workStatus = 'in_progress'; a.workStartedAt = now; });
    await job.save();

    await Promise.allSettled(todo.map(a => createNotification({
      recipient: a.worker._id, type: 'work_started', title: 'Work has started! 🔨',
      body: `${req.user.name} marked "${job.title}" as started. Time to begin work!`,
      link: '/my-work', meta: { actorName: req.user.name, jobTitle: job.title },
    })));

    res.status(200).json({ success: true, started: todo.length, message: `Work started for ${todo.length} worker${todo.length !== 1 ? 's' : ''}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /jobs/:id/broadcast { text } — one message to every accepted worker (arrives in each worker's normal chat).
const broadcast = async (req, res) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

    const job = await loadOwnJob(req, res); if (!job) return;
    const crew = job.applicants.filter(a => a.status === 'accepted' && a.chatUnlocked && !a.contactClosed);
    if (crew.length === 0) return res.status(400).json({ success: false, message: 'No accepted workers to message yet' });

    const full = `📢 ${job.title}: ${text}`;
    await Message.insertMany(crew.map(a => ({
      conversationId: Message.getConversationId(req.user._id, a.worker._id),
      sender: req.user._id, receiver: a.worker._id, type: 'text', text: full,
    })));

    crew.forEach(a => pushToUser(a.worker._id, {
      type: 'new_message', title: req.user.name, body: full.slice(0, 140),
      link: `/chat/${req.user._id}`, meta: { actorName: req.user.name },
    }).catch(() => {}));

    res.status(200).json({ success: true, sent: crew.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { acceptAll, startAll, broadcast };