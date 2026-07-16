// FRESH START SCRIPT — deletes ALL data. Run: node resetData.js
// Then re-create admin: node seedAdmin.js
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected. Dropping entire database...');
  await mongoose.connection.dropDatabase();
  console.log('✅ All data deleted. Database is fresh.');
  console.log('👉 Now run: node seedAdmin.js to recreate your admin account.');
  process.exit(0);
}).catch(err => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
