const mongoose = require('mongoose');

// One row per user per version of the Terms + Privacy Policy that they accepted.
// This is the proof that "this person accepted version X on date Y".
const consentSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  version:    { type: String, required: true },          // e.g. '2026-11-03' (legalConfig.js → version)
  documents:  { type: [String], default: ['terms', 'privacy'] },
  source:     { type: String, enum: ['app', 'web'], default: 'app' },
  ip:         { type: String, default: '' },
  acceptedAt: { type: Date, default: Date.now },
}, { timestamps: true });

consentSchema.index({ user: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('Consent', consentSchema);