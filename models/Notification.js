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
  // Kept for backward compatibility with notifications created before this
  // change, and as a safe fallback if `meta` is ever missing.
  title: { type: String, required: true },
  body:  { type: String, required: true },

  // FIX: previously the only thing stored was a pre-written English
  // sentence, baked in permanently at creation time — meaning a Telugu or
  // Hindi user always saw English notification text regardless of their
  // language setting, no matter how well everything else translated.
  // `meta` stores the raw pieces (names, job titles, amounts) so the
  // frontend can construct the message in whichever language the person is
  // currently viewing in. See LangContext.jsx's notif*Title/notif*Body keys
  // and Notifications.jsx's buildNotifText().
  meta: { type: mongoose.Schema.Types.Mixed, default: null },

  link:  { type: String, default: '/dashboard' },
  read:  { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);