const Razorpay = require('razorpay');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const UserSubscription = require('../models/UserSubscription');
const Job = require('../models/Job');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const getAllPlansAdmin = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find().sort({ order: 1 });
    res.status(200).json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createPlan = async (req, res) => {
  try {
    const { name, description, price, intervalMonths, features } = req.body;
    if (!name || !price || !intervalMonths) {
      return res.status(400).json({ success: false, message: 'Name, price, and intervalMonths are required' });
    }
    if (![1, 3, 6, 12].includes(Number(intervalMonths))) {
      return res.status(400).json({ success: false, message: 'intervalMonths must be 1, 3, 6, or 12' });
    }

    const razorpayPlan = await razorpay.plans.create({
      period:   'monthly',
      interval: Number(intervalMonths),
      item: {
        name,
        amount: Math.round(price * 100),
        currency: 'INR',
        description: description || '',
      },
    });

    const plan = await SubscriptionPlan.create({
      name, description, price,
      intervalMonths: Number(intervalMonths),
      razorpayPlanId: razorpayPlan.id,
      features: features || {},
    });

    res.status(201).json({ success: true, message: 'Plan created', plan });
  } catch (err) {
    console.error('Create plan error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const updatePlan = async (req, res) => {
  try {
    const { name, description, active, features } = req.body;
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    if (name        !== undefined) plan.name = name;
    if (description !== undefined) plan.description = description;
    if (active      !== undefined) plan.active = active;
    if (features    !== undefined) plan.features = { ...plan.features.toObject(), ...features };
    await plan.save();

    res.status(200).json({ success: true, message: 'Plan updated', plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deactivatePlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    plan.active = false;
    await plan.save();
    res.status(200).json({ success: true, message: 'Plan deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllSubscriptions = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const subs = await UserSubscription.find(query)
      .populate('user', 'name phone role')
      .populate('plan', 'name price intervalMonths')
      .sort({ createdAt: -1 });

    const activeCount = subs.filter(s => s.status === 'active').length;
    const monthlyRevenue = subs
      .filter(s => s.status === 'active' && s.plan && !s.grantedByAdmin) // free grants never count as revenue
      .reduce((sum, s) => sum + (s.plan.price / s.plan.intervalMonths), 0);

    res.status(200).json({ success: true, subscriptions: subs, summary: { activeCount, monthlyRevenue: Math.round(monthlyRevenue) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const grantSubscription = async (req, res) => {
  try {
    const { userId, planId, durationDays } = req.body;
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    await UserSubscription.updateMany({ user: userId, status: 'active' }, { status: 'cancelled', cancelledAt: new Date() });

    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + (durationDays || plan.intervalMonths * 30));

    const sub = await UserSubscription.create({
      user: userId, plan: planId, status: 'active',
      razorpaySubscriptionId: `admin_grant_${Date.now()}`,
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      grantedByAdmin: true,
    });

    res.status(201).json({ success: true, message: 'Subscription granted', subscription: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  POST /api/admin/subscriptions/:id/cancel
// @desc   NEW — admin-side cancellation, distinct from the worker's own
//         self-cancel endpoint. Works on ANY subscriber's record, not just
//         the logged-in user's own. If it's a real paid subscription (not
//         an admin grant, identifiable by the razorpaySubscriptionId NOT
//         starting with "admin_grant_"), this also cancels it on Razorpay's
//         side — otherwise a free grant just gets marked cancelled locally,
//         since there's no real Razorpay object behind it to cancel.
// @access Private (admin)
const adminCancelSubscription = async (req, res) => {
  try {
    const sub = await UserSubscription.findById(req.params.id);
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    if (sub.status !== 'active') {
      return res.status(400).json({ success: false, message: `This subscription is already ${sub.status}, not active` });
    }

    const isRealPayment = !sub.razorpaySubscriptionId.startsWith('admin_grant_');

    if (isRealPayment) {
      try {
        await razorpay.subscriptions.cancel(sub.razorpaySubscriptionId, { cancel_at_cycle_end: 1 });
      } catch (razorpayErr) {
        console.error('Razorpay cancel error (proceeding to cancel locally anyway):', razorpayErr?.error?.description || razorpayErr.message);
        // Don't block the admin's action on a Razorpay-side hiccup — the
        // subscriber's access should still be revocable locally even if
        // the Razorpay call itself fails for some reason.
      }
    }

    sub.status = 'cancelled';
    sub.cancelledAt = new Date();
    await sub.save();

    res.status(200).json({
      success: true,
      message: isRealPayment
        ? 'Subscription cancelled. Access continues until the current billing period ends, same as a self-cancellation.'
        : 'Free grant revoked immediately.',
    });
  } catch (err) {
    console.error('Admin cancel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  GET /api/admin/leaderboard?period=week|month|3months
// @desc   NEW — ranks workers by number of jobs they've marked completed
//         within the chosen window, so the admin can identify top
//         performers to reward. Counting is based on Job.applicants'
//         workCompletedAt timestamp, which is set the moment a job poster
//         marks that specific worker's job as done (see
//         jobController.completeWork) — this is real, already-tracked
//         data, nothing new needed on the job-completion side.
// @access Private (admin)
const getLeaderboard = async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const now = new Date();
    let since;
    if (period === 'week') {
      since = new Date(now); since.setDate(now.getDate() - 7);
    } else if (period === '3months') {
      since = new Date(now); since.setMonth(now.getMonth() - 3);
    } else { // 'month'
      since = new Date(now); since.setMonth(now.getMonth() - 1);
    }

    const results = await Job.aggregate([
      { $unwind: '$applicants' },
      {
        $match: {
          'applicants.status': 'accepted',
          'applicants.workStatus': 'completed',
          'applicants.workCompletedAt': { $gte: since },
        },
      },
      {
        $group: {
          _id: '$applicants.worker',
          jobsCompleted: { $sum: 1 },
          totalEarned: { $sum: { $ifNull: ['$wage', 0] } },
        },
      },
      { $sort: { jobsCompleted: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'worker',
        },
      },
      { $unwind: '$worker' },
      {
        $project: {
          _id: 0,
          workerId: '$worker._id',
          name: '$worker.name',
          phone: '$worker.phone',
          skill: '$worker.worker.skill',
          rating: '$worker.worker.rating',
          jobsCompleted: 1,
          totalEarned: 1,
        },
      },
    ]);

    res.status(200).json({ success: true, period, since, leaderboard: results });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAllPlansAdmin, createPlan, updatePlan, deactivatePlan,
  getAllSubscriptions, grantSubscription, adminCancelSubscription,
  getLeaderboard,
};