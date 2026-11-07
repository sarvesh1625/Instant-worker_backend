const express = require('express');
const router = express.Router();
const { getTravel, setStatus, cancel } = require('../controllers/travelController');
const { protect } = require('../middleware/auth');

router.get('/job/:jobId', protect, getTravel);
router.patch('/job/:jobId', protect, setStatus);
router.post('/job/:jobId/cancel', protect, cancel);

module.exports = router;