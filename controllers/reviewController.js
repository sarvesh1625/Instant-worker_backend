const Review = require('../models/Review');
const User   = require('../models/User');

const EDIT_HOURS = 5;
const editableUntil = (r) => new Date(new Date(r.createdAt).getTime() + EDIT_HOURS * 3600 * 1000);

const ratingFieldFor = (role) => (role === 'worker' ? 'worker' : 'poster');

const recalcRating = async (userId) => {
  const reviews = await Review.find({ reviewedUser: userId });
  if (reviews.length === 0) return;
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const rounded = Math.round(avg * 10) / 10;
  const user = await User.findById(userId);
  if (!user) return;
  const field = ratingFieldFor(user.role);
  await User.findByIdAndUpdate(userId, {
    [`${field}.rating.average`]: rounded,
    [`${field}.rating.count`]:   reviews.length,
  });
};

const addReview = async (req, res) => {
  try {
    const { rating, comment, jobId } = req.body;
    const reviewedUserId = req.params.userId;

    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    if (reviewedUserId === req.user._id.toString()) return res.status(400).json({ success: false, message: 'Cannot review yourself' });

    const reviewedUser = await User.findById(reviewedUserId);
    if (!reviewedUser) return res.status(404).json({ success: false, message: 'User not found' });

    if (jobId) {
      const existing = await Review.findOne({ reviewedBy: req.user._id, reviewedUser: reviewedUserId, job: jobId });
      if (existing) return res.status(400).json({ success: false, message: 'You already reviewed this person for this job' });
    }

    const review = await Review.create({
      reviewedBy: req.user._id, reviewedUser: reviewedUserId, job: jobId || null,
      rating: Number(rating), comment: comment || '', reviewerRole: req.user.role,
    });

    await recalcRating(reviewedUserId);
    await review.populate('reviewedBy', 'name profilePhoto role');
    await review.populate('job', 'title');

    res.status(201).json({ success: true, review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getUserReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ reviewedUser: req.params.userId })
      .populate('reviewedBy', 'name profilePhoto role').populate('job', 'title').sort({ createdAt: -1 });
    const user = await User.findById(req.params.userId).select('name role worker poster profilePhoto');
    const ratingData = user ? (user[ratingFieldFor(user.role)]?.rating || { average: 0, count: 0 }) : { average: 0, count: 0 };
    res.status(200).json({ success: true, reviews, rating: ratingData, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    if (review.reviewedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const reviewedUserId = review.reviewedUser;
    await review.deleteOne();
    await recalcRating(reviewedUserId);
    res.status(200).json({ success: true, message: 'Review deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/reviews/:reviewId  { rating, comment }  — author only, within EDIT_HOURS of posting.
const updateReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    if (review.reviewedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (Date.now() > editableUntil(review).getTime()) {
      return res.status(403).json({ success: false, code: 'EDIT_EXPIRED', message: `You can only change a rating within ${EDIT_HOURS} hours of giving it.` });
    }
    const { rating, comment } = req.body;
    if (rating !== undefined) {
      if (!(Number(rating) >= 1 && Number(rating) <= 5)) return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
      review.rating = Number(rating);
    }
    if (comment !== undefined) review.comment = String(comment).slice(0, 400);
    await review.save();
    await recalcRating(review.reviewedUser);
    await review.populate('reviewedUser', 'name profilePhoto role');
    await review.populate('job', 'title');
    res.status(200).json({ success: true, review: { ...review.toObject(), editableUntil: editableUntil(review) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/reviews/by/me  — ratings I have given, newest first, with the time left to edit.
const getMyGivenReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ reviewedBy: req.user._id })
      .populate('reviewedUser', 'name profilePhoto role').populate('job', 'title').sort({ createdAt: -1 }).limit(100);
    res.status(200).json({
      success: true,
      reviews: reviews.map(r => ({ ...r.toObject(), editableUntil: editableUntil(r) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { addReview, getUserReviews, deleteReview, updateReview, getMyGivenReviews };