// ONE-TIME BACKFILL — run once after deploying the fixed jobController.js:
//   node backfillJobLocations.js
//
// Finds any OPEN jobs that have no location.point at all (posted before
// this fix, or where the poster skipped the location picker) and gives
// them an approximate city-center point, using the same CITY_COORDS table
// as the fixed createJob. This makes them visible again in radius search
// immediately, without anyone needing to repost them.
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
dotenv.config();

const CITY_COORDS = {
  Hyderabad:      { lat: 17.3850, lng: 78.4867 },
  Visakhapatnam:  { lat: 17.6868, lng: 83.2185 },
  Vijayawada:     { lat: 16.5062, lng: 80.6480 },
  Warangal:       { lat: 17.9689, lng: 79.5941 },
  Tirupati:       { lat: 13.6288, lng: 79.4192 },
  Bengaluru:      { lat: 12.9716, lng: 77.5946 },
  Chennai:        { lat: 13.0827, lng: 80.2707 },
  Mumbai:         { lat: 19.0760, lng: 72.8777 },
  Delhi:          { lat: 28.7041, lng: 77.1025 },
  Pune:           { lat: 18.5204, lng: 73.8567 },
};

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected. Finding jobs with no location point...');
  const Job = require('./models/Job');

  const jobs = await Job.find({
    status: 'open',
    $or: [
      { 'location.point': { $exists: false } },
      { 'location.point.coordinates': { $exists: false } },
    ],
  });

  console.log(`Found ${jobs.length} open job(s) missing a location point.`);
  let fixed = 0;

  for (const job of jobs) {
    const coords = CITY_COORDS[job.location.city];
    if (!coords) {
      console.log(`Skipping "${job.title}" — city "${job.location.city}" not in CITY_COORDS table.`);
      continue;
    }
    job.location.lat = coords.lat;
    job.location.lng = coords.lng;
    job.location.point = { type: 'Point', coordinates: [coords.lng, coords.lat] };
    await job.save();
    console.log(`Fixed: "${job.title}" (${job.location.city})`);
    fixed++;
  }

  console.log(`Done! ${fixed} job(s) backfilled with a city-center location.`);
  process.exit(0);
}).catch(err => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});