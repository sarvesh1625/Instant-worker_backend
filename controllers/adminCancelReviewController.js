const mongoose = require('mongoose');
const TravelStatus = require('../models/TravelStatus');
const Review = require('../models/Review');
const User = require('../models/User');
const AdminAction = require('../models/AdminAction');

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = Number(process.env.LATE_CANCEL_DAYS) || 30;
const LIMIT = Number(process.env.LATE_CANCEL_LIMIT) || 3;
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = (res, e) => res.status(500).json({ success: false, message: e.message });
const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const log = (req, action, o = {}) => AdminAction.create({
  admin: req.user._id, action, targetType: o.targetType || '', targetId: String(o.targetId || ''),
  summary: o.summary || '', reason: o.reason || '', meta: o.meta || {},
}).catch(() => {});

// ── Cancellations ────────────────────────────────────────────────────────────
// GET /api/admin/ops/cancellations?late=1&page=1
const listCancellations = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 30;
    const q = { status: 'cancelled' };
    if (req.query.late === '1') q.lateCancel = true;

    const [total, items] = await Promise.all([
      TravelStatus.countDocuments(q),
      TravelStatus.find(q).sort({ cancelledAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('job', 'title')
        .populate('worker', 'name phone role')
        .populate('cancelledById', 'name phone role')
        .lean(),
    ]);

    // how many late cancels each of these people has in the window (the number that triggers the pause)
    const ids = [...new Set(items.map(i => String(i.cancelledById?._id || '')).filter(Boolean))].map(id => new mongoose.Types.ObjectId(id));
    const since = new Date(Date.now() - WINDOW_DAYS * DAY);
    const counts = ids.length ? await TravelStatus.aggregate([
      { $match: { cancelledById: { $in: ids }, lateCancel: true, cancelledAt: { $gte: since } } },
      { $group: { _id: '$cancelledById', n: { $sum: 1 } } },
    ]) : [];
    const countOf = Object.fromEntries(counts.map(c => [String(c._id), c.n]));

    res.json({
      success: true, total, page, pages: Math.max(1, Math.ceil(total / limit)),
      rule: { limit: LIMIT, windowDays: WINDOW_DAYS },
      items: items.map(i => ({ ...i, recentLate: countOf[String(i.cancelledById?._id || '')] || 0 })),
    });
  } catch (e) { fail(res, e); }
};

// PATCH /api/admin/ops/cancellations/:id/waive   { reason }
const waiveCancellation = async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ success: false, message: 'Please write a reason' });
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Bad id' });
    const t = await TravelStatus.findById(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    if (!t.lateCancel) return res.status(400).json({ success: false, message: 'This one is not counted as late' });
    t.lateCancel = false; t.waivedAt = new Date(); t.waivedBy = req.user._id;
    await t.save();
    log(req, 'cancel_waived', { targetType: 'user', targetId: t.cancelledById, summary: 'Late cancel waived', reason, meta: { travelId: String(t._id), job: String(t.job) } });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
};

// ── Ratings & reviews ────────────────────────────────────────────────────────
const ratingFieldFor = (role) => (role === 'worker' ? 'worker' : 'poster');
const recalcRating = async (userId) => {
  const reviews = await Review.find({ reviewedUser: userId });
  if (reviews.length === 0) return;
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const user = await User.findById(userId);
  if (!user) return;
  const field = ratingFieldFor(user.role);
  await User.findByIdAndUpdate(userId, {
    [`${field}.rating.average`]: Math.round(avg * 10) / 10,
    [`${field}.rating.count`]: reviews.length,
  });
};

// GET /api/admin/ops/reviews?s=<name or phone>&userId=&rating=&page=
const listReviews = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 25;
    const and = [];
    if (isId(req.query.userId)) and.push({ $or: [{ reviewedUser: req.query.userId }, { reviewedBy: req.query.userId }] });
    const s = String(req.query.s || '').trim();
    if (s) {
      const rx = new RegExp(esc(s), 'i');
      const ids = (await User.find({ $or: [{ name: rx }, { phone: rx }] }).select('_id').limit(50).lean()).map(u => u._id);
      and.push({ $or: [{ reviewedUser: { $in: ids } }, { reviewedBy: { $in: ids } }] });
    }
    if (Number(req.query.rating) >= 1 && Number(req.query.rating) <= 5) and.push({ rating: Number(req.query.rating) });
    const q = and.length ? { $and: and } : {};

    const [total, reviews] = await Promise.all([
      Review.countDocuments(q),
      Review.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('reviewedBy', 'name phone role').populate('reviewedUser', 'name phone role').populate('job', 'title').lean(),
    ]);
    res.json({ success: true, total, page, pages: Math.max(1, Math.ceil(total / limit)), reviews });
  } catch (e) { fail(res, e); }
};

// PATCH /api/admin/ops/reviews/:id   { rating?, comment?, reason }
// No time limit (unlike the 5-hour limit for users). Recalculates the person's average and is written to the action log.
const editReview = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Bad id' });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ success: false, message: 'Please write a reason' });
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    const before = { rating: review.rating, comment: review.comment };
    const { rating, comment } = req.body || {};
    if (rating !== undefined) {
      if (!(Number(rating) >= 1 && Number(rating) <= 5)) return res.status(400).json({ success: false, message: 'Rating must be 1 to 5' });
      review.rating = Number(rating);
    }
    if (comment !== undefined) review.comment = String(comment).slice(0, 400);
    await review.save();
    await recalcRating(review.reviewedUser);

    log(req, 'review_edit', {
      targetType: 'user', targetId: review.reviewedUser, summary: `Review edited: ${before.rating}★ → ${review.rating}★`, reason,
      meta: { reviewId: String(review._id), before, after: { rating: review.rating, comment: review.comment } },
    });
    res.json({ success: true, review });
  } catch (e) { fail(res, e); }
};

module.exports = { listCancellations, waiveCancellation, listReviews, editReview };