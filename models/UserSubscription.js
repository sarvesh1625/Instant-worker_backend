const mongoose = require('mongoose');

// One record per user's subscription lifecycle. A user with NO record here
// is simply on the free tier — this table only exists for people who have
// (or had) a paid plan. This is deliberate: the free-tier majority of your
// users never touch this collection at all.
const userSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },

  status: {
    type: String,
    enum: [
      'pending',   // checkout started, first payment not yet confirmed
      'active',    // paid and currently in a valid billing period
      'cancelled', // user or admin cancelled — stays active until currentPeriodEnd, then treated as expired
      'expired',   // billing period ended with no renewal (payment failed, or cancelled and period passed)
    ],
    default: 'pending',
  },

  // Razorpay's own identifiers — needed to look up / modify / cancel this
  // subscription via their API later, and to match incoming webhook events
  // back to the correct local record.
  razorpaySubscriptionId: { type: String, required: true },
  razorpayCustomerId:     { type: String },

  currentPeriodStart: { type: Date },
  currentPeriodEnd:   { type: Date }, // when this billing cycle ends / next charge is due
  cancelledAt:         { type: Date },

  // Set true when an admin manually grants access without a real payment
  // (comped account, dispute resolution, testing). Lets you distinguish
  // "genuinely paid" from "admin override" in reporting later.
  grantedByAdmin: { type: Boolean, default: false },
}, { timestamps: true });

// A user should only ever have ONE subscription record actively in play
// at a time — enforced at the application level in the controller, not
// here, since "one active at a time" still allows keeping historical
// cancelled/expired records for that same user.
userSubscriptionSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('UserSubscription', userSubscriptionSchema);