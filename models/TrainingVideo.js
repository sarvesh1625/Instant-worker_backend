const mongoose = require('mongoose');

// A training video the admin uploads. `audience` decides who has to watch it:
// 'worker' (people who work) or 'user' (people who hire).
const TrainingVideoSchema = new mongoose.Schema({
  title:     { type: String, required: true, trim: true, maxlength: 120 },
  audience:  { type: String, enum: ['worker', 'user'], required: true, index: true },
  url:       { type: String, required: true },     // playable video address (Cloudinary, or a direct .mp4 link)
  publicId:  { type: String, default: '' },         // Cloudinary id, so the file can be deleted with the video
  order:     { type: Number, default: 0 },          // lower number is watched first
  active:    { type: Boolean, default: true },      // switch off to stop requiring it (and hide it)
  // false (default): required only for people who sign up after the video was uploaded.
  // true: everyone who has not watched it yet must watch it, including existing users.
  requireExisting: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('TrainingVideo', TrainingVideoSchema);