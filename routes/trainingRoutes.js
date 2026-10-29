const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminAuth');
const { getStatus, markComplete, adminList, adminCreate, adminUpdate, adminDelete } = require('../controllers/trainingController');

const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|3gp|mpeg|mpg|wmv)$/i;
const videoUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 },   // 100 MB — Cloudinary's free plan limit for one video
  // Windows sometimes sends an empty or odd type for valid videos, so the file extension is accepted too.
  fileFilter: (req, file, cb) => {
    const ok = /^video\//.test(file.mimetype) || VIDEO_EXT.test(file.originalname || '');
    if (!ok) req.badVideoType = file.originalname || 'that file';
    cb(null, ok);
  },
});
// Same as videoUpload.single('video'), but a too-big file gives a readable message instead of a crash.
const uploadOne = (req, res, next) => videoUpload.single('video')(req, res, (err) => {
  if (!err) return next();
  const big = err.code === 'LIMIT_FILE_SIZE';
  res.status(big ? 413 : 400).json({ success: false, message: big ? 'The video is bigger than 100 MB. Compress it, or paste a link instead.' : err.message });
});

// People (workers and hirers)
router.get('/status',        protect, getStatus);
router.post('/:id/complete', protect, markComplete);

// Admin only — registered under /api/training/admin/...
router.get('/admin',          protect, adminOnly, adminList);
router.post('/admin',         protect, adminOnly, uploadOne, adminCreate);
router.patch('/admin/:id',    protect, adminOnly, adminUpdate);
router.delete('/admin/:id',   protect, adminOnly, adminDelete);

module.exports = router;