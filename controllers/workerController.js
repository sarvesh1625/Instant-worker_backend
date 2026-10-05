const User = require('../models/User');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// CHANGED: added optional lat/lng params. When sent, results are filtered
// to within 100km using the worker.location geo field your updateMyLocation
// endpoint already populates, sorted by distance (closest first). Falls
// back to the ORIGINAL city/area text search + availability/rating sort
// when coordinates aren't sent — nothing breaks for callers that don't
// send them yet.
const SEARCH_RADIUS_METERS = 100 * 1000; // 100km

const searchWorkers = async (req, res) => {
  try {
    const { skill, city, availability, lat, lng, page = 1, limit = 20 } = req.query;

    const query = {
      role: 'worker',
      accountStatus: 'active',
    };

    if (skill && skill.trim()) {
      query['worker.skill'] = { $regex: `^${escapeRegex(skill.trim())}$`, $options: 'i' };
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const hasGeo = !isNaN(latNum) && !isNaN(lngNum);

    if (hasGeo) {
      query['worker.location'] = {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [lngNum, latNum] },
          $maxDistance: SEARCH_RADIUS_METERS,
        },
      };
    } else if (city && city.trim()) {
      const c = escapeRegex(city.trim());
      query.$or = [
        { city: { $regex: c, $options: 'i' } },
        { area: { $regex: c, $options: 'i' } },
      ];
    }

    if (availability === 'true')  query['worker.availability'] = true;
    if (availability === 'false') query['worker.availability'] = false;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(query);

    // $nearSphere already sorts by distance and can't be combined with an
    // additional .sort() — MongoDB errors if you try. The availability/
    // rating sort only applies to the non-geo (city-text) fallback path.
    let workersQuery = User.find(query)
      .select('name phone profilePhoto city area bio languages worker isVerified idVerification.status createdAt')
      .skip(skip)
      .limit(Number(limit));

    if (!hasGeo) {
      workersQuery = workersQuery.sort({ 'worker.availability': -1, 'worker.rating.average': -1, createdAt: -1 });
    }

    const workers = await workersQuery;

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      geoSearch: hasGeo,
      radiusKm: hasGeo ? SEARCH_RADIUS_METERS / 1000 : undefined,
      workers,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getWorkerById = async (req, res) => {
  try {
    const worker = await User.findOne({ _id: req.params.id, role: 'worker' })
      .select('name phone profilePhoto city area bio languages worker isVerified idVerification.status createdAt');

    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    res.status(200).json({ success: true, worker });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyWorkerProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -otp');
    if (!user || user.role !== 'worker') {
      return res.status(403).json({ success: false, message: 'Workers only' });
    }

    res.status(200).json({
      success: true,
      profile: {
        skill:        user.worker?.skill || '',
        skills:       user.worker?.skills || [],
        experience:   user.worker?.experience || 0,
        wage:         { amount: user.worker?.wagePerDay || 0 },
        availability: user.worker?.availability ?? true,
        rating:       user.worker?.rating || { average: 0, count: 0 },
        totalJobsDone: user.worker?.totalJobsDone || 0,
        location:     { city: user.city || '', area: user.area || '' },
        description:  user.bio || '',
        languages:    user.languages || [],
        profilePhoto: user.profilePhoto || '',
        name:         user.name,
        phone:        user.phone,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const upsertWorkerProfile = async (req, res) => {
  try {
    const { skill, experience, city, area, wage, description, availability, languages } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role !== 'worker') {
      return res.status(403).json({ success: false, message: 'Only workers can set a worker profile' });
    }

    if (city  !== undefined) user.city = city;
    if (area  !== undefined) user.area = area;
    if (description !== undefined) user.bio = description;
    if (languages !== undefined) {
      user.languages = Array.isArray(languages)
        ? languages
        : String(languages).split(',').map(l => l.trim()).filter(Boolean);
    }

    if (skill        !== undefined) user.worker.skill        = skill;
    if (experience   !== undefined) user.worker.experience   = Number(experience) || 0;
    if (wage         !== undefined) user.worker.wagePerDay   = Number(wage) || 0;
    if (availability !== undefined) user.worker.availability = !!availability;

    user.isProfileComplete = !!(user.name && user.city && user.worker.skill && user.worker.wagePerDay);

    await user.save();

    const updated = await User.findById(user._id).select('-password -otp');
    res.status(200).json({ success: true, message: 'Profile saved', user: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const toggleAvailability = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'worker') {
      return res.status(403).json({ success: false, message: 'Workers only' });
    }
    user.worker.availability = !user.worker.availability;
    await user.save();
    res.status(200).json({
      success: true,
      availability: user.worker.availability,
      message: user.worker.availability ? 'You are now available' : 'You are now unavailable',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  PATCH /api/workers/location
// @desc   Update my current GPS location — powers radius-based job matching
// @access Private (worker)
const updateMyLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({ success: false, message: 'Valid lat and lng are required' });
    }

    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'worker') {
      return res.status(403).json({ success: false, message: 'Workers only' });
    }

    user.worker.location = { type: 'Point', coordinates: [lngNum, latNum] };
    user.worker.locationUpdatedAt = new Date();
    await user.save();

    res.status(200).json({ success: true, message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  searchWorkers,
  getWorkerById,
  getMyWorkerProfile,
  upsertWorkerProfile,
  toggleAvailability,
  updateMyLocation,
};