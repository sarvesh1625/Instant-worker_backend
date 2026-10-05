const User = require('../models/User');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─────────────────────────────────────────────────────────────────────────────
// Worker search
//
//  • With the user's coordinates (lat/lng): only workers within 150 km are
//    returned — anyone farther away, or who has no stored location, is hidden.
//  • Best-rated workers first. A plain average would let ONE 5-star review beat
//    a worker with 60 reviews averaging 4.8, so the score pulls small samples
//    toward 4.0 (as if every worker had 3 extra "neutral" reviews). Ties
//    (e.g. several unrated workers) are broken by distance, nearest first.
//  • Category: when `skill` is sent, only that category is returned.
//  • Without coordinates (user said no to location): falls back to the city /
//    area text match, same ranking, no distance cut-off.
//
// Results only contain public profile fields. They NEVER include the worker's
// phone number or exact GPS point — only a rounded `distanceKm`.
// ─────────────────────────────────────────────────────────────────────────────
const SEARCH_RADIUS_METERS = 150 * 1000;   // 150 km
const RATING_PRIOR_MEAN = 4.0;
const RATING_PRIOR_WEIGHT = 3;

// Inclusion list on purpose: aggregation ignores the schema's `select: false`,
// so anything not listed here (password hash, otp, phone, GPS) is never sent.
const WORKER_PUBLIC_FIELDS = {
  name: 1, profilePhoto: 1, city: 1, area: 1, bio: 1, languages: 1, isVerified: 1,
  'idVerification.status': 1, createdAt: 1,
  'worker.skill': 1, 'worker.skills': 1, 'worker.experience': 1, 'worker.wagePerDay': 1,
  'worker.availability': 1, 'worker.rating': 1, 'worker.totalJobsDone': 1,
  distanceKm: 1,
};

const buildSearchPipeline = ({ match, geo, skip, limit }) => {
  const stages = [];

  if (geo) {
    stages.push({
      $geoNear: {
        near: { type: 'Point', coordinates: [geo.lng, geo.lat] },
        key: 'worker.location',
        distanceField: 'distanceMeters',
        maxDistance: SEARCH_RADIUS_METERS,
        spherical: true,
        query: match,
      },
    });
  } else {
    stages.push({ $match: match });
  }

  const ratingCount = { $ifNull: ['$worker.rating.count', 0] };
  const ratingAvg   = { $ifNull: ['$worker.rating.average', 0] };
  stages.push({
    $addFields: {
      ratingScore: {
        $divide: [
          { $add: [{ $multiply: [ratingAvg, ratingCount] }, RATING_PRIOR_MEAN * RATING_PRIOR_WEIGHT] },
          { $add: [ratingCount, RATING_PRIOR_WEIGHT] },
        ],
      },
      ...(geo ? { distanceKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 1] } } : {}),
    },
  });

  stages.push({
    $sort: geo
      ? { ratingScore: -1, distanceMeters: 1, createdAt: -1 }
      : { ratingScore: -1, 'worker.availability': -1, createdAt: -1 },
  });

  stages.push({
    $facet: {
      rows:  [{ $skip: skip }, { $limit: limit }, { $project: WORKER_PUBLIC_FIELDS }],
      total: [{ $count: 'n' }],
    },
  });

  return stages;
};

const searchWorkers = async (req, res) => {
  try {
    const { skill, city, availability, lat, lng } = req.query;
    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const match = { role: 'worker', accountStatus: 'active' };

    if (skill && skill.trim()) {
      match['worker.skill'] = { $regex: `^${escapeRegex(skill.trim())}$`, $options: 'i' };
    }
    if (availability === 'true')  match['worker.availability'] = true;
    if (availability === 'false') match['worker.availability'] = false;

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const hasGeo = Number.isFinite(latNum) && Number.isFinite(lngNum);

    if (!hasGeo && city && city.trim()) {
      const c = escapeRegex(city.trim());
      match.$or = [
        { city: { $regex: c, $options: 'i' } },
        { area: { $regex: c, $options: 'i' } },
      ];
    }

    const pipeline = buildSearchPipeline({
      match,
      geo: hasGeo ? { lat: latNum, lng: lngNum } : null,
      skip: (page - 1) * limit,
      limit,
    });

    const [out] = await User.aggregate(pipeline);
    const workers = out?.rows || [];
    const total = out?.total?.[0]?.n || 0;

    res.status(200).json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
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

// Going ONLINE needs the worker's location. The app sends lat/lng with the
// request; they are saved here in the same step, so "online" and "has a
// location" can never be out of sync. Going OFFLINE needs nothing.
//
// To switch the rule off temporarily (e.g. while the web app doesn't send a
// location yet), set  REQUIRE_LOCATION_TO_GO_ONLINE=false  in the environment.
const REQUIRE_LOCATION_TO_GO_ONLINE = process.env.REQUIRE_LOCATION_TO_GO_ONLINE !== 'false';

const toggleAvailability = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'worker') {
      return res.status(403).json({ success: false, message: 'Workers only' });
    }

    const goingOnline = !user.worker.availability;

    if (goingOnline) {
      const latNum = parseFloat(req.body?.lat);
      const lngNum = parseFloat(req.body?.lng);
      const valid =
        Number.isFinite(latNum) && Number.isFinite(lngNum) &&
        latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180 &&
        !(latNum === 0 && lngNum === 0);          // (0,0) is what a failed GPS fix often reports

      if (valid) {
        user.worker.location = { type: 'Point', coordinates: [lngNum, latNum] };
        user.worker.locationUpdatedAt = new Date();
      } else if (REQUIRE_LOCATION_TO_GO_ONLINE) {
        return res.status(400).json({
          success: false,
          code: 'LOCATION_REQUIRED',
          message: 'Turn on your location to go online. People near you can only find you when your location is on.',
        });
      }
    }

    user.worker.availability = goingOnline;
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