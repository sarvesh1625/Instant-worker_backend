const mongoose = require('mongoose');

// A chat a hirer started straight from a worker's profile, without posting a job.
// `pair` is the same sorted "idA_idB" string Message.getConversationId() builds.
const directChatSchema = new mongoose.Schema({
  pair:   { type: String, required: true, unique: true },
  hirer:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('DirectChat', directChatSchema);