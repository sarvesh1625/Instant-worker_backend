const express = require('express');
const router  = express.Router();
const {
  register, login, getMe, sendOTP, verifyOTP, sendRegisterOtp,
  verifyWidgetTokenAndRegister,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public
router.post('/register-send-otp', sendRegisterOtp); // LEGACY custom-OTP flow, step 1
router.post('/register',          register);        // LEGACY custom-OTP flow, step 2
router.post('/register-msg91',    verifyWidgetTokenAndRegister); // NEW — MSG91 widget flow
router.post('/login',             login);

// Private
router.get('/me',          protect, getMe);
router.post('/send-otp',   protect, sendOTP);
router.post('/verify-otp', protect, verifyOTP);

module.exports = router;