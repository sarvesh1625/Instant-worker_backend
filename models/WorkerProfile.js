// ⚠️ LIKELY DEAD MODEL — orphaned from before the two-role restructure.
// No controller in this codebase currently imports or references
// 'WorkerProfile'. workerController.js reads/writes User.worker directly
// instead. Confirm nothing else uses this before deleting.
const mongoose = require('mongoose');

const workerProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  skill: {
    type: String,
    required: true,
    enum: ['Labour','Painter','Carpenter','Electrician','Mechanic','Farmer','Driver','Plumber','Welder','Other'],
  },
  experience: { type: Number, default: 0 },
  location: {
    city: { type: String, required: true },
    area: { type: String },
    coordinates: { lat: Number, lng: Number },
  },
  wage: {
    amount: { type: Number, required: true },
    type:   { type: String, default: 'daily' },
  },
  description: { type: String, maxlength: 500 },
  profileImage: { type: String, default: '' },
  availability: { type: Boolean, default: true },
  rating: { average: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
  languages: [String],
}, { timestamps: true });

module.exports = mongoose.model('WorkerProfile', workerProfileSchema);
