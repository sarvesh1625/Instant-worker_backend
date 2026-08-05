// ONE-TIME SEED — run once after deploying the Skill model/routes:
//   node seedSkills.js
//
// Populates the Skill collection with the same 10 skills that were
// previously hardcoded across Register.jsx, PostJob.jsx,
// WorkerProfileSetup.jsx, etc. Safe to run more than once — skips any
// skill that already exists instead of creating a duplicate.
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
dotenv.config();

const DEFAULT_SKILLS = [
  'Labour', 'Painter', 'Carpenter', 'Electrician', 'Mechanic',
  'Farmer', 'Driver', 'Plumber', 'Welder', 'Other',
];

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected. Seeding default skills...');
  const Skill = require('./models/Skill');

  let created = 0;
  for (let i = 0; i < DEFAULT_SKILLS.length; i++) {
    const name = DEFAULT_SKILLS[i];
    const existing = await Skill.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
    if (existing) {
      console.log(`Already exists: ${name}`);
      continue;
    }
    await Skill.create({ name, order: i, active: true });
    console.log(`Created: ${name}`);
    created++;
  }

  console.log(`Done! ${created} skill(s) created.`);
  process.exit(0);
}).catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});