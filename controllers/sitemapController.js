const User = require('../models/User');
const Skill = require('../models/Skill');

const SITE_URL = process.env.SITE_URL || 'https://www.instantworker.in';

const escapeXml = (str) =>
  String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const slugify = (str) => String(str).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

const getSitemap = async (req, res) => {
  try {
    const skillDocs = await Skill.find({ active: true }).sort('order').lean();
    const skills = skillDocs.map(s => s.name);

    const cities = (await User.distinct('city', { role: 'worker', city: { $ne: null, $ne: '' } }))
      .filter(Boolean);

    const workers = await User.find({ role: 'worker', isVerified: true })
      .select('_id updatedAt').lean();

    const staticUrls = [
      { loc: '/', priority: '1.0', changefreq: 'daily' },
      { loc: '/login', priority: '0.3', changefreq: 'monthly' },
      { loc: '/register', priority: '0.5', changefreq: 'monthly' },
    ];

    const skillCityUrls = [];
    for (const skill of skills) {
      for (const city of cities) {
        skillCityUrls.push({
          loc: `/workers/${slugify(skill)}/${slugify(city)}`,
          priority: '0.8',
          changefreq: 'weekly',
        });
      }
    }

    const workerUrls = workers.map(w => ({
      loc: `/worker/${w._id}`,
      priority: '0.6',
      changefreq: 'weekly',
      lastmod: w.updatedAt ? new Date(w.updatedAt).toISOString().split('T')[0] : undefined,
    }));

    const allUrls = [...staticUrls, ...skillCityUrls, ...workerUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${escapeXml(SITE_URL + u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
    res.status(200).send(xml);
  } catch (error) {
    res.status(500).send('Sitemap generation failed');
  }
};

module.exports = { getSitemap };