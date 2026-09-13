const User = require('../models/User');
const Skill = require('../models/Skill');

const SITE_URL = process.env.SITE_URL || 'https://www.instantworker.in';

const escapeXml = (str) =>
  String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const slugify = (str) => String(str).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

const getSitemap = async (req, res) => {
  try {
    // CHANGED: was a blind cross-join of every active skill × every city
    // with ANY worker — that generated 22 URLs for only ~13 workers total,
    // most landing on an empty "no workers yet" page. Google can treat a
    // site with many near-identical, mostly-empty templated pages as thin
    // content, which can hurt rankings SITE-WIDE, not just on those pages.
    //
    // Now: only generate a skill×city URL for combinations that actually
    // have at least one real worker. This aggregation groups real worker
    // records directly, so the sitemap only ever lists pages with genuine
    // content — it grows automatically as real workers join, instead of
    // pre-publishing empty placeholders for combinations that don't exist
    // yet.
    const realCombos = await User.aggregate([
      { $match: { role: 'worker', city: { $nin: [null, ''] }, 'worker.skill': { $nin: [null, ''] } } },
      { $group: { _id: { skill: '$worker.skill', city: '$city' } } },
    ]);

    const skillCityUrls = realCombos.map(c => ({
      loc: `/workers/${slugify(c._id.skill)}/${slugify(c._id.city)}`,
      priority: '0.8',
      changefreq: 'weekly',
    }));

    const workers = await User.find({ role: 'worker', isVerified: true })
      .select('_id updatedAt').lean();

    const staticUrls = [
      { loc: '/', priority: '1.0', changefreq: 'daily' },
      { loc: '/login', priority: '0.3', changefreq: 'monthly' },
      { loc: '/register', priority: '0.5', changefreq: 'monthly' },
    ];

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