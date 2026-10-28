const mongoose = require('mongoose');

// One row = this person watched this video to the end.
const TrainingProgressSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  video:       { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingVideo', required: true },
  completedAt: { type: Date, default: Date.now },
});
TrainingProgressSchema.index({ user: 1, video: 1 }, { unique: true });

module.exports = mongoose.model('TrainingProgress', TrainingProgressSchema);