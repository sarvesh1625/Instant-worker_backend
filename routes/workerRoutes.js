const express = require('express');
const router  = express.Router();
const {
  searchWorkers,
  getWorkerById,
  getMyWorkerProfile,
  upsertWorkerProfile,
  toggleAvailability,
  updateMyLocation,
} = require('../controllers/workerController');
const { protect, authorize } = require('../middleware/auth');

// Specific routes MUST come before /:id, otherwise "search", "profile",
// and "location" get treated as worker IDs.
router.get('/search',              searchWorkers);
router.get('/profile/me',          protect, authorize('worker'), getMyWorkerProfile);
router.post('/profile',            protect, authorize('worker'), upsertWorkerProfile);
router.patch('/availability',      protect, authorize('worker'), toggleAvailability);
router.patch('/location',          protect, authorize('worker'), updateMyLocation);
router.get('/:id',                 getWorkerById);

module.exports = router;