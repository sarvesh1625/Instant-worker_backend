const PlatformSettings = require('../models/PlatformSettings');

// @route  GET /api/admin/settings
// @desc   Current state of platform-wide toggles — right now, just the
//         subscription system on/off switch.
// @access Private (admin)
const getSettings = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    res.status(200).json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  PATCH /api/admin/settings/subscriptions
// @desc   The single ON/OFF switch for the entire subscription system.
//         When OFF (the default), every worker sees every job at the exact
//         same time — regular and urgent — exactly as the platform has
//         always worked. When ON, jobController's delay logic (see
//         jobController.js) starts applying the early-access window to
//         non-subscribed workers, for both regular and urgent jobs.
// @access Private (admin)
const toggleSubscriptions = async (req, res) => {
  try {
    const { enabled } = req.body;
    const settings = await PlatformSettings.getSettings();

    settings.subscriptionsEnabled = !!enabled;
    if (enabled) {
      settings.enabledAt = new Date();
      settings.enabledBy = req.user._id;
    }
    await settings.save();

    res.status(200).json({
      success: true,
      message: enabled ? 'Subscription system is now ON' : 'Subscription system is now OFF',
      settings,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getSettings, toggleSubscriptions };