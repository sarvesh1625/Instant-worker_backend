const User = require('../models/User');
const cloudinary = require('cloudinary').v2;
const multer  = require('multer');
const fs      = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/id-docs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.fieldname}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Images only'));
  },
});

const submitVerification = async (req, res) => {
  try {
    const { idType, idNumber } = req.body;
    if (!req.files || !req.files.documentPhoto) return res.status(400).json({ success: false, message: 'ID document photo is required' });
    if (!idType) return res.status(400).json({ success: false, message: 'ID type is required' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.idVerification?.status === 'pending') return res.status(400).json({ success: false, message: 'Your verification is already under review' });
    if (user.idVerification?.status === 'approved') return res.status(400).json({ success: false, message: 'You are already verified' });

    const docResult = await cloudinary.uploader.upload(req.files.documentPhoto[0].path, {
      folder: `instan-labour/id-docs/${req.user._id}`, public_id: 'document', overwrite: true,
    });
    fs.unlinkSync(req.files.documentPhoto[0].path);

    let selfieUrl = '';
    if (req.files.selfiePhoto) {
      const selfieResult = await cloudinary.uploader.upload(req.files.selfiePhoto[0].path, {
        folder: `instan-labour/id-docs/${req.user._id}`, public_id: 'selfie', overwrite: true,
      });
      selfieUrl = selfieResult.secure_url;
      fs.unlinkSync(req.files.selfiePhoto[0].path);
    }

    user.idVerification = {
      status: 'pending', idType, idNumber: idNumber ? idNumber.slice(-4) : '',
      documentPhoto: docResult.secure_url, selfiePhoto: selfieUrl,
      submittedAt: new Date(), reviewedAt: null, reviewedBy: null, rejectionReason: '',
    };
    await user.save();

    res.status(200).json({ success: true, message: 'ID submitted for verification. We will review it within 24-48 hours.', status: 'pending' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyVerificationStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('idVerification isVerified');
    res.status(200).json({ success: true, isVerified: user.isVerified, verification: user.idVerification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { submitVerification, getMyVerificationStatus, upload };
