const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');
const { translate } = require('../controllers/translateController');
const { protect } = require('../middleware/auth');

// Each call can cost money, so: logged-in users only, and a per-user cap.
const limiter = rateLimit({
  windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: { success: false, message: 'Too many translation requests. Please slow down.' },
});

router.post('/', protect, limiter, translate);

module.exports = router;