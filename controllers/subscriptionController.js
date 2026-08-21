const Razorpay = require('razorpay');
const crypto   = require('crypto');
const SubscriptionPlan  = require('../models/SubscriptionPlan');
const UserSubscription  = require('../models/UserSubscription');
const PlatformSettings  = require('../models/PlatformSettings');
const User = require('../models/User');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const getPublicStatus = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    res.status(200).json({ success: true, enabled: settings.subscriptionsEnabled });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPlans = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    if (!settings.subscriptionsEnabled) {
      return res.status(200).json({ success: true, plans: [], enabled: false });
    }
    const plans = await SubscriptionPlan.find({ active: true }).sort({ order: 1, price: 1 });
    res.status(200).json({ success: true, plans, enabled: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMySubscription = async (req, res) => {
  try {
    const sub = await UserSubscription.findOne({
      user: req.user._id,
      status: { $in: ['active', 'cancelled'] },
    }).populate('plan').sort({ createdAt: -1 });

    res.status(200).json({ success: true, subscription: sub || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createCheckout = async (req, res) => {
  try {
    const settings = await PlatformSettings.getSettings();
    if (!settings.subscriptionsEnabled) {
      return res.status(403).json({ success: false, message: 'Subscriptions are not currently available' });
    }

    const { planId } = req.body;
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan || !plan.active) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const existing = await UserSubscription.findOne({ user: req.user._id, status: 'active' });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have an active subscription' });
    }

    const totalCount = Math.max(1, Math.floor(120 / plan.intervalMonths));

    const razorpaySub = await razorpay.subscriptions.create({
      plan_id: plan.razorpayPlanId,
      customer_notify: 1,
      total_count: totalCount,
      notes: { userId: req.user._id.toString(), planId: plan._id.toString() },
    });

    await UserSubscription.create({
      user: req.user._id,
      plan: plan._id,
      status: 'pending',
      razorpaySubscriptionId: razorpaySub.id,
    });

    res.status(200).json({
      success: true,
      razorpaySubscriptionId: razorpaySub.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      plan: { name: plan.name, price: plan.price, intervalMonths: plan.intervalMonths },
    });
  } catch (err) {
    console.error('Checkout creation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  POST /api/subscriptions/verify
// @desc   NEW — called immediately by the frontend the moment Razorpay's
//         checkout widget reports success, using the payment_id,
//         subscription_id, and signature it hands back at that exact
//         moment. This gives INSTANT activation without waiting for the
//         webhook at all — important because webhooks can be delayed, or
//         (during local testing) can never arrive if your backend isn't on
//         a public URL.
//
//         This is safe to do instantly because the signature is
//         cryptographically verified below — it's mathematically
//         impossible to fake without knowing your Razorpay secret key,
//         which only your backend and Razorpay itself know. The webhook
//         (handleWebhook below) still exists and still matters — it's what
//         keeps the subscription in sync for every RENEWAL after this
//         first payment, not just the initial one.
// @access Private
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment verification details' });
    }

    // Razorpay's documented formula for subscription checkout signatures:
    // HMAC-SHA256 of "payment_id|subscription_id", signed with your key secret.
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('Signature mismatch — possible tampering attempt, or a genuine mismatch worth investigating.');
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    const sub = await UserSubscription.findOne({
      razorpaySubscriptionId: razorpay_subscription_id,
      user: req.user._id, // extra safety: only the user who started this checkout can verify it
    });
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Subscription record not found' });
    }

    // Pull the real period dates from Razorpay directly, rather than
    // guessing — belt-and-suspenders alongside the signature check.
    try {
      const razorpaySub = await razorpay.subscriptions.fetch(razorpay_subscription_id);
      if (razorpaySub.current_start) sub.currentPeriodStart = new Date(razorpaySub.current_start * 1000);
      if (razorpaySub.current_end)   sub.currentPeriodEnd   = new Date(razorpaySub.current_end * 1000);
    } catch (fetchErr) {
      console.error('Could not fetch period dates, activating anyway:', fetchErr.message);
    }

    sub.status = 'active';
    await sub.save();

    res.status(200).json({ success: true, message: 'Subscription activated', subscription: sub });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest('hex');

    if (signature !== expected) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    const payload = req.body.payload.subscription?.entity;
    if (!payload) return res.status(200).json({ success: true });

    const sub = await UserSubscription.findOne({ razorpaySubscriptionId: payload.id });
    if (!sub) return res.status(200).json({ success: true });

    switch (event) {
      case 'subscription.activated':
      case 'subscription.charged':
        sub.status = 'active';
        sub.currentPeriodStart = new Date(payload.current_start * 1000);
        sub.currentPeriodEnd   = new Date(payload.current_end * 1000);
        await sub.save();
        break;
      case 'subscription.cancelled':
        sub.status = 'cancelled';
        sub.cancelledAt = new Date();
        await sub.save();
        break;
      case 'subscription.completed':
      case 'subscription.halted':
        sub.status = 'expired';
        await sub.save();
        break;
      default:
        break;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Webhook handling error:', err);
    res.status(500).json({ success: false });
  }
};

const cancelMySubscription = async (req, res) => {
  try {
    const sub = await UserSubscription.findOne({ user: req.user._id, status: 'active' });
    if (!sub) return res.status(404).json({ success: false, message: 'No active subscription found' });

    await razorpay.subscriptions.cancel(sub.razorpaySubscriptionId, { cancel_at_cycle_end: 1 });

    sub.status = 'cancelled';
    sub.cancelledAt = new Date();
    await sub.save();

    res.status(200).json({ success: true, message: 'Subscription will end on ' + sub.currentPeriodEnd?.toLocaleDateString('en-IN') });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getPublicStatus, getPlans, getMySubscription, createCheckout, verifyPayment, handleWebhook, cancelMySubscription };