const express = require('express');
const router  = express.Router();
const {
  getPublicStatus, getPlans, getMySubscription, createCheckout, verifyPayment, handleWebhook, cancelMySubscription,
} = require('../controllers/subscriptionController');
const { protect } = require('../middleware/auth');

router.get('/status', getPublicStatus);
router.get('/plans',  getPlans);
router.post('/webhook', handleWebhook);

router.get('/my',       protect, getMySubscription);
router.post('/checkout',protect, createCheckout);
router.post('/verify',  protect, verifyPayment); // NEW — instant activation on checkout success
router.post('/cancel',  protect, cancelMySubscription);

module.exports = router;