const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:    { type: String, required: true },
  skill:    { type: String, required: true },
  description: String,

  location: {
    city: { type: String, required: true },
    area: String,
    // GPS coordinates of the actual worksite — kept as plain numbers too
    // (not just inside `point`) because LiveTrackingMap.jsx and other
    // existing code reads job.location.lat/lng directly.
    lat:  { type: Number, default: null },
    lng:  { type: Number, default: null },

    // GeoJSON Point — required by MongoDB's 2dsphere index for $geoNear /
    // $nearSphere radius queries. Derived automatically from lat/lng
    // whenever they're provided (see jobController.createJob). Coordinates
    // are [longitude, latitude] — MongoDB's convention, NOT [lat, lng].
    point: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
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

// Enables $geoNear / $nearSphere radius queries on job worksite location.
JobSchema.index({ 'location.point': '2dsphere' });

module.exports = mongoose.model('Job', JobSchema);