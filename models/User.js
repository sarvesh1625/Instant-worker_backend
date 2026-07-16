const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  phone:    { type: String, required: true, unique: true, trim: true },
  email:    { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },

  role: { type: String, enum: ['worker', 'user', 'admin'], required: true },

  profilePhoto:      { type: String, default: '' },
  age:               { type: Number, min: 18, max: 70 },
  gender:            { type: String, enum: ['male', 'female', 'other', ''] },
  city:              { type: String, default: '' },
  area:              { type: String, default: '' },
  state:             { type: String, default: '' },
  bio:               { type: String, maxlength: 300, default: '' },
  languages:         [String],
  isVerified:        { type: Boolean, default: false },
  isProfileComplete: { type: Boolean, default: false },

  accountStatus: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
  suspendedReason: { type: String, default: '' },
  suspendedAt:     { type: Date },
  suspendedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  loginAttempts: { type: Number, default: 0 },
  lockUntil:     { type: Date, default: null },

  idVerification: {
    status: { type: String, enum: ['not_submitted', 'pending', 'approved', 'rejected'], default: 'not_submitted' },
    idType:          { type: String, enum: ['aadhaar', 'voter', 'pan', 'driving', ''], default: '' },
    idNumber:        { type: String, default: '' },
    documentPhoto:   { type: String, default: '' },
    selfiePhoto:     { type: String, default: '' },
    submittedAt:     { type: Date },
    reviewedAt:      { type: Date },
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, default: '' },
  },

  // ── Worker-specific profile ───────────────────────────────────────────────
  worker: {
    skill:         { type: String, default: '' },
    skills:        [String],
    experience:    { type: Number, default: 0 },
    wagePerDay:    { type: Number, default: 0 },
    availability:  { type: Boolean, default: true },
    rating: { average: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    totalJobsDone: { type: Number, default: 0 },

    // GeoJSON Point — worker's current/last-known position, captured via
    // browser geolocation (see PATCH /api/workers/location). Used for
    // radius-based job matching. [lng, lat] per MongoDB's convention.
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: undefined },
    },
    locationUpdatedAt: { type: Date }, // lets the app judge staleness later if needed
  },

  // ── User (job poster) profile ─────────────────────────────────────────────
  poster: {
    rating: { average: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    totalJobsPosted: { type: Number, default: 0 },
    totalHired:      { type: Number, default: 0 },
  },

  otp: { code: String, expiresAt: Date },

}, { timestamps: true });

// Enables $geoNear / $nearSphere radius queries to find nearby workers.
userSchema.index({ 'worker.location': '2dsphere' });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = async function (entered) {
  return await bcrypt.compare(entered, this.password);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.loginAttempts = 1;
    this.lockUntil = null;
  } else {
    this.loginAttempts += 1;
  }
  const MAX_ATTEMPTS = 5;
  const LOCK_TIME = 15 * 60 * 1000;
  if (this.loginAttempts >= MAX_ATTEMPTS && !this.isLocked()) {
    this.lockUntil = Date.now() + LOCK_TIME;
  }
  await this.save();
};

userSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = null;
  await this.save();
};

module.exports = mongoose.model('User', userSchema);