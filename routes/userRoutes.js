// ⚠️ NOT MOUNTED in index.js — no app.use('/api/users', ...) line exists.
// These routes are unreachable until that line is added.
const express = require('express');
const router  = express.Router();
const { uploadPhoto, getMe, upload } = require('../controllers/userController');
const { protect } = require('../middleware/auth');

router.get('/me', protect, getMe);
router.post('/upload-photo', protect, upload.single('photo'), uploadPhoto);

module.exports = router;
