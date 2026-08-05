const express = require('express');
const router  = express.Router();
const {
  adminLogin, getDashboardStats,
  getAllUsers, getUserDetail, suspendUser, banUser, reactivateUser,
  updateUserByAdmin, createUserByAdmin, deleteUserByAdmin,
  getUserConversations, getConversationMessages,
  getPendingVerifications, approveVerification, rejectVerification,
  getAllReports, resolveReport,
  getAllJobs, deleteJob,
} = require('../controllers/adminController');
const {
  getAllSkillsAdmin, createSkill, updateSkill, deleteSkill,
} = require('../controllers/skillController');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminAuth');

router.post('/login', adminLogin);
router.use(protect, adminOnly);

router.get('/dashboard', getDashboardStats);

router.get('/users',                     getAllUsers);
router.post('/users',                    createUserByAdmin);
router.get('/users/:id',                 getUserDetail);
router.put('/users/:id',                 updateUserByAdmin);
router.delete('/users/:id',              deleteUserByAdmin);
router.patch('/users/:id/suspend',       suspendUser);
router.patch('/users/:id/ban',           banUser);
router.patch('/users/:id/reactivate',    reactivateUser);
router.get('/users/:id/conversations',   getUserConversations);

router.get('/chat/:conversationId', getConversationMessages);

router.get('/verifications',                        getPendingVerifications);
router.patch('/verifications/:userId/approve',       approveVerification);
router.patch('/verifications/:userId/reject',        rejectVerification);

router.get('/reports',               getAllReports);
router.patch('/reports/:id/resolve', resolveReport);

router.get('/jobs',        getAllJobs);
router.delete('/jobs/:id', deleteJob);

// NEW — skill management
router.get('/skills',           getAllSkillsAdmin);
router.post('/skills',          createSkill);
router.patch('/skills/:id',     updateSkill);
router.delete('/skills/:id',    deleteSkill);

module.exports = router;