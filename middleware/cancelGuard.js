const TravelStatus = require('../models/TravelStatus');
const { protect } = require('./auth');

// Pause rule: LIMIT late cancellations inside WINDOW_DAYS  ->  the person cannot apply for jobs
// (worker) or post jobs (poster) for PAUSE_DAYS after their latest late cancel.
// A "late" cancel = cancelled after the worker had tapped "on the way" / "reached".
// Admins can waive a late cancel (Admin -> Cancellations) and it stops counting.
// Change the numbers with Render environment variables: LATE_CANCEL_LIMIT, LATE_CANCEL_DAYS, LATE_CANCEL_PAUSE_DAYS.
const LIMIT       = Number(process.env.LATE_CANCEL_LIMIT) || 3;
const WINDOW_DAYS = Number(process.env.LATE_CANCEL_DAYS) || 30;
const PAUSE_DAYS  = Number(process.env.LATE_CANCEL_PAUSE_DAYS) || 3;
const DAY = 24 * 60 * 60 * 1000;

// Only POST /api/jobs (post a job) and POST /api/jobs/:id/apply (apply) are checked.
const isChecked = (req) => req.method === 'POST' && (req.path === '/' || /^\/[^/]+\/apply\/?$/.test(req.path));

module.exports = (req, res, next) => {
  if (!isChecked(req)) return next();
  protect(req, res, async () => {
    try {
      const since = new Date(Date.now() - WINDOW_DAYS * DAY);
      const rows = await TravelStatus.find({ cancelledById: req.user._id, lateCancel: true, cancelledAt: { $gte: since } })
        .sort({ cancelledAt: -1 }).limit(LIMIT).select('cancelledAt').lean();
      if (rows.length >= LIMIT) {
        const until = new Date(new Date(rows[0].cancelledAt).getTime() + PAUSE_DAYS * DAY);
        if (until > new Date()) {
          return res.status(403).json({
            success: false, code: 'CANCEL_PAUSE', until,
            message: `You cancelled ${LIMIT} jobs late in ${WINDOW_DAYS} days, so this is paused until ${until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Contact support if this is a mistake.`,
          });
        }
      }
    } catch (e) { /* a guard error must never block real work */ }
    next();
  });
};