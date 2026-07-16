// ⚠️ NOT MOUNTED — server/index.js has no `app.use('/api/users', ...)` line,
// so /api/users/me and /api/users/upload-photo currently 404 regardless of
// what userRoutes.js defines. Add the app.use line if this is meant to be live.
const cloudinary = require('cloudinary').v2;
const User        = require('../models/User');
const multer      = require('multer');
const path        = require('path');
const fs          = require('fs');

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/photos';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Images only'));
  },
});

const uploadPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No photo uploaded' });
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder:         `instan-labour/profiles/${req.user._id}`,
      public_id:      'profile',
      overwrite:      true,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }, { quality: 'auto' }],
    });
    fs.unlinkSync(req.file.path);
    await User.findByIdAndUpdate(req.user._id, { profilePhoto: result.secure_url });
    res.status(200).json({ success: true, url: result.secure_url });
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { uploadPhoto, getMe, upload };
