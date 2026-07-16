const express = require('express');
const router = express.Router();
const { startSharing, stopSharing, getWorkerLocation } = require('../controllers/locationController');
const { protect, authorize } = require('../middleware/auth');

router.post('/start',           protect, authorize('worker'), startSharing);
router.post('/stop',            protect, authorize('worker'), stopSharing);
router.get('/worker/:workerId', protect, getWorkerLocation);

module.exports = router;
