const Transaction = require('../models/Transaction');

const getMyWallet = async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user._id })
      .populate('counterparty', 'name').populate('job', 'title').sort({ createdAt: -1 });

    let totalEarned = 0;
    let totalSpent  = 0;
    for (const t of transactions) {
      if (t.type === 'credit') totalEarned += t.amount;
      else totalSpent += t.amount;
    }

    res.status(200).json({ success: true, totalEarned, totalSpent, count: transactions.length, transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getMyWallet };
