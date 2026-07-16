const express = require('express');
const router  = express.Router();
const { addReview, getUserReviews, deleteReview } = require('../controllers/reviewController');
const { protect } = require('../middleware/auth');

router.get('/:userId',      getUserReviews);
router.post('/:userId',     protect, addReview);
router.delete('/:reviewId', protect, deleteReview);

module.exports = router;
