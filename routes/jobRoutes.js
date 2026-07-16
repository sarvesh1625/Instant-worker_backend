const express = require('express');
const router  = express.Router();
const {
  createJob, getJobs, getUrgentJobs, getJobById, getMyJobs, getMyWork,
  getMyAppliedJobs, getJobHistory,
  applyToJob, updateApplicantStatus, startWork, completeWork,
  closeJob, checkChatAccess,
} = require('../controllers/jobController');
const { protect, authorize } = require('../middleware/auth');

router.get('/',                                             getJobs);
router.get('/urgent',                                       getUrgentJobs);
router.post('/',                                            protect, authorize('user'), createJob);
router.get('/my/postings',                                  protect, getMyJobs);
router.get('/my/work',                                      protect, authorize('worker'), getMyWork);
router.get('/my/applied',                                   protect, authorize('worker'), getMyAppliedJobs);
router.get('/chat-access/:otherUserId',                     protect, checkChatAccess);
router.get('/history',                                      protect, getJobHistory);
router.get('/:id',                                          getJobById);
router.post('/:id/apply',                                   protect, authorize('worker'), applyToJob);
router.patch('/:id/applicants/:workerId',                   protect, updateApplicantStatus);
router.patch('/:id/applicants/:workerId/start-work',        protect, startWork);
router.patch('/:id/applicants/:workerId/complete-work',     protect, completeWork);
router.patch('/:id/close',                                  protect, closeJob);

module.exports = router;
