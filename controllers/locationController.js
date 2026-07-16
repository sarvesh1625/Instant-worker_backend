const Location = require('../models/Location');
const Job = require('../models/Job');

const startSharing = async (req, res) => {
  try {
    const { jobId, lat, lng } = req.body;
    const location = await Location.findOneAndUpdate(
      { worker: req.user._id },
      {
        worker: req.user._id,
        job: jobId,
        coordinates: { lat, lng },
        isSharing: true,
        lastUpdated: Date.now(),
      },
      { new: true, upsert: true }
    );
    res.status(200).json({ success: true, location });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const stopSharing = async (req, res) => {
  try {
    await Location.findOneAndUpdate(
      { worker: req.user._id },
      { isSharing: false, job: null }
    );
    res.status(200).json({ success: true, message: 'Location sharing stopped' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// FIX: previously anyone with a valid login could fetch ANY worker's live
// GPS coordinates just by knowing their user ID — there was no check that
// the requester actually has an active accepted job with that worker.
// Now it's restricted to: the requester posted a job that this worker is
// accepted on, AND that job is the one currently being shared for.
const getWorkerLocation = async (req, res) => {
  try {
    const location = await Location.findOne({
      worker: req.params.workerId,
      isSharing: true,
    }).populate('worker', 'name phone');

    if (!location) {
      return res.status(404).json({ success: false, message: 'Worker is not sharing location' });
    }

    const hasAccess = await Job.findOne({
      _id: location.job,
      postedBy: req.user._id,
      applicants: { $elemMatch: { worker: req.params.workerId, status: 'accepted' } },
    });

    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this location' });
    }

    res.status(200).json({ success: true, location });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { startSharing, stopSharing, getWorkerLocation };