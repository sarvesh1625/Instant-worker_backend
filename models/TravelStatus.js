const mongoose = require('mongoose');

// One row per (job, worker): where the worker is on the way to the job, and whether it was cancelled.
// Kept in its own collection so the Job model does not change.
const TravelStatusSchema = new mongoose.Schema({
  job:    { type: mongoose.Schema.Types.ObjectId, ref: 'Job',  required: true, index: true },
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['on_the_way', 'reached', 'cancelled'], required: true },

  onTheWayAt: { type: Date },
  reachedAt:  { type: Date },

  cancelledAt:  { type: Date },
  cancelledBy:  { type: String, enum: ['worker', 'poster'] },
  cancelReason: { type: String, maxlength: 200 },
  // true = cancelled AFTER the worker had said "on the way" / "reached" (these are the ones that matter).
  lateCancel:   { type: Boolean, default: false },
  cancelledById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },   // whoever pressed Cancel

  // An admin can waive a late cancel (it stops counting towards the pause).
  waivedAt: { type: Date },
  waivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

TravelStatusSchema.index({ job: 1, worker: 1 }, { unique: true });
TravelStatusSchema.index({ lateCancel: 1, cancelledAt: -1 });

module.exports = mongoose.model('TravelStatus', TravelStatusSchema);