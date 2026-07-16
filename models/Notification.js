const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: [
      'job_applied', 'applicant_accepted', 'applicant_rejected',
      'new_message', 'new_review', 'job_closed',
      'work_started', 'work_completed',
      'urgent_job', 'urgent_filled',
    ],
    required: true,
  },
  title: { type: String, required: true },
  body:  { type: String, required: true },
  link:  { type: String, default: '/dashboard' },
  read:  { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
