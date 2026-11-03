const User = require('../models/User');

// GET /api/nearby/workers?skill=Painter&lat=17.38&lng=78.48&city=Hyderabad   (logged-in user)
// Counts ONLINE workers (switched Online, active account, exact same skill) near the given point, in the same
// rings the job alerts use (6 / 15 / 25 km). Only numbers are returned — never names, phones or places.
const EARTH_RADIUS_KM = 6371;
const RINGS = [6, 15, 25];
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const workersNearby = async (req, res) => {
  try {
    const skill = String(req.query.skill || '').trim();
    if (!skill) return res.status(400).json({ success: false, message: 'skill is required' });
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const city = String(req.query.city || '').trim();

    const base = {
      role: 'worker', accountStatus: 'active', 'worker.availability': true,
      $or: [{ 'worker.skill': skill }, { 'worker.skills': skill }],
    };

    const rings = hasPoint
      ? await Promise.all(RINGS.map(km => User.countDocuments({
          ...base, 'worker.location': { $geoWithin: { $centerSphere: [[lng, lat], km / EARTH_RADIUS_KM] } },
        })))
      : null;
    const cityOnline = city
      ? await User.countDocuments({ ...base, city: new RegExp('^' + esc(city) + '$', 'i') })
      : null;

    res.status(200).json({
      success: true, hasPoint,
      within6: rings ? rings[0] : null, within15: rings ? rings[1] : null, within25: rings ? rings[2] : null,
      cityOnline,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { workersNearby };