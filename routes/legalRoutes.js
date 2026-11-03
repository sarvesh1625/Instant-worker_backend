const express = require('express');
const router  = express.Router();
const { acceptLegal, myConsents } = require('../controllers/legalController');
const { protect } = require('../middleware/auth');

router.post('/accept', protect, acceptLegal);
router.get('/mine',    protect, myConsents);

module.exports = router;