const DeletionRequest = require('../models/DeletionRequest');
const Job = require('../models/Job');

const requestDeletion = async (req, res) => {
  try {
    const { reason } = req.body;
    const userId = req.user._id;

    let activeCount = 0;
    if (req.user.role === 'worker') {
      activeCount = await Job.countDocuments({
        'applicants.worker': userId,
        'applicants.status': 'accepted',
        'applicants.workStatus': { $in: ['not_started', 'in_progress'] },
      });
    } else {
      activeCount = await Job.countDocuments({ postedBy: userId, status: 'open' });
    }

    if (activeCount > 0) {
      return res.status(400).json({
        success: false,
        message: req.user.role === 'worker'
          ? `You have ${activeCount} active job${activeCount !== 1 ? 's' : ''}. Please complete or leave them before requesting deletion.`
          : `You have ${activeCount} open job post${activeCount !== 1 ? 's' : ''}. Please close them before requesting deletion.`,
      });
    }

    const existing = await DeletionRequest.findOne({ user: userId, status: 'pending' });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have a deletion request under review.' });
    }

    const request = await DeletionRequest.findOneAndUpdate(
      { user: userId },
      { user: userId, reason: reason || '', status: 'pending', requestedAt: new Date(), reviewedAt: null, reviewedBy: null, adminNote: '' },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, message: 'Your deletion request has been submitted. Our team will review it within 7 days.', request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyDeletionRequest = async (req, res) => {
  try {
    const request = await DeletionRequest.findOne({ user: req.user._id });
    res.status(200).json({ success: true, request: request || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const cancelDeletion = async (req, res) => {
  try {
    const request = await DeletionRequest.findOne({ user: req.user._id, status: 'pending' });
    if (!request) {
      return res.status(404).json({ success: false, message: 'No pending deletion request found' });
    }
    request.status = 'cancelled';
    await request.save();
    res.status(200).json({ success: true, message: 'Deletion request cancelled. Your account stays active.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { requestDeletion, getMyDeletionRequest, cancelDeletion };
