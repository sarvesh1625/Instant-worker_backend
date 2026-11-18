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

// Documents we accept. Aadhaar is NOT accepted (see the Privacy Policy), and the ID number is not collected.
const ALLOWED_ID_TYPES = ['voter', 'driving', 'eshram', 'pan'];

// Delete the temporary uploads if we stop early.
const dropTemp = (files) => {
  Object.values(files || {}).flat().forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
};

const submitVerification = async (req, res) => {
  try {
    const { idType } = req.body;
    if (!req.files || !req.files.documentPhoto) return res.status(400).json({ success: false, message: 'ID document photo is required' });
    if (!idType) { dropTemp(req.files); return res.status(400).json({ success: false, message: 'ID type is required' }); }
    if (String(idType).toLowerCase().startsWith('aadh')) {
      dropTemp(req.files);
      return res.status(400).json({ success: false, message: 'Aadhaar is not accepted. Please use Voter ID, Driving Licence, e-Shram card or PAN.' });
    }
    if (!ALLOWED_ID_TYPES.includes(idType)) {
      dropTemp(req.files);
      return res.status(400).json({ success: false, message: 'Choose Voter ID, Driving Licence, e-Shram card or PAN.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) { dropTemp(req.files); return res.status(404).json({ success: false, message: 'User not found' }); }
    if (user.idVerification?.status === 'pending') { dropTemp(req.files); return res.status(400).json({ success: false, message: 'Your verification is already under review' }); }
    if (user.idVerification?.status === 'approved') { dropTemp(req.files); return res.status(400).json({ success: false, message: 'You are already verified' }); }

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
      status: 'pending', idType, idNumber: '',   // the number is no longer collected
      documentPhoto: docResult.secure_url, selfiePhoto: selfieUrl,
      submittedAt: new Date(), reviewedAt: null, reviewedBy: null, rejectionReason: '',
    };
    await user.save();

    res.status(200).json({ success: true, message: 'ID submitted for verification. We will review it within 24-48 hours.', status: 'pending' });
  } catch (err) {
    dropTemp(req.files);
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