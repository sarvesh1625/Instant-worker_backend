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
const { getSettings, toggleSubscriptions } = require('../controllers/platformSettingsController');
// const {
//   getAllPlansAdmin, createPlan, updatePlan, deactivatePlan, getAllSubscriptions, grantSubscription,
// } = require('../controllers/adminSubscriptionController');

const {
  getAllPlansAdmin, createPlan, updatePlan, deactivatePlan, getAllSubscriptions, grantSubscription,
  adminCancelSubscription, getLeaderboard,
} = require('../controllers/adminSubscriptionController');


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
router.get('/settings',              getSettings);
router.patch('/settings/subscriptions', toggleSubscriptions);

router.get('/subscriptions/plans',      getAllPlansAdmin);
router.post('/subscriptions/plans',     createPlan);
router.patch('/subscriptions/plans/:id',updatePlan);
router.delete('/subscriptions/plans/:id',deactivatePlan);
router.get('/subscriptions',            getAllSubscriptions);
router.post('/subscriptions/grant',     grantSubscription);
router.post('/subscriptions/:id/cancel', adminCancelSubscription);
router.get('/leaderboard', getLeaderboard);

module.exports = router;