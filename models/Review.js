const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 400, trim: true },
  reviewerRole: {
    type: String,
    enum: ['worker', 'user', 'contractor', 'vendor', 'customer'],
  },
}, { timestamps: true });

reviewSchema.pre('save', function (next) {
  if (this.reviewedBy.toString() === this.reviewedUser.toString()) {
    return next(new Error('Cannot review yourself'));
  }
  next();
});

reviewSchema.index({ reviewedBy: 1, reviewedUser: 1, job: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Review', reviewSchema);
