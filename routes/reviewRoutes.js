const express = require('express');
const router  = express.Router();
const { addReview, getUserReviews, deleteReview, updateReview, getMyGivenReviews } = require('../controllers/reviewController');
const { protect } = require('../middleware/auth');

router.get('/by/me',        protect, getMyGivenReviews);
router.get('/:userId',      getUserReviews);
router.post('/:userId',     protect, addReview);
router.patch('/:reviewId',  protect, updateReview);
router.delete('/:reviewId', protect, deleteReview);

module.exports = router;