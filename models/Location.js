const mongoose = require('mongoose');

const LocationSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
  coordinates: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  isSharing: { type: Boolean, default: false },
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Location', LocationSchema);
