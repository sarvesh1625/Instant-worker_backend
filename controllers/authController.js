const User = require('../models/User');
const Otp  = require('../models/Otp');
const jwt = require('jsonwebtoken');
const axios = require('axios'); // NEW dependency — run `npm install axios` in /server

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// ── OTP delivery (LEGACY custom-OTP flow) ────────────────────────────────────
// Superseded by the MSG91 widget flow below (verifyWidgetTokenAndRegister),
// but left in place since Otp.js and the /verify-otp re-verification route
// for EXISTING users still use it. Safe to keep both systems running.
const isTestMode = () => process.env.OTP_MODE !== 'production';

const sendRegisterOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || !/^\d{10}$/.test(phone.trim())) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });
    }

    const existing = await User.findOne({ phone: phone.trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This number is already registered. Please login instead.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { phone: phone.trim() },
      { phone: phone.trim(), code, attempts: 0, expiresAt },
      { upsert: true, new: true }
    );

    if (isTestMode()) {
      console.log(`[TEST MODE] Registration OTP for ${phone}: ${code}`);
      return res.status(200).json({ success: true, message: 'OTP sent (test mode)', otp_dev: code });
    }

    res.status(200).json({ success: true, message: 'OTP sent to your mobile number' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const register = async (req, res) => {
  try {
    const { name, phone, email, password, role, otp } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP is required' });
    }

    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Phone already registered' });
    }

    const otpDoc = await Otp.findOne({ phone: phone?.trim() });

    if (!otpDoc) {
      return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }
    if (otpDoc.expiresAt < Date.now()) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }
    if (otpDoc.attempts >= 5) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ success: false, message: 'Too many wrong attempts. Please request a new OTP.' });
    }
    if (otpDoc.code !== otp.trim()) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      const left = 5 - otpDoc.attempts;
      return res.status(400).json({
        success: false,
        message: `Wrong OTP. ${left} attempt${left !== 1 ? 's' : ''} remaining.`,
      });
    }

    await Otp.deleteOne({ _id: otpDoc._id });

    const user = await User.create({
      name, phone, email, password, role,
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

const sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await User.findOneAndUpdate({ phone }, { otp: { code: otp, expiresAt } });

    if (isTestMode()) {
      console.log(`[TEST MODE] OTP for ${phone}: ${otp}`);
      return res.status(200).json({ success: true, message: 'OTP sent (test mode)', otp_dev: otp });
    }

    res.status(200).json({ success: true, message: 'OTP sent' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const user = await User.findOne({ phone });

    if (!user || !user.otp || !user.otp.code) {
      return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
    }
    if (user.otp.code !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    if (user.otp.expiresAt < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Request a new one.' });
    }

    user.isVerified = true;
    user.otp = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Phone verified successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  register, login, getMe, sendOTP, verifyOTP, sendRegisterOtp,
  verifyWidgetTokenAndRegister,
};