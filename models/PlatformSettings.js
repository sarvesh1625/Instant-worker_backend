const mongoose = require('mongoose');

// Singleton pattern — this collection should only ever hold ONE document.
// getSettings() below always fetches-or-creates that single document rather
// than letting multiple settings docs accidentally exist. Start simple with
// just the subscription toggle; more platform-wide switches can be added
// here later without a schema migration.
const platformSettingsSchema = new mongoose.Schema({
  subscriptionsEnabled: { type: Boolean, default: false }, // OFF by default — matches "same as of now" until admin flips it
  earlyAccessMinutes:   { type: Number, default: 15 },      // how many minutes non-subscribed workers are delayed by
  enabledAt:            { type: Date },
  enabledBy:             { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Always returns the single settings document, creating it with defaults
// the first time it's ever needed (e.g. first admin panel load).
platformSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);