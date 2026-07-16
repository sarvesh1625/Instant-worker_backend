const express = require('express');
const router  = express.Router();
const { submitVerification, getMyVerificationStatus, upload } = require('../controllers/verificationController');
const { protect } = require('../middleware/auth');

router.get('/status', protect, getMyVerificationStatus);
router.post(
  '/submit',
  protect,
  upload.fields([{ name: 'documentPhoto', maxCount: 1 }, { name: 'selfiePhoto', maxCount: 1 }]),
  submitVerification
);

module.exports = router;
