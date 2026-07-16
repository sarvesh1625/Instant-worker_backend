const Portfolio = require('../models/Portfolio');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
});

const addPortfolio = async (req, res) => {
  try {
    const { title, description, skill, completedAt } = req.body;
    const images = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: `labour-platform/portfolio/${req.user._id}`,
          transformation: [{ width: 800, height: 600, crop: 'limit' }],
        });
        images.push({ url: result.secure_url, publicId: result.public_id });
      }
    }
    const portfolio = await Portfolio.create({
      worker: req.user._id, title, description, skill, images, completedAt: completedAt || Date.now(),
    });
    res.status(201).json({ success: true, portfolio });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getWorkerPortfolio = async (req, res) => {
  try {
    const items = await Portfolio.find({ worker: req.params.workerId }).sort({ completedAt: -1 });
    res.status(200).json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMyPortfolio = async (req, res) => {
  try {
    const items = await Portfolio.find({ worker: req.user._id }).sort({ completedAt: -1 });
    res.status(200).json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deletePortfolio = async (req, res) => {
  try {
    const item = await Portfolio.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (item.worker.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    for (const img of item.images) {
      if (img.publicId) await cloudinary.uploader.destroy(img.publicId);
    }
    await item.deleteOne();
    res.status(200).json({ success: true, message: 'Portfolio item deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPortfolioFeed = async (req, res) => {
  try {
    const items = await Portfolio.find().populate('worker', 'name').sort({ createdAt: -1 }).limit(20);
    res.status(200).json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { addPortfolio, getWorkerPortfolio, getMyPortfolio, deletePortfolio, getPortfolioFeed };
