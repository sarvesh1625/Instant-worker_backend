const mongoose = require('mongoose');

// Cache of translated texts so each sentence is translated (and paid for) once.
const translationSchema = new mongoose.Schema({
  key:        { type: String, required: true, unique: true },   // sha256(lang + "\n" + text)
  lang:       { type: String, required: true },
  text:       { type: String, required: true },
  translated: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Translation', translationSchema);