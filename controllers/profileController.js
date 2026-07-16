const User = require('../models/User');

const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -otp');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const {
      name, age, gender, city, area, state, bio, languages,
      skill, skills, experience, wagePerDay, availability, idProof,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // FIX: was using truthy checks (if (bio), if (age)) which silently
    // ignored attempts to clear a field to empty string, 0, or false —
    // e.g. a user could never blank out their bio, or explicitly set
    // gender/age to a falsy-looking value. Now uses !== undefined so any
    // explicitly-sent field (including empty ones) is actually applied.
    if (name       !== undefined) user.name      = name;
    if (age        !== undefined) user.age       = age;
    if (gender     !== undefined) user.gender    = gender;
    if (city       !== undefined) user.city      = city;
    if (area       !== undefined) user.area      = area;
    if (state      !== undefined) user.state     = state;
    if (bio        !== undefined) user.bio       = bio;
    if (languages  !== undefined) {
      user.languages = Array.isArray(languages)
        ? languages
        : String(languages).split(',').map(l => l.trim()).filter(Boolean);
    }

    if (user.role === 'worker') {
      if (skill        !== undefined) user.worker.skill        = skill;
      if (skills       !== undefined) user.worker.skills       = skills;
      if (experience   !== undefined) user.worker.experience   = experience;
      if (wagePerDay   !== undefined) user.worker.wagePerDay   = wagePerDay;
      if (availability !== undefined) user.worker.availability = availability;
      if (idProof      !== undefined) user.worker.idProof      = idProof;
    }

    const isComplete = !!(user.name && user.age && user.city && (
      (user.role === 'worker' && user.worker.skill && user.worker.wagePerDay) ||
      (user.role === 'user'   && user.city)
    ));
    user.isProfileComplete = isComplete;

    await user.save();
    const updated = await User.findById(user._id).select('-password -otp');
    res.status(200).json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPublicProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-password -otp -email -isVerified');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const toggleAvailability = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.role !== 'worker') return res.status(403).json({ success: false, message: 'Workers only' });
    user.worker.availability = !user.worker.availability;
    await user.save();
    res.status(200).json({
      success: true,
      availability: user.worker.availability,
      message: user.worker.availability ? 'You are now available' : 'You are now unavailable',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getMyProfile, updateMyProfile, getPublicProfile, toggleAvailability };