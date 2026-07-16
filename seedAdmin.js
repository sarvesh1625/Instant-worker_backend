// Run this once to create your first admin account:
// node seedAdmin.js
console.log('Script starting...');
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const ADMIN_NAME     = 'Sarvesh Admin';
const ADMIN_PHONE    = '9999999999';
const ADMIN_PASSWORD = 'Admin@12345';

async function seedAdmin() {
  try {
    if (!process.env.MONGO_URI) { console.error('ERROR: MONGO_URI is not set!'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB successfully');

    const existing = await User.findOne({ phone: ADMIN_PHONE });
    if (existing) {
      console.log('A user with this phone already exists:', existing.name);
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        await existing.save();
        console.log('Existing user promoted to admin role.');
      } else {
        console.log('This user is already an admin.');
      }
      await mongoose.disconnect();
      process.exit(0);
    }

    const admin = await User.create({
      name: ADMIN_NAME, phone: ADMIN_PHONE, password: ADMIN_PASSWORD,
      role: 'admin', accountStatus: 'active', isVerified: true,
    });
    console.log('Admin created successfully! Phone:', ADMIN_PHONE, 'Password:', ADMIN_PASSWORD);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('ERROR creating admin:', err.message);
    process.exit(1);
  }
}
seedAdmin();
