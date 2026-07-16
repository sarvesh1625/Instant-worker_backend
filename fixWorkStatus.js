// One-off migration — backfills workStatus on legacy accepted applicants
// that predate the Job schema fix. Safe to run multiple times.
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Job = require('./models/Job');
  const jobs = await Job.find({ 'applicants.status': 'accepted' });
  for (const job of jobs) {
    let changed = false;
    for (const a of job.applicants) {
      if (a.status === 'accepted' && !a.workStatus) {
        a.workStatus = 'not_started';
        changed = true;
        console.log(`Fixed: job "${job.title}" — worker ${a.worker}`);
      }
    }
    if (changed) await job.save();
  }
  console.log('Done!');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
