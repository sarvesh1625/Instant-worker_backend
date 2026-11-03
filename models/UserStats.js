const mongoose = require('mongoose');

// Lifetime counters per user. Counting starts the day this is deployed (older history is not recorded anywhere).
const userStatsSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  loginCount: { type: Number, default: 0 },
  failedLoginCount: { type: Number, default: 0 },
  forgotPasswordCount: { type: Number, default: 0 },
  lastLoginAt: { type: Date },
  lastLoginIp: { type: String, default: '' },
  lastForgotAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('UserStats', userStatsSchema);