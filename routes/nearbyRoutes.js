const express = require('express');
const router = express.Router();
const { workersNearby } = require('../controllers/nearbyController');
const { protect } = require('../middleware/auth');

router.get('/workers', protect, workersNearby);

module.exports = router;