// ONE-TIME FIX — run once after deploying the poster.totalJobsPosted
// increment fix in jobController.createJob:
//   node recomputeJobCounters.js
//
// The increment only applies going forward to NEWLY created jobs — any
// job posted before that fix went live never got counted. This script
// recalculates poster.totalJobsPosted for every 'user' role account by
// actually counting their jobs in the database, fixing the number for
// everyone in one pass regardless of when they posted.
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected. Recomputing job-posted counters...');
  const User = require('./models/User');
  const Job  = require('./models/Job');

  const posters = await User.find({ role: 'user' }).select('_id name');
  let updated = 0;

  for (const poster of posters) {
    const realCount = await Job.countDocuments({ postedBy: poster._id });
    await User.findByIdAndUpdate(poster._id, { 'poster.totalJobsPosted': realCount });
    if (realCount > 0) {
      console.log(`${poster.name}: ${realCount} job(s)`);
      updated++;
    }
  }

  console.log(`Done! Recomputed counters for ${posters.length} poster(s), ${updated} had jobs.`);
  process.exit(0);
}).catch(err => {
  console.error('Recompute failed:', err.message);
  process.exit(1);
});