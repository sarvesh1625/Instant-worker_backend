const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { sendOtp, verifyOtp, normalizePhone, otpLength } = require('../services/otpService');

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// Only these two roles can be created through sign-up. (Before this, whatever "role" the request
// carried was saved as-is, so anyone could have registered themselves as an admin.)
const ALLOWED_ROLES = ['worker', 'user'];

// Skills a worker picked: a list of short plain-text names (built-in ones and any typed under "Other").
const cleanSkills = (input) => {
  const arr = Array.isArray(input) ? input : (typeof input === 'string' && input ? [input] : []);
  const out = [], seen = new Set();
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const s = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= 8) break;
  }
  return out;
};
// worker.skill = the first pick (main skill, used by job matching today); worker.skills = all picks.
const workerFields = (role, body) => {
  if (role !== 'worker') return {};
  const skills = cleanSkills(Array.isArray(body.skills) && body.skills.length ? body.skills : body.skill);
  return skills.length ? { worker: { skill: skills[0], skills } } : {};
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
    res.status(200).json({ success: true, message: 'OTP sent to your mobile number', otpLength: otpLength(), ...(r.devCode && { otp_dev: r.devCode }) });
  } catch (error) {
    sendFailure(res, error);
  }
};

const register = async (req, res) => {
  try {
    const { name, email, password, role, otp } = req.body;
    if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ success: false, message: 'Choose whether you want work or want to hire' });
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });
    if (!otp)   return res.status(400).json({ success: false, message: 'OTP is required' });

    if (await User.findOne({ phone })) {
      return res.status(400).json({ success: false, message: 'Phone already registered' });
    }

    const v = await verifyOtp(phone, 'reg', otp);
    if (!v.ok) return res.status(400).json({ success: false, message: v.message });

    const user = await User.create({ name, phone, email, password, role, isVerified: true, ...workerFields(role, req.body) });
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

// ── MSG91 widget flow (web widget AND mobile app widget) ─────────────────────
// The client runs the OTP flow with MSG91 directly and gets back an access
// token. The server never trusts a client-supplied phone: it verifies the token
// with MSG91 (using the secret authkey) and takes the phone from MSG91's answer.
const decodeJwtPayload = (t) => {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
};
const to10 = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  const n = d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
  return /^\d{10}$/.test(n) ? n : null;
};

async function phoneFromWidgetToken(accessToken) {
  const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };
  if (typeof accessToken !== 'string' || !accessToken) throw fail(400, 'Missing verification token');
  const authkey = String(process.env.MSG91_AUTHKEY || '').trim();   // a stray space/newline from copy-paste breaks it
  if (!authkey) throw fail(500, 'Server is not configured for phone verification. Contact support.');

  // Documented form first (api.msg91.com, authkey in the header); the older form (control host, authkey in body) as a fallback.
  const attempts = [
    () => axios.post('https://api.msg91.com/api/v5/widget/verifyAccessToken', { 'access-token': accessToken },
      { headers: { authkey, 'Content-Type': 'application/json' }, timeout: 10000, validateStatus: () => true }),
    () => axios.post('https://control.msg91.com/api/v5/widget/verifyAccessToken', { authkey, 'access-token': accessToken },
      { timeout: 10000, validateStatus: () => true }),
  ];
  let data, lastErr;
  for (const go of attempts) {
    try {
      const r = await go();
      data = (r.data && typeof r.data === 'object') ? r.data : { type: 'error', message: `HTTP ${r.status}` };
      if (data.type === 'success') break;
    } catch (err) { lastErr = err; }
  }
  if (!data) {
    console.error('MSG91 verify error:', lastErr?.message);
    throw fail(502, 'Could not reach verification service. Please try again.');
  }

  if (data?.type !== 'success') {
    console.error('MSG91 verifyAccessToken rejected:', JSON.stringify(data), `| server authkey: ${authkey.length} chars, starts "${authkey.slice(0, 6)}", ends "${authkey.slice(-4)}"`);
    throw fail(400, `Phone verification failed: ${data?.message || 'unknown reason from MSG91'}`);
  }

  // Where MSG91 puts the verified number can vary: try the response, then the (already
  // MSG91-validated) token's own payload. If none yields a phone we FAIL CLOSED.
  const p = decodeJwtPayload(accessToken) || {};
  const phone = [data.message, data.identifier, data.mobile, data.data?.identifier, data.data?.mobile,
                 p.identifier, p.mobile, p.mobileNumber, p.phone, p.number]
    .map(to10).find(Boolean);
  if (!phone) {
    console.error('MSG91 verify OK but no phone found. RAW:', JSON.stringify(data), 'TOKEN KEYS:', Object.keys(p));
    throw fail(400, 'Could not read the verified phone number. Please contact support.');
  }
  return phone;
}

const widgetFailure = (res, err) =>
  res.status(err.status || 500).json({ success: false, message: err.message });

const verifyWidgetTokenAndRegister = async (req, res) => {
  try {
    const { accessToken, name, password, role, email } = req.body;
    const phone = await phoneFromWidgetToken(accessToken);

    if (await User.findOne({ phone })) {
      return res.status(400).json({ success: false, message: 'This number is already registered. Please login instead.' });
    }
    if (!name || !password || !role) {
      return res.status(400).json({ success: false, message: 'Name, password, and role are required' });
    }
    if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ success: false, message: 'Choose whether you want work or want to hire' });

    const user = await User.create({ name, phone, email, password, role, isVerified: true, ...workerFields(role, req.body) });
    const token = generateToken(user._id);
    res.status(201).json({
      success: true, token,
      user: { _id: user._id, name: user.name, phone: user.phone, role: user.role, isVerified: user.isVerified },
    });
  } catch (error) {
    widgetFailure(res, error);
  }
};

// Forgot password via widget: token proves the phone; no OTP is stored on our side.
const resetPasswordWithWidget = async (req, res) => {
  try {
    const { accessToken, newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const phone = await phoneFromWidgetToken(accessToken);

    const user = await User.findOne({ phone });
    if (!user) return res.status(400).json({ success: false, message: 'No account found for this number.' });

    user.password = newPassword;
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();
    res.status(200).json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (error) {
    widgetFailure(res, error);
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
    res.status(200).json({ success: true, message: 'If that number is registered, an OTP has been sent.', otpLength: otpLength(), ...(sent?.devCode && { otp_dev: sent.devCode }) });
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
  forgotPasswordSendOtp, resetPassword, resetPasswordWithWidget,
  _cleanSkills: cleanSkills,
};