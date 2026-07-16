// ONE-TIME CLEANUP — run once after deploying the fixed User.js/Job.js:
//   node fixGeoIndex.js
//
// Finds any User or Job documents left with a half-formed GeoJSON point
// (type set, coordinates missing/invalid) from before the schema fix, and
// removes just that broken field. Nothing else on the document is touched
// — a user/job simply goes back to having "no location set", which is
// exactly the correct state for data that never had real coordinates.
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected. Scanning for corrupted geo fields...');

  const User = require('./models/User');
  const Job  = require('./models/Job');

  const userResult = await User.updateMany(
    {
      'worker.location.type': { $exists: true },
      $or: [
        { 'worker.location.coordinates': { $exists: false } },
        { 'worker.location.coordinates': { $size: 0 } },
        { 'worker.location.coordinates': { $size: 1 } },
      ],
    },
    { $unset: { 'worker.location': '' } }
  );
  console.log(`Users fixed: ${userResult.modifiedCount}`);

  const jobResult = await Job.updateMany(
    {
      'location.point.type': { $exists: true },
      $or: [
        { 'location.point.coordinates': { $exists: false } },
        { 'location.point.coordinates': { $size: 0 } },
        { 'location.point.coordinates': { $size: 1 } },
      ],
    },
    { $unset: { 'location.point': '' } }
  );
  console.log(`Jobs fixed: ${jobResult.modifiedCount}`);

  console.log('Done! Corrupted geo fields cleared — location can now be set fresh next time it updates.');
  process.exit(0);
}).catch(err => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});