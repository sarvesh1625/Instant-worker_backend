const mongoose = require('mongoose');

// One document per (purpose, phone). `phone` holds "<purpose>:<10 digits>"
// (e.g. "reg:9876543210", "reset:9876543210") so no index migration is needed.
// `code` stores an HMAC of the OTP, never the OTP itself.
const otpSchema = new mongoose.Schema({
  phone:         { type: String, required: true, unique: true, trim: true },
  code:          { type: String, required: true },
  reqId:         { type: String, default: null }, // MSG91 widget request id (widget mode only)
  attempts:      { type: Number, default: 0 },
  codeExpiresAt: { type: Date },                 // when the current code stops working
  lastSentAt:    { type: Date },                 // resend cooldown
  sendCount:     { type: Number, default: 0 },   // sends inside the current 1-hour window
  expiresAt:     { type: Date, required: true }, // TTL: document removed 1 hour after first send
}, { timestamps: true });

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);