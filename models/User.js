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

  worker: {
    skill:         { type: String, default: '' },
    skills:        [String],
    experience:    { type: Number, default: 0 },
    wagePerDay:    { type: Number, default: 0 },
    availability:  { type: Boolean, default: true },
    rating: { average: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    totalJobsDone: { type: Number, default: 0 },

    // FIX: removed `default: 'Point'` from the nested `type` field below.
    // That default caused Mongoose to auto-materialize
    // `location: { type: 'Point' }` on EVERY user document — even ones that
    // never got real coordinates — leaving `coordinates` missing. That's an
    // invalid GeoJSON point, which broke the 2dsphere index on ANY save()
    // call (including login's loginAttempts tracking), throwing
    // "Point must be an array or object, instead got type missing".
    // Now `location` only exists when BOTH fields are explicitly set
    // together (see workerController.updateMyLocation, which already does
    // this correctly — it was only the schema default that was wrong).
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] },
    },
    locationUpdatedAt: { type: Date },
  },

  poster: {
    rating: { average: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    totalJobsPosted: { type: Number, default: 0 },
    totalHired:      { type: Number, default: 0 },
  },

  otp: { code: String, expiresAt: Date },

}, { timestamps: true });

userSchema.index({ 'worker.location': '2dsphere' });

// Extra safety net: if a location object somehow ends up with a type but no
// valid coordinates (e.g. from old corrupted data, or a future bug), strip
// it entirely before saving rather than letting the 2dsphere index reject
// the whole save. A user simply having no known location is fine; a broken
// half-formed one is not.
userSchema.pre('save', function (next) {
  const loc = this.worker?.location;
  if (loc && (!Array.isArray(loc.coordinates) || loc.coordinates.length !== 2)) {
    this.worker.location = undefined;
  }
  next();
});

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