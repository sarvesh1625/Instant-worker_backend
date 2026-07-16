const User    = require('../models/User');
const Job     = require('../models/Job');
const Report  = require('../models/Report');
const Review  = require('../models/Review');
const Message = require('../models/Message');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const mongoose = require('mongoose');

const adminLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ success: false, message: 'Phone and password required' });
    const user = await User.findOne({ phone }).select('+password');
    if (!user || user.role !== 'admin') return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    if (user.accountStatus !== 'active') return res.status(403).json({ success: false, message: 'Admin account is not active' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
    res.status(200).json({ success: true, token, user: { _id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const [totalUsers, totalWorkers, totalPosters, totalJobs, openJobs, completedJobs, urgentJobs, pendingVerifications, pendingReports, suspendedUsers] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      User.countDocuments({ role: 'worker' }),
      User.countDocuments({ role: 'user' }),
      Job.countDocuments(),
      Job.countDocuments({ status: 'open' }),
      Job.countDocuments({ status: 'completed' }),
      Job.countDocuments({ jobType: 'urgent' }),
      User.countDocuments({ 'idVerification.status': 'pending' }),
      Report.countDocuments({ status: 'pending' }),
      User.countDocuments({ accountStatus: { $in: ['suspended', 'banned'] } }),
    ]);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newUsersThisWeek = await User.countDocuments({ role: { $ne: 'admin' }, createdAt: { $gte: sevenDaysAgo } });
    const newJobsThisWeek = await Job.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
    res.status(200).json({
      success: true,
      stats: {
        users: { total: totalUsers, workers: totalWorkers, posters: totalPosters, newThisWeek: newUsersThisWeek, suspended: suspendedUsers },
        jobs:  { total: totalJobs, open: openJobs, completed: completedJobs, urgent: urgentJobs, newThisWeek: newJobsThisWeek },
        pending: { verifications: pendingVerifications, reports: pendingReports },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { role, status, search, page = 1, limit = 20 } = req.query;
    const query = { role: { $ne: 'admin' } };
    if (role)   query.role = role;
    if (status) query.accountStatus = status;
    if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }];
    const skip = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(query);
    const users = await User.find(query).select('-password -otp').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    res.status(200).json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -otp');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const [jobsPosted, jobsWorked, reportsAgainst, reportsBy, reviews] = await Promise.all([
      Job.countDocuments({ postedBy: user._id }),
      Job.countDocuments({ 'applicants.worker': user._id, 'applicants.status': 'accepted' }),
      Report.find({ reportedUser: user._id }).populate('reportedBy', 'name phone').sort({ createdAt: -1 }),
      Report.countDocuments({ reportedBy: user._id }),
      Review.find({ reviewedUser: user._id }).populate('reviewedBy', 'name').sort({ createdAt: -1 }).limit(10),
    ]);
    res.status(200).json({
      success: true, user,
      activity: { jobsPosted, jobsWorked, reportsAgainstCount: reportsAgainst.length, reportsByCount: reportsBy },
      reportsAgainst, reviews,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const suspendUser = async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ success: false, message: 'Cannot suspend an admin' });
    user.accountStatus = 'suspended';
    user.suspendedReason = reason || 'Violation of platform policies';
    user.suspendedAt = new Date();
    user.suspendedBy = req.user._id;
    await user.save();
    res.status(200).json({ success: true, message: 'User suspended' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const banUser = async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ success: false, message: 'Cannot ban an admin' });
    user.accountStatus = 'banned';
    user.suspendedReason = reason || 'Serious violation of platform policies';
    user.suspendedAt = new Date();
    user.suspendedBy = req.user._id;
    await user.save();
    res.status(200).json({ success: true, message: 'User banned' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const reactivateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.accountStatus = 'active';
    user.suspendedReason = '';
    user.suspendedAt = null;
    user.suspendedBy = null;
    await user.save();
    res.status(200).json({ success: true, message: 'User reactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateUserByAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const { name, phone, city, area, bio, languages, role, isVerified, worker, poster, newPassword } = req.body;
    if (phone !== undefined && phone !== user.phone) {
      const clash = await User.findOne({ phone, _id: { $ne: user._id } });
      if (clash) return res.status(400).json({ success: false, message: 'That phone number is already registered to another account' });
      user.phone = phone;
    }
    if (name       !== undefined) user.name = name;
    if (city       !== undefined) user.city = city;
    if (area       !== undefined) user.area = area;
    if (bio        !== undefined) user.bio = bio;
    if (role       !== undefined) user.role = role;
    if (isVerified !== undefined) user.isVerified = isVerified;
    if (languages  !== undefined) user.languages = Array.isArray(languages) ? languages : String(languages).split(',').map(l => l.trim()).filter(Boolean);
    if (worker && typeof worker === 'object') { user.worker = user.worker || {}; Object.assign(user.worker, worker); }
    if (poster && typeof poster === 'object') { user.poster = user.poster || {}; Object.assign(user.poster, poster); }
    if (newPassword && newPassword.length >= 6) user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    const updated = await User.findById(user._id).select('-password -otp');
    res.status(200).json({ success: true, message: 'User updated', user: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createUserByAdmin = async (req, res) => {
  try {
    const { name, phone, password, role, skill, city } = req.body;
    if (!name || !phone || !password || !role) return res.status(400).json({ success: false, message: 'name, phone, password and role are required' });
    if (!['worker', 'user'].includes(role)) return res.status(400).json({ success: false, message: 'role must be worker or user' });
    const exists = await User.findOne({ phone });
    if (exists) return res.status(400).json({ success: false, message: 'A user with that phone number already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name, phone, password: hashed, role, city, isPhoneVerified: true, accountStatus: 'active',
      ...(role === 'worker' ? { worker: { skill: skill || '' } } : {}),
    });
    const safe = await User.findById(user._id).select('-password -otp');
    res.status(201).json({ success: true, message: 'User created', user: safe });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteUserByAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ success: false, message: 'Cannot delete an admin account' });
    await Job.deleteMany({ postedBy: user._id });
    await Job.updateMany({}, { $pull: { applicants: { worker: user._id } } });
    await Message.deleteMany({ $or: [{ sender: user._id }, { receiver: user._id }] });
    await Review.deleteMany({ $or: [{ reviewedBy: user._id }, { reviewedUser: user._id }] });
    await Report.deleteMany({ $or: [{ reportedBy: user._id }, { reportedUser: user._id }] });
    await User.findByIdAndDelete(user._id);
    res.status(200).json({ success: true, message: 'User permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getUserConversations = async (req, res) => {
  try {
    const userId = req.params.id;
    const uid = new mongoose.Types.ObjectId(userId);
    const convos = await Message.aggregate([
      { $match: { $or: [{ sender: uid }, { receiver: uid }] } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', lastMessage: { $first: '$$ROOT' }, count: { $sum: 1 } } },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);
    const results = await Promise.all(convos.map(async (c) => {
      const msg = c.lastMessage;
      const otherId = msg.sender.toString() === userId ? msg.receiver : msg.sender;
      const other = await User.findById(otherId).select('name phone role profilePhoto');
      if (!other) return null;
      return {
        conversationId: c._id, otherUser: other, messageCount: c.count,
        lastMessage: msg.type === 'voice' ? '🎤 Voice message' : msg.text, lastTime: msg.createdAt,
      };
    }));
    res.status(200).json({ success: true, conversations: results.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const messages = await Message.find({ conversationId: req.params.conversationId })
      .populate('sender', 'name phone role profilePhoto').populate('receiver', 'name phone role profilePhoto').sort({ createdAt: 1 });
    res.status(200).json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPendingVerifications = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const users = await User.find({ 'idVerification.status': status })
      .select('name phone role profilePhoto idVerification createdAt').sort({ 'idVerification.submittedAt': 1 });
    res.status(200).json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const approveVerification = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.idVerification.status = 'approved';
    user.idVerification.reviewedAt = new Date();
    user.idVerification.reviewedBy = req.user._id;
    user.isVerified = true;
    await user.save();
    res.status(200).json({ success: true, message: 'User verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const rejectVerification = async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.idVerification.status = 'rejected';
    user.idVerification.reviewedAt = new Date();
    user.idVerification.reviewedBy = req.user._id;
    user.idVerification.rejectionReason = reason || 'Document unclear or invalid';
    await user.save();
    res.status(200).json({ success: true, message: 'Verification rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllReports = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const query = status === 'all' ? {} : { status };
    const reports = await Report.find(query)
      .populate('reportedBy', 'name phone profilePhoto role').populate('reportedUser', 'name phone profilePhoto role accountStatus')
      .populate('job', 'title').sort({ createdAt: -1 });
    res.status(200).json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const resolveReport = async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });
    report.status = status;
    report.adminNote = adminNote || '';
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();
    await report.save();
    res.status(200).json({ success: true, message: 'Report updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllJobs = async (req, res) => {
  try {
    const { status, jobType, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status)  query.status = status;
    if (jobType) query.jobType = jobType;
    const skip = (Number(page) - 1) * Number(limit);
    const total = await Job.countDocuments(query);
    const jobs = await Job.find(query).populate('postedBy', 'name phone accountStatus').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    res.status(200).json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteJob = async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Job removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  adminLogin, getDashboardStats,
  getAllUsers, getUserDetail, suspendUser, banUser, reactivateUser,
  updateUserByAdmin, createUserByAdmin, deleteUserByAdmin,
  getUserConversations, getConversationMessages,
  getPendingVerifications, approveVerification, rejectVerification,
  getAllReports, resolveReport,
  getAllJobs, deleteJob,
};
