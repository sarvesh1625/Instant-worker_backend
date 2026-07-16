const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const phoneAwareKey = (req) => {
  const phone = req.body?.phone || 'no-phone';
  return `${ipKeyGenerator(req.ip)}_${phone}`;
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: phoneAwareKey,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' },
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: phoneAwareKey,
  message: { success: false, message: 'Too many OTP requests. Please wait before trying again.' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || 'anonymous',
  message: { success: false, message: 'Too many reports submitted. Please try again later.' },
});

module.exports = { authLimiter, otpLimiter, generalLimiter, reportLimiter };
