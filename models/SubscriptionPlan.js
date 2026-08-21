const mongoose = require('mongoose');

// FIX: billingCycle was previously locked to just 'monthly'/'yearly', which
// couldn't represent a 3-month or 6-month plan at all. Replaced with
// intervalMonths (a plain number of months per billing cycle) — this maps
// directly onto Razorpay's own period/interval system: Razorpay charges
// every `interval` units of `period`, and using period:'monthly' with
// interval: intervalMonths covers 1, 3, 6, or any other month-based cycle
// with the same code path, no special-casing needed per plan.
const subscriptionPlanSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price:       { type: Number, required: true }, // total rupees charged PER billing cycle, not per month
  intervalMonths: { type: Number, required: true, enum: [1, 3, 6, 12] }, // how many months between charges

  razorpayPlanId: { type: String, required: true },

  features: {
    unlimitedJobPosts: { type: Boolean, default: false },
    freeJobPostLimit:  { type: Number, default: 3 },
    priorityPlacement: { type: Boolean, default: false },
    analyticsAccess:   { type: Boolean, default: false },
    bulkHiring:        { type: Boolean, default: false },
  },

  active: { type: Boolean, default: true },
  order:  { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);