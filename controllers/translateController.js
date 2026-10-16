const crypto = require('crypto');
const https  = require('https');
const Translation = require('../models/Translation');

// POST /api/translate  { texts: ["..."], lang: "hi" | "te" | "en" }
// -> { translations: ["..."] }  (same order; falls back to the original text when it cannot translate)
//
// Needs an AI key on the server. Without one the app simply shows the original text.
//   XAI_API_KEY (or GROK_API_KEY)  -> Grok (xAI). Used first if present.
//   ANTHROPIC_API_KEY              -> Claude. Used only if there is no Grok key.
// TRANSLATE_MODEL: model name. Default grok-4 for Grok, claude-haiku-5-5 for Claude.
// Check your xAI console for the exact model names your key can use.

const LANG_NAME = { en: 'English', hi: 'Hindi', te: 'Telugu' };
const MAX_ITEMS = 20, MAX_LEN = 600;
const xaiKey = () => process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
const provider = () => (xaiKey() ? 'xai' : (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null));
const MODEL = () => process.env.TRANSLATE_MODEL || (provider() === 'xai' ? 'grok-4' : 'claude-haiku-5-5');
const systemPrompt = (lang) =>
  `You translate short texts from a labour-job app (job titles, descriptions, durations) into simple, ` +
  `everyday ${LANG_NAME[lang]} that workers with little education understand. Rules: keep people's names, ` +
  `phone numbers, numbers, dates and currency symbols as they are; keep place names recognisable; if a text is ` +
  `already in ${LANG_NAME[lang]}, return it unchanged; never add explanations. ` +
  `Reply with ONLY a JSON array of strings, the same length and order as the input.`;

const keyOf = (lang, text) => crypto.createHash('sha256').update(`${lang}\n${text}`).digest('hex');

const callAI = (lang, texts) => new Promise((resolve, reject) => {
  const xai = provider() === 'xai';
  const body = JSON.stringify(xai
    ? {
        model: MODEL(), temperature: 0,
        messages: [{ role: 'system', content: systemPrompt(lang) }, { role: 'user', content: JSON.stringify(texts) }],
      }
    : {
        model: MODEL(), max_tokens: 2000, system: systemPrompt(lang),
        messages: [{ role: 'user', content: JSON.stringify(texts) }],
      });
  const req = https.request(xai
    ? { host: 'api.x.ai', path: '/v1/chat/completions', method: 'POST', timeout: 30000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${xaiKey()}` } }
    : { host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', timeout: 25000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
                   'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } },
  (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const j = JSON.parse(data);
        if (res.statusCode >= 300) return reject(new Error(j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || `HTTP ${res.statusCode}`));
        const txt = (xai
          ? String(j?.choices?.[0]?.message?.content || '')
          : (j.content || []).map(b => b.text || '').join('')).trim();
        const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
        if (!Array.isArray(arr) || arr.length !== texts.length) return reject(new Error('bad shape'));
        resolve(arr.map(x => String(x)));
      } catch (e) { reject(e); }
    });
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.write(body); req.end();
});

const translate = async (req, res) => {
  try {
    const lang = String(req.body.lang || '');
    if (!LANG_NAME[lang]) return res.status(400).json({ success: false, message: 'Unsupported language' });
    const texts = Array.isArray(req.body.texts) ? req.body.texts.slice(0, MAX_ITEMS).map(t => String(t ?? '').trim().slice(0, MAX_LEN)) : [];
    if (texts.length === 0) return res.status(400).json({ success: false, message: 'texts required' });

    const out = texts.slice();
    const keys = texts.map(t => keyOf(lang, t));
    const cached = await Translation.find({ key: { $in: keys } }).select('key translated');
    const hit = new Map(cached.map(c => [c.key, c.translated]));

    const missing = [];   // indexes still to translate (non-empty, de-duplicated)
    const seen = new Map();
    texts.forEach((t, i) => {
      if (!t) return;
      if (hit.has(keys[i])) { out[i] = hit.get(keys[i]); return; }
      if (seen.has(t)) { seen.get(t).push(i); return; }
      seen.set(t, [i]); missing.push(t);
    });

    let translated = false;
    if (missing.length && provider()) {
      try {
        const result = await callAI(lang, missing);
        translated = true;
        const docs = [];
        missing.forEach((t, k) => {
          seen.get(t).forEach(i => { out[i] = result[k]; });
          docs.push({ key: keyOf(lang, t), lang, text: t, translated: result[k] });
        });
        Translation.insertMany(docs, { ordered: false }).catch(() => {});   // duplicates are fine
      } catch (e) {
        console.error('Translate error:', e.message);   // keep originals
      }
    }
    res.status(200).json({ success: true, translations: out, translated: translated || missing.length === 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { translate };