const Consent = require('../models/Consent');

// POST /api/legal/accept   (logged-in user)  body: { version, source }
// Records that the user accepted the Terms and Privacy Policy version. Safe to call twice.
const acceptLegal = async (req, res) => {
  try {
    const version = String(req.body?.version || '').trim().slice(0, 30);
    if (!version) return res.status(400).json({ success: false, message: 'version is required' });
    const source = req.body?.source === 'web' ? 'web' : 'app';
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 64);

    await Consent.updateOne(
      { user: req.user._id, version },
      { $setOnInsert: { user: req.user._id, version, documents: ['terms', 'privacy'], source, ip, acceptedAt: new Date() } },
      { upsert: true }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/legal/mine   (logged-in user) → the versions this user has accepted
const myConsents = async (req, res) => {
  try {
    const rows = await Consent.find({ user: req.user._id }).select('version acceptedAt source -_id').sort({ acceptedAt: -1 });
    res.status(200).json({ success: true, consents: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { acceptLegal, myConsents };