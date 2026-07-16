const Report = require('../models/Report');
const Block  = require('../models/Block');
const User   = require('../models/User');

const createReport = async (req, res) => {
  try {
    const { reportedUserId, jobId, reason, description } = req.body;
    if (reportedUserId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot report yourself' });
    }
    const reportedUser = await User.findById(reportedUserId);
    if (!reportedUser) return res.status(404).json({ success: false, message: 'User not found' });

    const report = await Report.create({
      reportedBy: req.user._id, reportedUser: reportedUserId, job: jobId || null,
      reporterRole: req.user.role, reason, description: description || '',
    });
    res.status(201).json({ success: true, message: 'Report submitted. Our team will review it shortly.', report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyReports = async (req, res) => {
  try {
    const reports = await Report.find({ reportedBy: req.user._id })
      .populate('reportedUser', 'name profilePhoto role').sort({ createdAt: -1 });
    res.status(200).json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const blockUser = async (req, res) => {
  try {
    const { userId } = req.body;
    if (userId === req.user._id.toString()) return res.status(400).json({ success: false, message: 'Cannot block yourself' });
    const existing = await Block.findOne({ blocker: req.user._id, blocked: userId });
    if (existing) return res.status(400).json({ success: false, message: 'User already blocked' });
    await Block.create({ blocker: req.user._id, blocked: userId });
    res.status(200).json({ success: true, message: 'User blocked. You will no longer see their jobs or messages.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const unblockUser = async (req, res) => {
  try {
    await Block.findOneAndDelete({ blocker: req.user._id, blocked: req.params.userId });
    res.status(200).json({ success: true, message: 'User unblocked' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyBlocks = async (req, res) => {
  try {
    const blocks = await Block.find({ blocker: req.user._id }).populate('blocked', 'name profilePhoto role');
    res.status(200).json({ success: true, blocks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const checkBlocked = async (req, res) => {
  try {
    const iBlockedThem = await Block.findOne({ blocker: req.user._id, blocked: req.params.userId });
    const theyBlockedMe = await Block.findOne({ blocker: req.params.userId, blocked: req.user._id });
    res.status(200).json({ success: true, blocked: !!(iBlockedThem || theyBlockedMe), iBlockedThem: !!iBlockedThem });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createReport, getMyReports, blockUser, unblockUser, getMyBlocks, checkBlocked };
