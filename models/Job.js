const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:    { type: String, required: true },
  skill:    { type: String, required: true },
  description: String,

  location: {
    city: { type: String, required: true },
    area: String,
    lat:  { type: Number, default: null },
    lng:  { type: Number, default: null },

    // FIX: same bug as User.js's worker.location — `default: 'Point'` on
    // the nested `type` field caused EVERY job to get a half-formed point
    // (type set, coordinates missing) on save, which broke the 2dsphere
    // index and threw errors on every applyToJob / accept / start / complete
    // action, not just job creation. Default removed; see the pre-save
    // guard below for extra safety on any already-corrupted documents.
    point: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] },
    },
  },

  jobType: {
    type: String,
    enum: ['regular', 'urgent', 'part_time'],
    default: 'regular',
  },
  urgentWithinHours:     { type: Number, default: 2 },
  urgentNotifiedWorkers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  startDate: String,
  startTime: String,
  duration:  String,

  wage: { type: Number },
  workersNeeded: { type: Number, default: 1 },

  status: {
    type: String,
    enum: ['open', 'in_progress', 'completed', 'closed'],
    default: 'open',
  },

  applicants: [{
    worker:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status:    { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    appliedAt: { type: Date, default: Date.now },

    workStatus: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed'],
      default: 'not_started',
    },
    workStartedAt:   { type: Date },
    workCompletedAt: { type: Date },

    chatUnlocked: { type: Boolean, default: false },
    autoAccepted: { type: Boolean, default: false },
  }],

}, { timestamps: true });

JobSchema.index({ 'location.point': '2dsphere' });

// Same safety net as User.js — strip a half-formed point rather than let
// the whole save fail.
JobSchema.pre('save', function (next) {
  const pt = this.location?.point;
  if (pt && (!Array.isArray(pt.coordinates) || pt.coordinates.length !== 2)) {
    this.location.point = undefined;
  }
  next();
});

module.exports = mongoose.model('Job', JobSchema);