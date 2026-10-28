const Job  = require('../models/Job');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const PlatformSettings   = require('../models/PlatformSettings');
const UserSubscription   = require('../models/UserSubscription');
const { createNotification } = require('./notificationController');
const { processJobStages } = require('../services/jobNotifier');
const { getPostingBlock, startPaymentOnComplete, recordWalletEntries } = require('./paymentController');
const { startCodeRequired, checkStartCode, clearStartCode } = require('./startCodeController');

const RADII_KM = [6, 15, 30];

const CITY_COORDS = {
  Hyderabad:      { lat: 17.3850, lng: 78.4867 },
  Visakhapatnam:  { lat: 17.6868, lng: 83.2185 },
  Vijayawada:     { lat: 16.5062, lng: 80.6480 },
  Warangal:       { lat: 17.9689, lng: 79.5941 },
  Tirupati:       { lat: 13.6288, lng: 79.4192 },
  Bengaluru:      { lat: 12.9716, lng: 77.5946 },
  Chennai:        { lat: 13.0827, lng: 80.2707 },
  Mumbai:         { lat: 19.0760, lng: 72.8777 },
  Delhi:          { lat: 28.7041, lng: 77.1025 },
  Pune:           { lat: 18.5204, lng: 73.8567 },
};

// ── Subscription-gated early access — UNCHANGED from your original ─────────
const hasActiveSubscription = async (userId) => {
  const sub = await UserSubscription.findOne({ user: userId, status: 'active' });
  return !!sub;
};

const getEarlyAccessContext = async (userId) => {
  const settings = await PlatformSettings.getSettings();
  if (!settings.subscriptionsEnabled) {
    return { enabled: false, delayMinutes: 0, isSubscribed: false };
  }
  const isSubscribed = await hasActiveSubscription(userId);
  return { enabled: true, delayMinutes: settings.earlyAccessMinutes, isSubscribed };
};

