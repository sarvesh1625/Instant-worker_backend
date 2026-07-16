const express = require('express');
const router  = express.Router();
const { getMyProfile, updateMyProfile, getPublicProfile, toggleAvailability } = require('../controllers/profileController');
const { protect } = require('../middleware/auth');

router.get('/me',             protect, getMyProfile);
router.put('/me',             protect, updateMyProfile);
router.patch('/availability', protect, toggleAvailability);
router.get('/:userId',        getPublicProfile);

module.exports = router;
