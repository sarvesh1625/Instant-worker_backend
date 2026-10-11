const PushToken = require('../models/PushToken');

const VALID = /^(Exponent|Expo)PushToken\[[^\]]+\]$/;

// POST /api/notifications/push-token  { token, lang }
const registerPushToken = async (req, res) => {
  try {
    const { token, lang } = req.body || {};
    if (!VALID.test(String(token || ''))) {
      return res.status(400).json({ success: false, message: 'Invalid push token' });
    }
    await PushToken.findOneAndUpdate(
      { token },
      { user: req.user._id, lang: ['en', 'hi', 'te'].includes(lang) ? lang : 'en', platform: 'android', updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/notifications/push-token  { token }   — called on logout
const removePushToken = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (token) await PushToken.deleteOne({ token, user: req.user._id });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { registerPushToken, removePushToken };