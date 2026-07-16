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

module.exports = router;
