const Job  = require('../models/Job');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { createNotification } = require('./notificationController');

// Auto-expand radii, in km, tried in order until at least one match is found.
const RADII_KM = [6, 15, 30];

// ── Find available workers matching skill within radius (falls back to
// exact-city match if the job has no GPS point) ─────────────────────────────
const findAndNotifyUrgentWorkers = async (job) => {
  try {
    let workers = [];
    const hasPoint = job.location?.point?.coordinates?.length === 2;

    if (hasPoint) {
      for (const radiusKm of RADII_KM) {
        workers = await User.find({
          role: 'worker',
          'worker.skill': job.skill,
          'worker.availability': true,
          'worker.location': {
            $nearSphere: {
              $geometry: job.location.point,
              $maxDistance: radiusKm * 1000,
            },
          },
        }).select('_id name');
        if (workers.length > 0) break;
      }
    } else {
      // No GPS on this job (older job, or GPS was denied at post time) —
      // fall back to the original exact-city text match.
      workers = await User.find({
        role: 'worker', 'worker.skill': job.skill, city: job.location.city, 'worker.availability': true,
      }).select('_id name');
    }

    if (workers.length === 0) return;

    await Promise.all(workers.map(w =>
      createNotification({
        recipient: w._id,
        type: 'urgent_job',
        title: '🔴 Urgent work nearby!',
        body: `${job.title} — ${job.skill} needed NOW in ${job.location.city}. ₹${job.wage}/day. Tap to respond fast!`,
        link: `/jobs/urgent/${job._id}`,
      })
    ));

    job.urgentNotifiedWorkers = workers.map(w => w._id);
    await job.save();
  } catch (err) {
    console.error('Urgent notify error:', err.message);
  }
};

