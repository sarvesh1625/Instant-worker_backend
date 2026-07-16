// ⚠️ DEAD CODE — NOT WIRED UP. server/index.js mounts routes/ttsRoutes.js
// (the plain-https proxy version), not this one. This file requires the
// google-tts-api npm package which was never installed/used. Safe to delete
// unless you intentionally plan to switch TTS implementations later.
const { getAudioBase64 } = require('google-tts-api');

const LANG_MAP = { en: 'en', hi: 'hi', te: 'te' };
const cache = new Map();
const MAX_CACHE = 300;

const getTTS = async (req, res) => {
  try {
    const { text, lang } = req.query;
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'text is required' });
    if (text.length > 200) return res.status(400).json({ success: false, message: 'text too long — split into chunks under 200 characters' });

    const ttsLang = LANG_MAP[lang] || 'en';
    const cacheKey = `${ttsLang}::${text}`;
    let base64 = cache.get(cacheKey);
    if (!base64) {
      base64 = await getAudioBase64(text, { lang: ttsLang, slow: false, host: 'https://translate.google.com' });
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, base64);
    }
    const buffer = Buffer.from(base64, 'base64');
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buffer.length, 'Cache-Control': 'public, max-age=86400' });
    res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ success: false, message: 'Could not generate audio right now' });
  }
};

module.exports = { getTTS };
