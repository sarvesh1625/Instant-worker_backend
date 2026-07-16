// ⚠️ ROUTE ORDER BUG: /access/:userId was registered AFTER /:userId. Express
// matches in registration order, so a request to /access/68abc... previously
// matched /:userId first (treating "access" as a userId) and called
// getMessages instead of checkAccess. Fixed below by moving it above.
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { getMessages, getConversations, sendMessage, sendVoiceMessage, checkAccess } = require('../controllers/chatController');
const { protect } = require('../middleware/auth');

const voiceUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /webm|ogg|mp4|wav|m4a|mp3/;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Audio files only'));
  },
});

router.get('/conversations',  protect, getConversations);
router.get('/access/:userId', protect, checkAccess);   // MOVED — must be above /:userId
router.get('/:userId',        protect, getMessages);
router.post('/:userId',       protect, sendMessage);
router.post('/:userId/voice', protect, voiceUpload.single('audio'), sendVoiceMessage);

module.exports = router;
