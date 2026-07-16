const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:  { type: String, enum: ['credit', 'debit'], required: true },
  amount:{ type: Number, required: true, min: 0 },
  job:   { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  counterparty: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  note:  { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