const createJob = async (req, res) => {
  try {
    // Payment rule: a poster with an unconfirmed worker payment cannot post.
    const block = await getPostingBlock(req.user);
    if (block.blocked) {
      return res.status(403).json({
        success: false,
        code: 'PAYMENT_PENDING',
        pending: block.pending,
        message: 'You have reached the limit of 4 new posts while a worker code is still not entered. Enter the worker\'s code to post more.',
      });
    }

    const { title, skill, description, city, area, wage, workersNeeded, duration, startDate, startTime, jobType, urgentWithinHours, lat, lng, autoAccept } = req.body;

    const location = { city, area };
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (!isNaN(latNum) && !isNaN(lngNum)) {
      location.lat = latNum;
      location.lng = lngNum;
      location.point = { type: 'Point', coordinates: [lngNum, latNum] };
    } else if (CITY_COORDS[city]) {
      const c = CITY_COORDS[city];
      location.lat = c.lat;
      location.lng = c.lng;
      location.point = { type: 'Point', coordinates: [c.lng, c.lat] };
    }

    const job = await Job.create({
      postedBy: req.user._id, title, skill, description, location,
      wage, workersNeeded, duration, startDate, startTime, jobType: jobType || 'regular',
      autoAccept: !!autoAccept && Number(workersNeeded) > 1 && (jobType || 'regular') !== 'urgent',
      urgentWithinHours: urgentWithinHours || 2,
    });

    try {
      await User.findByIdAndUpdate(req.user._id, { $inc: { 'poster.totalJobsPosted': 1 } });
    } catch (e) {}

    // Start the nearby-worker notification flow (6 km now, 15 km at 10 min,
    // 25 km at 15 min — see services/jobNotifier.js). Not awaited: posting
    // the job never waits on, or fails because of, notifications.
    processJobStages(job._id).catch(err => console.error('Job notify error:', err.message));

    res.status(201).json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


// ── Phone numbers ─────────────────────────────────────────────────────────
// A phone number only travels to someone who is allowed to call: the poster and an
// accepted worker, while the pair's chat/call is open (accepted and not yet paid).
// Everyone else — other workers, anonymous visitors, a pair whose job is closed —
// gets the profile with no phone.
const idOf = (x) => String((x && x._id) || x);
const contactOpen = (a) => !!(a && a.chatUnlocked && !a.contactClosed);

const scrubJob = (o, viewerId) => {
  const me = viewerId ? String(viewerId) : null;
  const iAmPoster = !!me && me === idOf(o.postedBy);
  const myApp = me ? (o.applicants || []).find(a => idOf(a.worker) === me) : null;
  if (o.postedBy && o.postedBy.phone !== undefined && !(myApp && contactOpen(myApp))) {
    o.postedBy = { ...o.postedBy, phone: undefined };
  }
  o.applicants = (o.applicants || []).map(a => {
    if (a.worker && a.worker.phone !== undefined) {
      const isMe = !!me && idOf(a.worker) === me;
      if (!isMe && !(iAmPoster && contactOpen(a))) a.worker = { ...a.worker, phone: undefined };
    }
    return a;
  });
  return o;
};
const scrubMany = (docs, viewerId) => docs.map(d => scrubJob(d.toObject ? d.toObject() : d, viewerId));

// Jobs disappear from the workers' lists, and stop taking new applications, this many days after posting.
// Work already accepted is not affected (it stays in My Work). Override with JOB_LIFETIME_DAYS in env.
const JOB_LIFETIME_DAYS = Number(process.env.JOB_LIFETIME_DAYS) > 0 ? Number(process.env.JOB_LIFETIME_DAYS) : 4;
const expiryCutoff = () => new Date(Date.now() - JOB_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

// Seats: an accepted applicant fills `crewSize` seats (a team leader brings several workers).
const crewOf = (a) => Math.max(1, Number(a && a.crewSize) || 1);
const seatsTaken = (job) => job.applicants.filter(a => a.status === 'accepted').reduce((n, a) => n + crewOf(a), 0);

const getJobs = async (req, res) => {
  try {
    const { skill, city, jobType, page = 1, limit = 20, lat, lng } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const baseMatch = { status: 'open', createdAt: { $gte: expiryCutoff() } };
    if (skill && skill.trim()) baseMatch.skill = { $regex: `^${escapeRegex(skill.trim())}$`, $options: 'i' };
    if (jobType) baseMatch.jobType = jobType;

    let earlyAccess = { enabled: false, delayMinutes: 0, isSubscribed: false };
    if (req.user) {
      earlyAccess = await getEarlyAccessContext(req.user._id);
    }
    if (earlyAccess.enabled && !earlyAccess.isSubscribed) {
      const cutoff = new Date(Date.now() - earlyAccess.delayMinutes * 60 * 1000);
      baseMatch.createdAt = { $gte: expiryCutoff(), $lte: cutoff };
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const hasGeo = !isNaN(userLat) && !isNaN(userLng);

    if (hasGeo) {
      let matches = [];
      let usedRadiusKm = RADII_KM[RADII_KM.length - 1];

      for (const radiusKm of RADII_KM) {
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

      let jobs = await Job.find({ _id: { $in: idOrder } })
        .populate('postedBy', 'name phone')
        .populate('applicants.worker', 'name phone');

      const distanceById = new Map(pageSlice.map(m => [m._id.toString(), m.distanceMeters]));
      jobs = idOrder
        .map(id => jobs.find(j => j._id.toString() === id.toString()))
        .filter(Boolean)
        .map(job => {
          const obj = scrubJob(job.toObject(), req.user?._id);
          obj.distanceKm = Math.round((distanceById.get(job._id.toString()) / 1000) * 10) / 10;
          return obj;
        });

      return res.status(200).json({
        success: true, total, page: Number(page), pages: Math.ceil(total / limit),
        jobs, geoSearch: true, radiusKm: usedRadiusKm,
      });
    }

    const query = { ...baseMatch };
    if (city && city.trim()) {
      const cleanCity = escapeRegex(city.trim());
      query.$or = [{ 'location.city': { $regex: cleanCity, $options: 'i' } }, { 'location.area': { $regex: cleanCity, $options: 'i' } }];
    }

    const total = await Job.countDocuments(query);
    const jobs  = await Job.find(query)
      .populate('postedBy', 'name phone').populate('applicants.worker', 'name phone')
      .sort({ jobType: -1, createdAt: -1 }).skip(skip).limit(Number(limit));

    res.status(200).json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), jobs: scrubMany(jobs, req.user?._id), geoSearch: false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMyAppliedJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ 'applicants.worker': req.user._id, 'applicants.status': 'accepted' })
      .populate('postedBy', 'name phone').populate('applicants.worker', 'name phone').sort({ createdAt: -1 });
    res.status(200).json({ success: true, jobs: scrubMany(jobs, req.user._id) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getUrgentJobs = async (req, res) => {
  try {
    const { skill, city } = req.query;
    const query = { status: 'open', jobType: 'urgent', createdAt: { $gte: expiryCutoff() } };
    if (skill && skill.trim()) query.skill = { $regex: `^${escapeRegex(skill.trim())}$`, $options: 'i' };
    if (city  && city.trim())  query['location.city'] = { $regex: escapeRegex(city.trim()), $options: 'i' };

    if (req.user) {
      const earlyAccess = await getEarlyAccessContext(req.user._id);
      if (earlyAccess.enabled && !earlyAccess.isSubscribed) {
        const cutoff = new Date(Date.now() - earlyAccess.delayMinutes * 60 * 1000);
        query.createdAt = { $gte: expiryCutoff(), $lte: cutoff };
      }
    }

    const jobs = await Job.find(query)
      .populate('postedBy', 'name phone').populate('applicants.worker', 'name phone').sort({ createdAt: -1 });
    res.status(200).json({ success: true, jobs: scrubMany(jobs, req.user?._id) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getJobById = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('postedBy', 'name phone').populate('applicants.worker', 'name phone');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    const out = scrubJob(job.toObject(), req.user?._id);
    res.status(200).json({ success: true, job: out });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMyJobs = async (req, res) => {
  try {
    const found = await Job.find({ postedBy: req.user._id }).populate('applicants.worker', 'name phone profilePhoto').sort({ createdAt: -1 });
    const jobs = scrubMany(found, req.user._id);
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
        postedBy: job.postedBy && contactOpen(myApp)
          ? job.postedBy
          : job.postedBy && { _id: job.postedBy._id, name: job.postedBy.name },   // no phone once contact is closed
        jobType: job.jobType,
        paymentStatus: myApp?.paymentStatus || 'none',
        contactClosed: !!myApp?.contactClosed,
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
          completedAt: myApp?.workCompletedAt || job.updatedAt, otherParty: contactOpen(myApp) ? job.postedBy : job.postedBy && { _id: job.postedBy._id, name: job.postedBy.name }, direction: 'earned',
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
              completedAt: a.workCompletedAt || job.updatedAt, otherParty: contactOpen(a) ? a.worker : a.worker && { _id: a.worker._id, name: a.worker.name }, direction: 'paid',
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
    if (job.createdAt < expiryCutoff()) return res.status(400).json({ success: false, message: 'This job has expired' });

    const alreadyApplied = job.applicants.find(a => a.worker.toString() === req.user._id.toString());
    if (alreadyApplied) return res.status(400).json({ success: false, message: 'Already applied' });

    let crewSize = parseInt(req.body && req.body.crewSize, 10);
    if (!Number.isFinite(crewSize) || crewSize < 1) crewSize = 1;
    const taken = seatsTaken(job);
    if (taken >= job.workersNeeded) {
      return res.status(400).json({ success: false, message: 'This job is already fully staffed' });
    }
    const seatsLeft = job.workersNeeded - taken;
    if (crewSize > seatsLeft) {
      return res.status(400).json({ success: false, message: `Only ${seatsLeft} place${seatsLeft !== 1 ? 's' : ''} left — a team of ${crewSize} does not fit.` });
    }
    const teamText = crewSize > 1 ? ` (team of ${crewSize})` : '';

    if (job.jobType === 'urgent' || job.autoAccept) {
      // Atomic "claim a seat": the check (seats left, not already applied, job open) and the
      // insert happen in ONE database operation, so 15 workers tapping Apply at the same
      // moment can never fill more than workersNeeded seats.
      const claimed = await Job.findOneAndUpdate(
        {
          _id: job._id,
          status: 'open',
          'applicants.worker': { $ne: req.user._id },
          $expr: { $lte: [
            { $add: [
              { $sum: { $map: {
                  input: { $filter: { input: '$applicants', cond: { $eq: ['$$this.status', 'accepted'] } } },
                  as: 'a', in: { $ifNull: ['$$a.crewSize', 1] },
              } } },
              crewSize,
            ] },
            '$workersNeeded',
          ] },
        },
        { $push: { applicants: {
            worker: req.user._id, status: 'accepted', workStatus: 'not_started',
            chatUnlocked: true, autoAccepted: true, appliedAt: new Date(), crewSize,
        } } },
        { new: true }
      );
      if (!claimed) {
        return res.status(400).json({ success: false, message: 'Sorry, this job just got filled or is no longer open.' });
      }

      const filled = seatsTaken(claimed);
      if (filled >= claimed.workersNeeded) {
        await Job.updateOne({ _id: claimed._id, status: 'open' }, { $set: { status: 'closed' } });
      }

      const urgent = job.jobType === 'urgent';
      await createNotification({
        recipient: job.postedBy._id, type: urgent ? 'urgent_filled' : 'job_applied',
        title: urgent ? 'Urgent job — worker confirmed! ⚡' : `Worker joined (${filled}/${claimed.workersNeeded}) ✅`,
        body: urgent
          ? `${req.user.name}${teamText} accepted your urgent job "${job.title}" and is on the way. Chat is open now.`
          : `${req.user.name}${teamText} joined your job "${job.title}" — ${filled} of ${claimed.workersNeeded} workers confirmed.`,
        link: urgent ? `/chat/${req.user._id}` : `/jobs/${job._id}`,
        meta: { actorName: req.user.name, jobTitle: job.title },
      });

      return res.status(200).json({ success: true, message: "You're confirmed! Chat is now open.", autoAccepted: true });
    }

    job.applicants.push({ worker: req.user._id, crewSize });
    await job.save();

    await createNotification({
      recipient: job.postedBy._id, type: 'job_applied', title: 'New applicant!',
      body: `${req.user.name}${teamText} applied to your job: ${job.title}`, link: `/jobs/${job._id}`,
      meta: { actorName: req.user.name, jobTitle: job.title },
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

    // Finished / closed pairs can never be re-opened (would bring chat back).
    if (applicant.contactClosed || applicant.workStatus === 'completed') {
      return res.status(400).json({ success: false, message: 'This job is already finished.' });
    }

    if (status === 'accepted') {
      const taken = seatsTaken(job);
      if (taken >= job.workersNeeded) {
        return res.status(400).json({ success: false, message: 'This job is already fully staffed' });
      }
      if (taken + crewOf(applicant) > job.workersNeeded) {
        return res.status(400).json({ success: false, message: `Not enough places left for this team of ${crewOf(applicant)}.` });
      }
    }

    applicant.status       = status;
    applicant.chatUnlocked = status === 'accepted';
    if (status === 'accepted') {
      applicant.workStatus = 'not_started';
    }

    await job.save();

    if (status === 'accepted') {
      if (seatsTaken(job) >= job.workersNeeded && job.status === 'open') {
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
      meta: { jobTitle: job.title },
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

    // Start code (START_CODE=on): the poster must type the code the worker shows in their app.
    const codeOn = startCodeRequired();
    if (codeOn) {
      const chk = await checkStartCode(job._id, req.params.workerId, req.body && req.body.otp);
      if (!chk.ok) return res.status(chk.status).json({ success: false, code: chk.code, message: chk.message });
    }

    applicant.workStatus    = 'in_progress';
    applicant.workStartedAt = new Date();
    await job.save();
    if (codeOn) await clearStartCode(job._id, req.params.workerId).catch(() => {});

    await createNotification({
      recipient: applicant.worker._id,
      type:  'work_started',
      title: 'Work has started! 🔨',
      body:  `${req.user.name} marked "${job.title}" as started. Time to begin work!`,
      link:  '/my-work',
      meta: { actorName: req.user.name, jobTitle: job.title },
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

    const pay = await startPaymentOnComplete();

    applicant.workStatus      = 'completed';
    applicant.workCompletedAt = new Date();
    if (pay.enabled) {
      applicant.paymentStatus = 'pending';
      applicant.paymentOtp    = pay.otp;
      applicant.paymentOtpAttempts = 0;
    }
    await job.save();

    // OTP on  -> wallet rows are written when the poster enters the code.
    // OTP off -> old behaviour, written right away.
    if (!pay.enabled) {
      await recordWalletEntries(job, applicant.worker._id, req.user._id);
    }

    try {
      await User.findByIdAndUpdate(applicant.worker._id, { $inc: { 'worker.totalJobsDone': 1 } });
    } catch (e) {}

    await createNotification({
      recipient: applicant.worker._id,
      type:  'work_completed',
      title: 'Work completed! ✅',
      body:  pay.enabled
        ? `${req.user.name} marked "${job.title}" as completed. After you receive ₹${job.wage}, open the job and give them your payment code.`
        : `${req.user.name} marked "${job.title}" as completed. ₹${job.wage} added to your wallet records. Don't forget to rate them!`,
      link:  pay.enabled ? '/my-work' : '/wallet',
      meta: { actorName: req.user.name, jobTitle: job.title, amount: job.wage },
    });

    res.status(200).json({
      success: true,
      message: pay.enabled ? 'Work completed. Enter the worker\'s payment code to finish.' : 'Work marked as completed',
      workStatus: 'completed',
      paymentPending: !!pay.enabled,
    });
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