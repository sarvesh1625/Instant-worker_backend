const express = require('express');
const router  = express.Router();
const {
  register, login, getMe, sendOTP, verifyOTP, sendRegisterOtp,
  verifyWidgetTokenAndRegister, forgotPasswordSendOtp, resetPassword, resetPasswordWithWidget,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public
router.post('/register-send-otp',         sendRegisterOtp);
// /register accepts either {otp} (test mode) or {accessToken} (MSG91 widget, used by the mobile app)
router.post('/register', (req, res, next) =>
  (req.body && req.body.accessToken ? verifyWidgetTokenAndRegister(req, res, next) : register(req, res, next)));
router.post('/register-msg91',            verifyWidgetTokenAndRegister); // web widget flow (unchanged)
router.post('/login',                     login);
router.post('/forgot-password-send-otp',  forgotPasswordSendOtp);
router.post('/reset-password',            resetPassword);
router.post('/reset-password-msg91',     resetPasswordWithWidget); // widget flow (mobile + web)

// Private
router.get('/me',          protect, getMe);
router.post('/send-otp',   protect, sendOTP);
router.post('/verify-otp', protect, verifyOTP);

module.exports = router;