const mongoose = require('mongoose');

const deletionRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  reason: { type: String, maxlength: 500, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
  reviewedAt:  { type: Date },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  adminNote:   { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('DeletionRequest', deletionRequestSchema);
