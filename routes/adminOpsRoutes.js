const express = require('express');
const router = express.Router();
const c = require('../controllers/adminOpsController');
const x = require('../controllers/adminCancelReviewController');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminAuth');

router.use(protect, adminOnly);

router.get('/overview', c.overview);
router.get('/workers', c.listWorkers);
router.get('/users/:id/full', c.userFull);
router.get('/jobs/:id', c.jobDetail);
router.post('/jobs/:id/close', c.closeJob);
router.post('/payments/:jobId/:workerId/confirm', c.confirmPayment);
router.get('/actions', c.listActions);
router.get('/deletions', c.listDeletions);
router.patch('/deletions/:id', c.reviewDeletion);
router.get('/support/lookup', c.lookup);
router.post('/support/:userId/unlock', c.unlockAccount);
router.post('/support/:userId/clear-code-locks', c.clearCodeLocks);
router.get('/activity', c.activity);
router.get('/training', c.trainingProgress);
router.get('/cancellations', x.listCancellations);
router.patch('/cancellations/:id/waive', x.waiveCancellation);
router.get('/reviews', x.listReviews);
router.patch('/reviews/:id', x.editReview);

module.exports = router;