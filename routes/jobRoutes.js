const express = require('express');
const router  = express.Router();
const {
  createJob, getJobs, getUrgentJobs, getJobById, getMyJobs, getMyWork,
  getMyAppliedJobs, getJobHistory,
  applyToJob, updateApplicantStatus, startWork, completeWork,
  closeJob, checkChatAccess,
} = require('../controllers/jobController');
const {
  getMyPaymentOtp, confirmPayment, getOngoing, getPostingStatus,
} = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/auth');
const { optionalAuth } = require('../middleware/optionalAuth');

router.get('/',        optionalAuth, getJobs);
router.get('/urgent',  optionalAuth, getUrgentJobs);

router.post('/',                                             protect, authorize('user'), createJob);
router.get('/my/postings',                                  protect, getMyJobs);
router.get('/my/work',                                       protect, authorize('worker'), getMyWork);
router.get('/my/ongoing',                                   protect, getOngoing);
router.get('/my/posting-status',                            protect, authorize('user'), getPostingStatus);
router.get('/my/applied',                                   protect, authorize('worker'), getMyAppliedJobs);
router.get('/chat-access/:otherUserId',                     protect, checkChatAccess);
router.get('/history',                                       protect, getJobHistory);
router.get('/:id',                                           optionalAuth, getJobById);
router.post('/:id/apply',                                   protect, authorize('worker'), applyToJob);
router.patch('/:id/applicants/:workerId',                   protect, updateApplicantStatus);
router.patch('/:id/applicants/:workerId/start-work',        protect, startWork);
router.patch('/:id/applicants/:workerId/complete-work',     protect, completeWork);
router.get('/:id/payment-otp',                               protect, authorize('worker'), getMyPaymentOtp);
router.post('/:id/applicants/:workerId/confirm-payment',    protect, authorize('user'), confirmPayment);
router.patch('/:id/close',                                  protect, closeJob);

module.exports = router;