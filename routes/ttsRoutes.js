const express = require('express');
const router  = express.Router();
const https   = require('https');

// @route  GET /api/tts?text=...&lang=te
// @desc   Proxy Google Translate TTS audio to avoid CORS
// @access Public
router.get('/', (req, res) => {
  const { text, lang = 'en' } = req.query;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const safeText  = decodeURIComponent(text).slice(0, 200);
  const encoded   = encodeURIComponent(safeText);
  const langCode  = ['te', 'hi', 'en', 'ta', 'kn', 'ml', 'mr', 'bn', 'gu'].includes(lang) ? lang : 'en';
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${langCode}&client=tw-ob&ttsspeed=0.9`;

  const options = {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Referer':         'https://translate.google.com/',
      'Accept':          'audio/mpeg, audio/*, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  https.get(url, options, (ttsRes) => {
    if (ttsRes.statusCode === 200) {
      ttsRes.pipe(res);
    } else {
      res.status(ttsRes.statusCode).json({ error: 'TTS fetch failed', status: ttsRes.statusCode });
    }
  }).on('error', (err) => {
    console.error('TTS proxy error:', err.message);
    res.status(500).json({ error: 'TTS server error' });
  });
});

module.exports = router;
