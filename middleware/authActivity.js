const AuthEvent = require('../models/AuthEvent');
const UserStats = require('../models/UserStats');
const User = require('../models/User');

// Mount BEFORE the /api/auth router:  app.use('/api/auth', require('./middleware/authActivity'));
// It never changes the response; it only watches what happened and records it after the reply is sent.
const MAP = {
  '/login': 'login',
  '/register': 'register',
  '/register-msg91': 'register',
  '/forgot-password-send-otp': 'forgot_password',
  '/reset-password': 'reset_password',
  '/reset-password-msg91': 'reset_password',
};

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

module.exports = (req, res, next) => {
  const type = req.method === 'POST' ? MAP[req.path] : null;
  if (!type) return next();
  const phoneIn = onlyDigits(req.body && (req.body.phone || req.body.mobile)).slice(-10);

  res.on('finish', async () => {
    try {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      let user = null;
      if (phoneIn) user = await User.findOne({ phone: new RegExp(phoneIn + '$') }).select('_id phone');
      await AuthEvent.create({
        type, success, phone: phoneIn, user: user && user._id, ip,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      });
      if (!user) return;
      const inc = {}, set = {};
      if (type === 'login') {
        if (success) { inc.loginCount = 1; set.lastLoginAt = new Date(); set.lastLoginIp = ip; }
        else inc.failedLoginCount = 1;
      } else if (type === 'forgot_password' && success) {
        inc.forgotPasswordCount = 1; set.lastForgotAt = new Date();
      }
      if (Object.keys(inc).length || Object.keys(set).length) {
        const upd = {};
        if (Object.keys(inc).length) upd.$inc = inc;
        if (Object.keys(set).length) upd.$set = set;
        await UserStats.updateOne({ user: user._id }, upd, { upsert: true });
      }
    } catch (e) { /* logging must never break the app */ }
  });
  next();
};