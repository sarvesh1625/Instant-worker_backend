const mongoose = require('mongoose');

// Audit log: everything an admin does that changes something (or reads private chats).
const adminActionSchema = new mongoose.Schema({
  admin:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, index: true },
  targetType: { type: String, default: '' },     // 'job' | 'user' | 'chat' | 'deletion' ...
  targetId:   { type: String, default: '' },
  summary: { type: String, default: '' },
  reason:  { type: String, default: '' },
  meta:    { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('AdminAction', adminActionSchema);