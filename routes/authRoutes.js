const express = require('express');
const router  = express.Router();
const {
  register, login, getMe, sendOTP, verifyOTP, sendRegisterOtp,
  verifyWidgetTokenAndRegister, forgotPasswordSendOtp, resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public
router.post('/register-send-otp',         sendRegisterOtp);
router.post('/register',                  register);
router.post('/register-msg91',            verifyWidgetTokenAndRegister); // web widget flow (unchanged)
router.post('/login',                     login);
router.post('/forgot-password-send-otp',  forgotPasswordSendOtp);
router.post('/reset-password',            resetPassword);

// Private
router.get('/me',          protect, getMe);
router.post('/send-otp',   protect, sendOTP);
router.post('/verify-otp', protect, verifyOTP);

module.exports = router;