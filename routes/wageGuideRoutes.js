const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { getHint } = require('../controllers/wageGuideController');

router.get('/', protect, getHint);

module.exports = router;