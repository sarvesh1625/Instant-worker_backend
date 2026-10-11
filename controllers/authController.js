const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { sendOtp, verifyOtp, normalizePhone } = require('../services/otpService');

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

const sendFailure = (res, err) =>
  res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Could not send OTP' });

// ── Registration OTP (real SMS via MSG91) ────────────────────────────────────
const sendRegisterOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });
    }
    if (await User.findOne({ phone })) {
      return res.status(400).json({ success: false, message: 'This number is already registered. Please login instead.' });
    }

    const r = await sendOtp(phone, 'reg');
    if (!r.sent) {
      return res.status(429).json({
        success: false,
        message: r.reason === 'cooldown' ? 'Please wait 30 seconds before requesting another OTP.'
                                         : 'Too many OTP requests for this number. Try again in an hour.',
      });
    }
    res.status(200).json({ success: true, message: 'OTP sent to your mobile number', ...(r.devCode && { otp_dev: r.devCode }) });
  } catch (error) {
    sendFailure(res, error);
  }
};

const register = async (req, res) => {
  try {
    const { name, email, password, role, otp } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });
    if (!otp)   return res.status(400).json({ success: false, message: 'OTP is required' });

    if (await User.findOne({ phone })) {
      return res.status(400).json({ success: false, message: 'Phone already registered' });
    }

    const v = await verifyOtp(phone, 'reg', otp);
    if (!v.ok) return res.status(400).json({ success: false, message: v.message });

    const user = await User.create({ name, phone, email, password, role, isVerified: true });
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, phone: user.phone, role: user.role, isVerified: user.isVerified },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── OTP delivery (NEW — MSG91 widget flow) ───────────────────────────────────
// The client-side widget (Msg91OtpWidget.jsx) handles sending/entering the
// OTP entirely in its own popup, and hands back a verified access token.
// This endpoint takes that token, verifies it SERVER-SIDE against MSG91
// using the account authkey (never exposed to the browser), extracts the
// MSG91-confirmed phone number, and only then creates the account.
//
// ⚠️ Confirm the exact response field name MSG91 returns the verified number
// under (commonly `message`, sometimes nested) against your live dashboard
// response before relying on this in production — test with a real OTP run
// and console.log the raw response once to be certain.
const verifyWidgetTokenAndRegister = async (req, res) => {
  try {
    const { accessToken, name, password, role, email } = req.body;

    if (!accessToken) {
      return res.status(400).json({ success: false, message: 'Missing verification token' });
    }
    if (!process.env.MSG91_AUTHKEY) {
      return res.status(500).json({ success: false, message: 'Server is not configured for phone verification. Contact support.' });
    }

    // ── Verify the token with MSG91 — this is the step that actually
    // proves the OTP was really sent and really verified, not just trusted
    // from the browser. ──
    let verifiedPhone;
    try {
      const msgRes = await axios.post('https://control.msg91.com/api/v5/widget/verifyAccessToken', {
        authkey: process.env.MSG91_AUTHKEY,
        'access-token': accessToken,
      });

      if (msgRes.data?.type !== 'success') {
        // Log the RAW response so we can see exactly what MSG91 said —
        // this was previously silent, which is why the client only ever
        // saw a generic "Phone verification failed" message.
        console.error('MSG91 verifyAccessToken rejected:', JSON.stringify(msgRes.data));
        return res.status(400).json({
          success: false,
          message: `Phone verification failed: ${msgRes.data?.message || 'unknown reason from MSG91'}`,
        });
      }

      // MSG91 typically returns the verified identifier (often prefixed
      // with country code, e.g. "9199XXXXXXXX") in `message`. Strip a
      // leading "91" country code if present, to match this app's
      // 10-digit phone storage format.
      let raw = String(msgRes.data.message || '').trim();
      verifiedPhone = raw.length === 12 && raw.startsWith('91') ? raw.slice(2) : raw;

      if (!/^\d{10}$/.test(verifiedPhone)) {
        console.error('MSG91 verify succeeded but phone could not be parsed. Raw response:', JSON.stringify(msgRes.data));
        return res.status(400).json({ success: false, message: 'Could not read a valid verified phone number from MSG91.' });
      }
    } catch (msgErr) {
      console.error('MSG91 verify error:', msgErr.response?.data || msgErr.message);
      return res.status(502).json({ success: false, message: 'Could not reach verification service. Please try again.' });
    }

    // ── Now proceed exactly like the old register(), but using the
    // SERVER-VERIFIED phone number — never a client-supplied one. ──
    const existing = await User.findOne({ phone: verifiedPhone });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This number is already registered. Please login instead.' });
    }
    if (!name || !password || !role) {
      return res.status(400).json({ success: false, message: 'Name, password, and role are required' });
    }

    const user = await User.create({
      name, phone: verifiedPhone, email, password, role,
      isVerified: true,
    });
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'Phone and password are required' });
    }

    const user = await User.findOne({ phone }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.isLocked()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Too many failed attempts. Account locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`,
        locked: true,
        retryAfterMinutes: minutesLeft,
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await user.incrementLoginAttempts();

      if (user.isLocked()) {
        return res.status(423).json({
          success: false,
          message: 'Too many failed attempts. Account locked for 15 minutes.',
          locked: true,
        });
      }

      const attemptsLeft = 5 - user.loginAttempts;
      return res.status(401).json({
        success: false,
        message: `Invalid credentials. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining before lockout.`,
      });
    }

    await user.resetLoginAttempts();

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Logged-in re-verification of the user's OWN number (phone comes from the token, not the body)
const sendOTP = async (req, res) => {
  try {
    const r = await sendOtp(req.user.phone, 'verify');
    if (!r.sent) return res.status(429).json({ success: false, message: 'Please wait before requesting another OTP.' });
    res.status(200).json({ success: true, message: 'OTP sent' });
  } catch (error) {
    sendFailure(res, error);
  }
};

const verifyOTP = async (req, res) => {
  try {
    const v = await verifyOtp(req.user.phone, 'verify', req.body.otp);
    if (!v.ok) return res.status(400).json({ success: false, message: v.message });
    await User.updateOne({ _id: req.user._id }, { $set: { isVerified: true } });
    res.status(200).json({ success: true, message: 'Phone verified successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Forgot password ──────────────────────────────────────────────────────────
// Always answers the same way whether or not the number is registered.
const forgotPasswordSendOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });

    const user = await User.findOne({ phone }).select('_id');
    let sent;
    if (user) {
      try { sent = await sendOtp(phone, 'reset'); }
      catch (e) { return sendFailure(res, e); }   // delivery problem is not account-specific, safe to report
    }
    res.status(200).json({ success: true, message: 'If that number is registered, an OTP has been sent.', ...(sent?.devCode && { otp_dev: sent.devCode }) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not send OTP' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { otp, newPassword } = req.body;

    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ phone });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Request a new one.' });

    const v = await verifyOtp(phone, 'reset', otp);
    if (!v.ok) return res.status(400).json({ success: false, message: v.message });

    user.password = newPassword; // pre-save hook hashes it
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  register, login, getMe, sendOTP, verifyOTP, sendRegisterOtp,
  verifyWidgetTokenAndRegister,
  forgotPasswordSendOtp, resetPassword,
};