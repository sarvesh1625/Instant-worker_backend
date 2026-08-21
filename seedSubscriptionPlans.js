// ONE-TIME SETUP — run once after deploying the updated SubscriptionPlan
// model and controllers:
//   node seedSubscriptionPlans.js
//
// Creates your three real plans — BOTH in Razorpay (so they can actually be
// subscribed to and billed) AND in your database. Safe to run more than
// once — skips any plan whose name already exists instead of duplicating it.
// Requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to already be in .env.
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
const Razorpay = require('razorpay');
dotenv.config();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLANS_TO_CREATE = [
  { name: 'Monthly',    price: 60,  intervalMonths: 1, description: 'Instant job access, billed every month' },
  { name: '3 Months',   price: 150, intervalMonths: 3, description: 'Instant job access, billed every 3 months' },
  { name: '6 Months',   price: 250, intervalMonths: 6, description: 'Instant job access, billed every 6 months' },
];

// FIX: Razorpay's SDK throws errors shaped like
// { statusCode, error: { code, description, ... } } — NOT a normal
// Error with a .message property. Previously logging err.message printed
// "undefined" every time, hiding the actual rejection reason. This prints
// the real description Razorpay gives, whatever it is.
function describeRazorpayError(err) {
  if (err?.error?.description) return `${err.error.description} (code: ${err.error.code || 'unknown'})`;
  if (err?.message) return err.message;
  return JSON.stringify(err);
}

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected. Creating subscription plans...');
  console.log('Using Razorpay key:', process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.slice(0, 12) + '...' : 'MISSING — check .env');

  const SubscriptionPlan = require('./models/SubscriptionPlan');

  for (let i = 0; i < PLANS_TO_CREATE.length; i++) {
    const p = PLANS_TO_CREATE[i];

    const existing = await SubscriptionPlan.findOne({ name: p.name });
    if (existing) {
      console.log(`Already exists, skipping: ${p.name}`);
      continue;
    }

    try {
      const razorpayPlan = await razorpay.plans.create({
        period:   'monthly',
        interval: p.intervalMonths,
        item: {
          name: p.name,
          amount: p.price * 100,
          currency: 'INR',
          description: p.description,
        },
      });

      await SubscriptionPlan.create({
        name: p.name,
        description: p.description,
        price: p.price,
        intervalMonths: p.intervalMonths,
        razorpayPlanId: razorpayPlan.id,
        order: i,
        features: { priorityPlacement: true },
      });

      console.log(`Created: ${p.name} — ₹${p.price} every ${p.intervalMonths} month(s) (Razorpay plan ${razorpayPlan.id})`);
    } catch (err) {
      console.error(`Failed to create ${p.name}: ${describeRazorpayError(err)}`);
    }
  }

  console.log('Done!');
  process.exit(0);
}).catch(err => {
  console.error('Seed failed:', describeRazorpayError(err));
  process.exit(1);
});