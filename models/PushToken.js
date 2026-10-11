const mongoose = require('mongoose');

// One row per phone (Expo push token). A phone that logs into a different account
// simply gets re-pointed at the new user (token is unique).
const pushTokenSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token:     { type: String, required: true, unique: true },
  lang:      { type: String, enum: ['en', 'hi', 'te'], default: 'en' },
  platform:  { type: String, default: 'android' },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PushToken', pushTokenSchema);