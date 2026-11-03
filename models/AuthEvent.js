const mongoose = require('mongoose');

// One row per login / register / forgot-password / reset attempt. Auto-deleted after 90 days.
const authEventSchema = new mongoose.Schema({
  type:    { type: String, enum: ['login', 'register', 'forgot_password', 'reset_password'], required: true, index: true },
  success: { type: Boolean, default: false },
  phone:   { type: String, default: '', index: true },
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  ip:      { type: String, default: '' },
  userAgent: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 90 },
});

module.exports = mongoose.model('AuthEvent', authEventSchema);