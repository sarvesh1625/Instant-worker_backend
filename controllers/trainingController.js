const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const TrainingVideo = require('../models/TrainingVideo');
const TrainingProgress = require('../models/TrainingProgress');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Which videos does THIS person have to watch?
const requiredFor = async (user) => {
  const audience = user.role === 'worker' ? 'worker' : user.role === 'user' ? 'user' : null;
  if (!audience) return [];
  const since = user.createdAt ? new Date(user.createdAt) : new Date(0);
  const videos = await TrainingVideo.find({ audience, active: true }).sort({ order: 1, createdAt: 1 });
  return videos.filter(v => v.requireExisting || v.createdAt <= since || !user.createdAt);
};

// GET /api/training/status — { required, completed, videos:[{_id,title,url,done}] }
const getStatus = async (req, res) => {
  try {
    const videos = await requiredFor(req.user);
    if (videos.length === 0) return res.status(200).json({ success: true, required: false, completed: true, videos: [] });
    const done = await TrainingProgress.find({ user: req.user._id, video: { $in: videos.map(v => v._id) } }).select('video');
    const doneSet = new Set(done.map(d => String(d.video)));
    const list = videos.map(v => ({ _id: v._id, title: v.title, url: v.url, done: doneSet.has(String(v._id)) }));
    res.status(200).json({ success: true, required: true, completed: list.every(v => v.done), videos: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/training/:id/complete — the person watched this video to the end.
const markComplete = async (req, res) => {
  try {
    const required = await requiredFor(req.user);
    const video = required.find(v => String(v._id) === req.params.id);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    await TrainingProgress.updateOne(
      { user: req.user._id, video: video._id },
      { $setOnInsert: { user: req.user._id, video: video._id, completedAt: new Date() } },
      { upsert: true }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Admin ───────────────────────────────────────────────────────────────────
const adminList = async (req, res) => {
  try {
    const videos = await TrainingVideo.find().sort({ audience: 1, order: 1, createdAt: 1 });
    const counts = await TrainingProgress.aggregate([{ $group: { _id: '$video', n: { $sum: 1 } } }]);
    const map = new Map(counts.map(c => [String(c._id), c.n]));
    res.status(200).json({ success: true, videos: videos.map(v => ({ ...v.toObject(), watchedBy: map.get(String(v._id)) || 0 })) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/training/admin  (multipart: video file OR a `url` field; title, audience, order, requireExisting)
const adminCreate = async (req, res) => {
  const tmp = req.file && req.file.path;
  // Diagnostic: shows in the Render logs what the upload request actually contained.
  console.log('[training upload]', {
    hasFile: !!req.file, name: req.file && req.file.originalname, mime: req.file && req.file.mimetype, size: req.file && req.file.size,
    badType: req.badVideoType || null, fields: Object.keys(req.body || {}), contentType: String(req.headers['content-type'] || '').slice(0, 40),
  });
  try {
    const { title, audience, order, requireExisting } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Title is required' });
    if (!['worker', 'user'].includes(audience)) return res.status(400).json({ success: false, message: 'Choose who this video is for' });

    let url = (req.body.url || '').trim();
    let publicId = '';
    if (req.file) {
      const result = await cloudinary.uploader.upload_large(req.file.path, {
        resource_type: 'video', folder: 'instant-worker/training', chunk_size: 6000000,
      });
      url = result.secure_url;
      publicId = result.public_id;
    }
    if (!url && req.badVideoType) return res.status(400).json({ success: false, message: `"${req.badVideoType}" is not a video file. Use .mp4, .mov, .webm or .mkv, or paste a link.` });
    if (!url) return res.status(400).json({ success: false, message: 'Upload a video file or paste a video link' });
    if (!/^https:\/\//i.test(url)) return res.status(400).json({ success: false, message: 'The video link must start with https://' });

    const video = await TrainingVideo.create({
      title: title.trim(), audience, url, publicId,
      order: Number(order) || 0,
      requireExisting: String(requireExisting) === 'true',
    });
    res.status(201).json({ success: true, video });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (tmp) fs.unlink(tmp, () => {});
  }
};

const adminUpdate = async (req, res) => {
  try {
    const patch = {};
    ['title', 'audience', 'order', 'active', 'requireExisting'].forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
    if (patch.audience && !['worker', 'user'].includes(patch.audience)) return res.status(400).json({ success: false, message: 'Bad audience' });
    const video = await TrainingVideo.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    res.status(200).json({ success: true, video });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const adminDelete = async (req, res) => {
  try {
    const video = await TrainingVideo.findByIdAndDelete(req.params.id);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    await TrainingProgress.deleteMany({ video: video._id });
    if (video.publicId) cloudinary.uploader.destroy(video.publicId, { resource_type: 'video' }).catch(() => {});
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getStatus, markComplete, adminList, adminCreate, adminUpdate, adminDelete };