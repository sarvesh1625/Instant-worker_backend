const PlatformSettings = require('../models/PlatformSettings');

// Usual daily pay per skill (and city). A HINT for posters while they type the wage — it never blocks a job.

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

// GET /api/wage-guide?skill=Painter&city=Hyderabad  (any logged-in user)
// Picks the row for that city; if there is none, the row with no city ("all cities").
const getHint = async (req, res) => {
  try {
    const skill = norm(req.query.skill);
    const city  = norm(req.query.city);
    if (!skill) return res.status(200).json({ success: true, guide: null });
    const settings = await PlatformSettings.getSettings();
    const rows = (settings.wageGuide || []).filter(r => norm(r.skill) === skill);
    const row = (city && rows.find(r => norm(r.city) === city)) || rows.find(r => !norm(r.city));
    res.status(200).json({
      success: true,
      guide: row ? { min: row.min, max: row.max, city: row.city || '', skill: row.skill } : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/wage-guide
const adminGet = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    res.status(200).json({ success: true, rows: (settings.wageGuide || []).map(r => ({ skill: r.skill, city: r.city || '', min: r.min, max: r.max })) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/wage-guide { rows: [{ skill, city, min, max }] }  — replaces the whole table.
const adminSave = async (req, res) => {
  try {
    const raw = req.body && req.body.rows;
    if (!Array.isArray(raw)) return res.status(400).json({ success: false, message: 'rows must be a list' });
    if (raw.length > 300) return res.status(400).json({ success: false, message: 'Too many rows (limit 300)' });

    const seen = new Set();
    const rows = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] || {};
      const skill = String(r.skill || '').trim().slice(0, 40);
      const city  = String(r.city || '').trim().slice(0, 40);
      const min = Math.round(Number(r.min));
      const max = Math.round(Number(r.max));
      if (!skill) return res.status(400).json({ success: false, message: `Row ${i + 1}: choose a skill` });
      if (!(min >= 1 && max >= 1 && min <= 100000 && max <= 100000)) return res.status(400).json({ success: false, message: `Row ${i + 1}: enter the lowest and highest pay (₹1 to ₹100000)` });
      if (min > max) return res.status(400).json({ success: false, message: `Row ${i + 1}: the lowest pay is higher than the highest` });
      const key = `${norm(skill)}|${norm(city)}`;
      if (seen.has(key)) return res.status(400).json({ success: false, message: `Row ${i + 1}: ${skill}${city ? ' in ' + city : ' (all cities)'} is listed twice` });
      seen.add(key);
      rows.push({ skill, city, min, max });
    }

    const settings = await PlatformSettings.getSettings();
    settings.wageGuide = rows;
    await settings.save();
    res.status(200).json({ success: true, message: 'Wage guide saved', rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getHint, adminGet, adminSave };