const createJob = async (req, res) => {
  try {
    const { title, skill, description, city, area, wage, workersNeeded, duration, startDate, startTime, jobType, urgentWithinHours, lat, lng } = req.body;

    const location = { city, area };
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    // Derive the GeoJSON point automatically whenever coordinates are given
    // (from GPS auto-fill or the manual map pin) — everything downstream
    // (radius search, urgent-worker matching) depends on this point existing.
    if (!isNaN(latNum) && !isNaN(lngNum)) {
      location.lat = latNum;
      location.lng = lngNum;
      location.point = { type: 'Point', coordinates: [lngNum, latNum] };
    }

    const job = await Job.create({
      postedBy: req.user._id, title, skill, description, location,
      wage, workersNeeded, duration, startDate, startTime, jobType: jobType || 'regular',
      urgentWithinHours: urgentWithinHours || 2,
    });
    if (job.jobType === 'urgent') await findAndNotifyUrgentWorkers(job);
    res.status(201).json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Radius-based job search with quiet auto-expand ──────────────────────────
// When the worker's lat/lng are provided, searches 6km → 15km → 30km,
// stopping at the first radius that returns results (or settling on 30km if
// still empty). Falls back to the original city/skill text search when no
// coordinates are given — covers GPS-denied workers and older clients.
const getJobs = async (req, res) => {
  try {
    const { skill, city, jobType, page = 1, limit = 20, lat, lng } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const baseMatch = { status: 'open' };
    if (skill && skill.trim()) baseMatch.skill = { $regex: `^${escapeRegex(skill.trim())}$`, $options: 'i' };
    if (jobType) baseMatch.jobType = jobType;

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const hasGeo = !isNaN(userLat) && !isNaN(userLng);

    if (hasGeo) {
      let matches = [];
      let usedRadiusKm = RADII_KM[RADII_KM.length - 1];

      for (const radiusKm of RADII_KM) {
        // $geoNear must be the first stage in the pipeline.
        matches = await Job.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [userLng, userLat] },
              distanceField: 'distanceMeters',
              maxDistance: radiusKm * 1000,
              spherical: true,
              query: baseMatch,
            },
          },
          { $sort: { distanceMeters: 1 } },
          { $project: { _id: 1, distanceMeters: 1 } },
        ]);
        if (matches.length > 0) { usedRadiusKm = radiusKm; break; }
      }

      const total = matches.length;
      const pageSlice = matches.slice(skip, skip + Number(limit));
      const idOrder = pageSlice.map(m => m._id);

      // Aggregation results are plain objects, not Mongoose documents, so
      // populate has to run as a separate step against real documents.
      let jobs = await Job.find({ _id: { $in: idOrder } })
        .populate('postedBy', 'name phone')
        .populate('applicants.worker', 'name phone');

      const distanceById = new Map(pageSlice.map(m => [m._id.toString(), m.distanceMeters]));
      jobs = idOrder
        .map(id => jobs.find(j => j._id.toString() === id.toString()))
        .filter(Boolean)
        .map(job => {
          const obj = job.toObject();
          obj.distanceKm = Math.round((distanceById.get(job._id.toString()) / 1000) * 10) / 10;
          return obj;
        });

      return res.status(200).json({
        success: true, total, page: Number(page), pages: Math.ceil(total / limit),
        jobs, geoSearch: true, radiusKm: usedRadiusKm,
      });
    }

    // ── Fallback: classic city/skill text search (no GPS available) ────────
    const query = { ...baseMatch };
    if (city && city.trim()) {
      const cleanCity = escapeRegex(city.trim());
      query.$or = [{ 'location.city': { $regex: cleanCity, $options: 'i' } }, { 'location.area': { $regex: cleanCity, $options: 'i' } }];
    }

    const total = await Job.countDocuments(query);
    const jobs  = await Job.find(query)
      .populate('postedBy', 'name phone').populate('applicants.worker', 'name phone')
      .sort({ jobType: -1, createdAt: -1 }).skip(skip).limit(Number(limit));

    res.status(200).json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), jobs, geoSearch: false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMyAppliedJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ 'applicants.worker': req.user._id, 'applicants.status': 'accepted' })
      .populate('postedBy', 'name phone').populate('applicants.worker', 'name phone').sort({ createdAt: -1 });
    res.status(200).json({ success: true, jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getUrgentJobs = async (req, res) => {
  try {
    const { skill, city } = req.query;
    const query = { status: 'open', jobType: 'urgent' };
    if (skill && skill.trim()) query.skill = { $regex: `^${escapeRegex(skill.trim())}$`, $options: 'i' };
    if (city  && city.trim())  query['location.city'] = { $regex: escapeRegex(city.trim()), $options: 'i' };
    const jobs = await Job.find(query)
      .populate('postedBy', 'name phone').populate('applicants.worker', 'name phone').sort({ createdAt: -1 });
    res.status(200).json({ success: true, jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getJobById = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('postedBy', 'name phone').populate('applicants.worker', 'name phone');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.status(200).json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMyJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ postedBy: req.user._id }).populate('applicants.worker', 'name phone profilePhoto').sort({ createdAt: -1 });
    res.status(200).json({ success: true, jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMyWork = async (req, res) => {
  try {
    const jobs = await Job.find({ 'applicants.worker': req.user._id, 'applicants.status': 'accepted' })
      .populate('postedBy', 'name phone').sort({ updatedAt: -1 });
    const result = jobs.map(job => {
      const myApp = job.applicants.find(a => a.worker.toString() === req.user._id.toString());
      return {
        _id: job._id, title: job.title, skill: job.skill, location: job.location, wage: job.wage,
        duration: job.duration, startDate: job.startDate, startTime: job.startTime, status: job.status,
        postedBy: job.postedBy, jobType: job.jobType,
        workStatus: myApp?.workStatus || 'not_started',
        workStartedAt: myApp?.workStartedAt || null, workCompletedAt: myApp?.workCompletedAt || null,
      };
    });
    res.status(200).json({ success: true, jobs: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getJobHistory = async (req, res) => {
  try {
    let history = [];
    if (req.user.role === 'worker') {
      const jobs = await Job.find({ 'applicants.worker': req.user._id, 'applicants.status': 'accepted', 'applicants.workStatus': 'completed' })
        .populate('postedBy', 'name phone').sort({ updatedAt: -1 });
      history = jobs.map(job => {
        const myApp = job.applicants.find(a => a.worker.toString() === req.user._id.toString() && a.workStatus === 'completed');
        return {
          jobId: job._id, title: job.title, skill: job.skill, location: job.location, wage: job.wage,
          completedAt: myApp?.workCompletedAt || job.updatedAt, otherParty: job.postedBy, direction: 'earned',
        };
      });
    } else {
      const jobs = await Job.find({ postedBy: req.user._id, 'applicants.workStatus': 'completed' })
        .populate('applicants.worker', 'name phone').sort({ updatedAt: -1 });
      for (const job of jobs) {
        for (const a of job.applicants) {
          if (a.workStatus === 'completed') {
            history.push({
              jobId: job._id, title: job.title, skill: job.skill, location: job.location, wage: job.wage,
              completedAt: a.workCompletedAt || job.updatedAt, otherParty: a.worker, direction: 'paid',
            });
          }
        }
      }
      history.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    }
    res.status(200).json({ success: true, count: history.length, history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const applyToJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('postedBy', 'name');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'open') return res.status(400).json({ success: false, message: 'Job is no longer open' });

    const alreadyApplied = job.applicants.find(a => a.worker.toString() === req.user._id.toString());
    if (alreadyApplied) return res.status(400).json({ success: false, message: 'Already applied' });

    const acceptedCount = job.applicants.filter(a => a.status === 'accepted').length;
    if (acceptedCount >= job.workersNeeded) {
      return res.status(400).json({ success: false, message: 'This job is already fully staffed' });
    }

    if (job.jobType === 'urgent') {
      job.applicants.push({
        worker:       req.user._id,
        status:       'accepted',
        workStatus:   'not_started',
        chatUnlocked: true,
        autoAccepted: true,
      });
      await job.save();

      const newAcceptedCount = job.applicants.filter(a => a.status === 'accepted').length;
      if (newAcceptedCount >= job.workersNeeded) {
        job.status = 'closed';
        await job.save();
      }

      await createNotification({
        recipient: job.postedBy._id, type: 'urgent_filled', title: 'Urgent job — worker confirmed! ⚡',
        body: `${req.user.name} accepted your urgent job "${job.title}" and is on the way. Chat is open now.`,
        link: `/chat/${req.user._id}`,
      });

      return res.status(200).json({ success: true, message: "You're confirmed! Chat is now open.", autoAccepted: true });
    }

    job.applicants.push({ worker: req.user._id });
    await job.save();

    await createNotification({
      recipient: job.postedBy._id, type: 'job_applied', title: 'New applicant!',
      body: `${req.user.name} applied to your job: ${job.title}`, link: '/jobs/my',
    });

    res.status(200).json({ success: true, message: 'Applied successfully!', autoAccepted: false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateApplicantStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const job = await Job.findById(req.params.id).populate('applicants.worker', 'name');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const applicant = job.applicants.find(a => a.worker._id.toString() === req.params.workerId);
    if (!applicant) return res.status(404).json({ success: false, message: 'Applicant not found' });

    if (status === 'accepted') {
      const acceptedCount = job.applicants.filter(a => a.status === 'accepted').length;
      if (acceptedCount >= job.workersNeeded) {
        return res.status(400).json({ success: false, message: 'This job is already fully staffed' });
      }
    }

    applicant.status       = status;
    applicant.chatUnlocked = status === 'accepted';
    if (status === 'accepted') {
      applicant.workStatus = 'not_started';
    }

    await job.save();

    if (status === 'accepted') {
      const newAcceptedCount = job.applicants.filter(a => a.status === 'accepted').length;
      if (newAcceptedCount >= job.workersNeeded && job.status === 'open') {
        job.status = 'closed';
        await job.save();
      }
    }

    await createNotification({
      recipient: applicant.worker._id,
      type:  status === 'accepted' ? 'applicant_accepted' : 'applicant_rejected',
      title: status === 'accepted' ? 'You got the job! 🎉' : 'Application not selected',
      body:  status === 'accepted'
        ? `Your application for "${job.title}" was accepted. You can now chat with the poster.`
        : `Your application for "${job.title}" was not selected this time.`,
      link:  status === 'accepted' ? `/chat/${job.postedBy}` : '/jobs',
    });

    res.status(200).json({
      success: true,
      message: `Applicant ${status}`,
      chatUnlocked: applicant.chatUnlocked,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const startWork = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('applicants.worker', 'name');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const applicant = job.applicants.find(a => a.worker._id.toString() === req.params.workerId);
    if (!applicant) return res.status(404).json({ success: false, message: 'Worker not found' });
    if (applicant.status !== 'accepted') {
      return res.status(400).json({ success: false, message: 'Worker must be accepted first' });
    }
    if (applicant.workStatus === 'in_progress') {
      return res.status(400).json({ success: false, message: 'Work already started' });
    }
    if (applicant.workStatus === 'completed') {
      return res.status(400).json({ success: false, message: 'Work already completed' });
    }

    applicant.workStatus    = 'in_progress';
    applicant.workStartedAt = new Date();
    await job.save();

    await createNotification({
      recipient: applicant.worker._id,
      type:  'work_started',
      title: 'Work has started! 🔨',
      body:  `${req.user.name} marked "${job.title}" as started. Time to begin work!`,
      link:  '/my-work',
    });

    res.status(200).json({ success: true, message: 'Work marked as started', workStatus: 'in_progress' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const completeWork = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('applicants.worker', 'name');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const applicant = job.applicants.find(a => a.worker._id.toString() === req.params.workerId);
    if (!applicant) return res.status(404).json({ success: false, message: 'Worker not found' });
    if (applicant.workStatus !== 'in_progress') {
      return res.status(400).json({ success: false, message: 'Work must be started before completing' });
    }

    applicant.workStatus      = 'completed';
    applicant.workCompletedAt = new Date();
    await job.save();

    try {
      const wage = Number(job.wage) || 0;
      if (wage > 0) {
        await Transaction.create({ user: applicant.worker._id, type: 'credit', amount: wage, job: job._id, counterparty: req.user._id, note: `Earned for "${job.title}"` });
        await Transaction.create({ user: req.user._id, type: 'debit', amount: wage, job: job._id, counterparty: applicant.worker._id, note: `Paid for "${job.title}"` });
      }
    } catch (walletErr) {
      console.error('Wallet record error:', walletErr.message);
    }

    try {
      await User.findByIdAndUpdate(applicant.worker._id, { $inc: { 'worker.totalJobsDone': 1 } });
    } catch (e) {}

    await createNotification({
      recipient: applicant.worker._id,
      type:  'work_completed',
      title: 'Work completed! ✅',
      body:  `${req.user.name} marked "${job.title}" as completed. ₹${job.wage} added to your wallet records. Don't forget to rate them!`,
      link:  '/wallet',
    });

    res.status(200).json({ success: true, message: 'Work marked as completed', workStatus: 'completed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const closeJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    job.status = 'closed';
    await job.save();
    res.status(200).json({ success: true, message: 'Job closed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkChatAccess = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const myId = req.user._id;
    const asPoser = await Job.findOne({
      postedBy: myId,
      applicants: { $elemMatch: { worker: otherUserId, status: 'accepted', chatUnlocked: true } },
    });
    const asWorker = await Job.findOne({
      postedBy: otherUserId,
      applicants: { $elemMatch: { worker: myId, status: 'accepted', chatUnlocked: true } },
    });
    res.status(200).json({ success: true, allowed: !!(asPoser || asWorker) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createJob,
  getJobs,
  getUrgentJobs,
  getJobById,
  getMyJobs,
  getMyWork,
  getMyAppliedJobs,
  getJobHistory,
  applyToJob,
  updateApplicantStatus,
  startWork,
  completeWork,
  closeJob,
  checkChatAccess,
};