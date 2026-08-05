const mongoose = require('mongoose');

// Skills are stored here so the admin can add/remove them without a code
// deploy. IMPORTANT: User.worker.skill and Job.skill are plain strings, not
// a reference to this collection — so "deleting" a skill here never touches
// any existing user profile or job post that already used it. It only
// removes that option from future dropdowns. This is why delete below is a
// soft-delete (active: false), not a hard removal — it keeps historical
// data intact and lets an admin bring a skill back if removed by mistake.
const skillSchema = new mongoose.Schema({
  name:   { type: String, required: true, unique: true, trim: true },
  active: { type: Boolean, default: true },
  order:  { type: Number, default: 0 }, // controls display order in dropdowns
}, { timestamps: true });

module.exports = mongoose.model('Skill', skillSchema);