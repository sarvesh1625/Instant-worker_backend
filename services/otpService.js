const crypto = require('crypto');
const axios  = require('axios');
const Otp    = require('../models/Otp');

const CODE_TTL_MS   = 10 * 60 * 1000; // code valid 10 min
const COOLDOWN_MS   = 30 * 1000;      // min gap between sends to same number
const WINDOW_MS     = 60 * 60 * 1000; // send-count window
const MAX_SENDS     = 5;              // per number, per purpose, per window
const MAX_ATTEMPTS  = 5;              // wrong guesses per code

const normalizePhone = (p) => {
  if (typeof p !== 'string') return null;       // blocks {"$ne":""} style payloads
  const s = p.trim();
  return /^\d{10}$/.test(s) ? s : null;
};

const keyOf = (purpose, phone) => `${purpose}:${phone}`;
const hash  = (key, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${key}:${code}`).digest('hex');

// 'dev'  -> no SMS, code printed in SERVER console only (never in the API response)
// anything else (incl. unset) -> real SMS via MSG91, and fails closed if not configured
const isDevMode  = () => process.env.OTP_MODE === 'dev';
// 'test' -> TEMPORARY, for closed testing only: no SMS, code is RETURNED in the API response
// (app shows it in the yellow box). Anyone can reset any account's password in this mode.
const isTestMode = () => process.env.OTP_MODE === 'test';

async function sendSms(phone, code) {
  const { MSG91_AUTHKEY, MSG91_TEMPLATE_ID } = process.env;
  if (!MSG91_AUTHKEY) {
    const e = new Error('SMS service is not configured'); e.status = 500; throw e;
  }
  try {
    const r = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      { OTP: code },                       // template variable ##OTP##
      {
        params: {
          ...(MSG91_TEMPLATE_ID && { template_id: MSG91_TEMPLATE_ID }), // optional: MSG91 default template if unset
          mobile: `91${phone}`,
          otp: code,                       // our own code, so we can verify it ourselves
          otp_expiry: Math.round(CODE_TTL_MS / 60000),
        },
        headers: { authkey: MSG91_AUTHKEY, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    if (r.data?.type !== 'success') {
      console.error('MSG91 send rejected:', JSON.stringify(r.data));
      const e = new Error('Could not send SMS. Please try again.'); e.status = 502; throw e;
    }
  } catch (err) {
    if (err.status) throw err;
    console.error('MSG91 send error:', err.response?.data || err.message);
    const e = new Error('Could not send SMS. Please try again.'); e.status = 502; throw e;
  }
}

/**
 * Create + send an OTP.
 * Returns { sent: true } or { sent: false, reason: 'cooldown'|'limit' }.
 * Throws {status,message} if SMS delivery fails.
 */
async function sendOtp(phone, purpose) {
  const key = keyOf(purpose, phone);
  const now = Date.now();
  const doc = await Otp.findOne({ phone: key });

  if (doc) {
    if (doc.lastSentAt && now - doc.lastSentAt.getTime() < COOLDOWN_MS) return { sent: false, reason: 'cooldown' };
    if (doc.sendCount >= MAX_SENDS) return { sent: false, reason: 'limit' };
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const prev = doc ? { lastSentAt: doc.lastSentAt, sendCount: doc.sendCount } : null;

  await Otp.findOneAndUpdate(
    { phone: key },
    {
      $set: {
        code: hash(key, code), attempts: 0,
        codeExpiresAt: new Date(now + CODE_TTL_MS), lastSentAt: new Date(now),
        ...(doc ? {} : { expiresAt: new Date(now + WINDOW_MS) }),
      },
      $inc: { sendCount: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    if (isTestMode()) console.warn(`[OTP TEST MODE - INSECURE] ${purpose} ${phone}: ${code}`);
    else if (isDevMode()) console.log(`[OTP dev] ${purpose} ${phone}: ${code}`);
    else await sendSms(phone, code);
  } catch (err) {
    // SMS failed -> don't burn the user's cooldown / quota
    if (prev) await Otp.updateOne({ phone: key }, { $set: { lastSentAt: prev.lastSentAt, sendCount: prev.sendCount } });
    else await Otp.deleteOne({ phone: key });
    throw err;
  }
  return isTestMode() ? { sent: true, devCode: code } : { sent: true };
}

/** Check a code. Consumes it on success. Returns { ok:true } or { ok:false, message }. */
async function verifyOtp(phone, purpose, code) {
  const key = keyOf(purpose, phone);
  const c = typeof code === 'string' ? code.trim() : '';
  if (!/^\d{6}$/.test(c)) return { ok: false, message: 'Enter the 6-digit OTP' };

  const doc = await Otp.findOne({ phone: key });
  if (!doc || !doc.codeExpiresAt) return { ok: false, message: 'No OTP found. Please request a new one.' };
  if (doc.codeExpiresAt.getTime() < Date.now()) return { ok: false, message: 'OTP expired. Please request a new one.' };
  if (doc.attempts >= MAX_ATTEMPTS) return { ok: false, message: 'Too many wrong attempts. Please request a new OTP.' };

  const a = Buffer.from(hash(key, c)), b = Buffer.from(doc.code);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    // atomic increment so parallel guesses can't dodge the limit
    const upd = await Otp.findOneAndUpdate({ phone: key }, { $inc: { attempts: 1 } }, { new: true });
    const left = Math.max(0, MAX_ATTEMPTS - (upd?.attempts ?? MAX_ATTEMPTS));
    return { ok: false, message: left ? `Wrong OTP. ${left} attempt${left !== 1 ? 's' : ''} remaining.` : 'Too many wrong attempts. Please request a new OTP.' };
  }

  // consume atomically: only one request can win
  const del = await Otp.deleteOne({ _id: doc._id, code: doc.code });
  if (del.deletedCount !== 1) return { ok: false, message: 'OTP already used. Please request a new one.' };
  return { ok: true };
}

module.exports = { sendOtp, verifyOtp, normalizePhone };