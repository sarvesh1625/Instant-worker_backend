const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reportedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  reporterRole: { type: String, enum: ['worker', 'contractor', 'vendor', 'customer'] },
  reason: {
    type: String,
    enum: [
      'no_show', 'unsafe_behavior', 'fake_profile', 'wrong_info', 'spam', 'other',
      'no_payment', 'underpaid', 'unsafe_worksite', 'job_misrepresented',
      'left_early', 'poor_quality_work', 'damaged_property', 'asked_extra_money',
      'no_payment_materials', 'order_dispute',
    ],
    required: true,
  },
  description: { type: String, maxlength: 500 },
  status: { type: String, enum: ['pending', 'reviewing', 'resolved', 'dismissed'], default: 'pending' },
  adminNote:  { type: String, default: '' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);
