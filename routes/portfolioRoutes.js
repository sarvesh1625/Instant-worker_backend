const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const { addPortfolio, getWorkerPortfolio, getMyPortfolio, deletePortfolio, getPortfolioFeed } = require('../controllers/portfolioController');
const { protect, authorize } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Images only (jpg, png, webp)'));
  },
});

router.get('/feed',      getPortfolioFeed);
router.get('/my',        protect, getMyPortfolio);
router.get('/:workerId', getWorkerPortfolio);
router.post('/',         protect, authorize('worker'), upload.array('images', 5), addPortfolio);
router.delete('/:id',    protect, authorize('worker'), deletePortfolio);

module.exports = router;
