const https = require('https');
const PushToken = require('../models/PushToken');

// Sends phone notifications through Expo's push service (which relays to Google FCM).
// Nothing in here ever throws — a push failing must never break posting a job,
// accepting a worker, sending a message, etc.

const EXPO_URL = 'exp.host';
const EXPO_PATH = '/--/api/v2/push/send';
const CHUNK = 100;   // Expo's per-request limit

const post = (messages) => new Promise((resolve) => {
  const body = JSON.stringify(messages);
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const req = https.request({ host: EXPO_URL, path: EXPO_PATH, method: 'POST', headers, timeout: 15000 }, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
  });
  req.on('timeout', () => { req.destroy(); resolve(null); });
  req.on('error', () => resolve(null));
  req.write(body);
  req.end();
});

// ── Text in the person's language ──────────────────────────────────────────
// English uses the title/body already written by whoever created the notification.
// Hindi / Telugu use these templates when the needed details (meta) are present;
// otherwise the English text is sent rather than a half-filled sentence.
const T = {
  hi: {
    urgent_job:         { need: ['skill'], title: () => '🔴 पास में ज़रूरी काम!', body: m => `${m.skill} का काम अभी चाहिए${m.city ? ` — ${m.city}` : ''}${m.wage ? `, ₹${m.wage}/दिन` : ''}। तुरंत जवाब दें!` },
    job_applied_nearby: { need: ['skill'], title: () => '📍 आपके पास नया काम', body: m => `${m.skill} का काम${m.city ? ` — ${m.city}` : ''}${m.wage ? `, ₹${m.wage}/दिन` : ''}।` },
    job_applied:        { need: ['actorName', 'jobTitle'], title: () => 'नया आवेदक!', body: m => `${m.actorName} ने "${m.jobTitle}" के लिए आवेदन किया।` },
    applicant_accepted: { need: ['jobTitle'], title: () => 'आपको काम मिल गया! 🎉', body: m => `आप "${m.jobTitle}" के लिए चुने गए। अब आप कॉल और मैसेज कर सकते हैं।` },
    applicant_rejected: { need: ['jobTitle'], title: () => 'आवेदन अपडेट', body: m => `"${m.jobTitle}" के लिए इस बार आपको नहीं चुना गया।` },
    work_started:       { need: ['jobTitle'], title: () => 'काम शुरू हुआ', body: m => `"${m.jobTitle}" का काम शुरू हो गया है।` },
    work_completed:     { need: ['jobTitle'], title: () => 'काम पूरा हुआ ✅', body: m => `"${m.jobTitle}" पूरा हुआ। पैसे मिलने के बाद अपना पेमेंट कोड बताएं।` },
    payment_confirmed:  { need: ['jobTitle'], title: () => 'पेमेंट की पुष्टि ✅', body: m => `"${m.jobTitle}" का पेमेंट पक्का हुआ।` },
    posting_allowed:    { need: [], title: () => 'अब आप काम पोस्ट कर सकते हैं', body: () => 'सपोर्ट ने आपको नया काम पोस्ट करने की अनुमति दी है।' },
    new_message:        { need: ['actorName'], title: m => m.actorName, body: (m, fb) => fb },
  },
  te: {
    urgent_job:         { need: ['skill'], title: () => '🔴 దగ్గరలో అత్యవసర పని!', body: m => `${m.skill} పని ఇప్పుడే కావాలి${m.city ? ` — ${m.city}` : ''}${m.wage ? `, ₹${m.wage}/రోజు` : ''}. వెంటనే స్పందించండి!` },
    job_applied_nearby: { need: ['skill'], title: () => '📍 మీ దగ్గర కొత్త పని', body: m => `${m.skill} పని${m.city ? ` — ${m.city}` : ''}${m.wage ? `, ₹${m.wage}/రోజు` : ''}.` },
    job_applied:        { need: ['actorName', 'jobTitle'], title: () => 'కొత్త దరఖాస్తు!', body: m => `${m.actorName} "${m.jobTitle}" కు దరఖాస్తు చేశారు.` },
    applicant_accepted: { need: ['jobTitle'], title: () => 'మీకు పని దొరికింది! 🎉', body: m => `"${m.jobTitle}" కు మీరు ఎంపికయ్యారు. ఇప్పుడు కాల్, మెసేజ్ చేయవచ్చు.` },
    applicant_rejected: { need: ['jobTitle'], title: () => 'దరఖాస్తు అప్‌డేట్', body: m => `"${m.jobTitle}" కు ఈసారి మిమ్మల్ని ఎంపిక చేయలేదు.` },
    work_started:       { need: ['jobTitle'], title: () => 'పని మొదలైంది', body: m => `"${m.jobTitle}" పని మొదలైంది.` },
    work_completed:     { need: ['jobTitle'], title: () => 'పని పూర్తయింది ✅', body: m => `"${m.jobTitle}" పూర్తయింది. డబ్బు అందాక మీ పేమెంట్ కోడ్ చెప్పండి.` },
    payment_confirmed:  { need: ['jobTitle'], title: () => 'పేమెంట్ నిర్ధారణ ✅', body: m => `"${m.jobTitle}" పేమెంట్ నిర్ధారించబడింది.` },
    posting_allowed:    { need: [], title: () => 'ఇప్పుడు పని పోస్ట్ చేయవచ్చు', body: () => 'సపోర్ట్ మీకు కొత్త పని పోస్ట్ చేయడానికి అనుమతి ఇచ్చింది.' },
    new_message:        { need: ['actorName'], title: m => m.actorName, body: (m, fb) => fb },
  },
};

const localize = (lang, n) => {
  if (!lang || lang === 'en' || !T[lang]) return { title: n.title, body: n.body };
  const meta = n.meta || {};
  // job_applied is used for BOTH "new applicant" (to a poster) and "new job near you" (to a worker).
  const key = n.type === 'job_applied' && meta.skill && !meta.actorName ? 'job_applied_nearby' : n.type;
  const tpl = T[lang][key];
  if (!tpl || !tpl.need.every(k => meta[k] !== undefined && meta[k] !== null && meta[k] !== '')) {
    return { title: n.title, body: n.body };
  }
  return { title: tpl.title(meta), body: tpl.body(meta, n.body) };
};

const channelFor = (type) => (type === 'urgent_job' || type === 'job_applied' || type === 'applicant_accepted' ? 'jobs' : 'default');

// n = { type, title, body, link, meta }
const pushToUsers = async (userIds, n) => {
  try {
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
    if (!ids.length) return;
    const tokens = await PushToken.find({ user: { $in: ids } }).lean();
    if (!tokens.length) return;

    const messages = tokens.map(t => {
      const text = localize(t.lang, n);
      return {
        to: t.token,
        title: text.title,
        body: text.body,
        sound: 'default',
        priority: 'high',
        channelId: channelFor(n.type),
        ttl: n.type === 'urgent_job' ? 900 : 86400,
        data: { link: n.link || '/dashboard', type: n.type },
      };
    });

    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      const out = await post(chunk);
      const tickets = out && Array.isArray(out.data) ? out.data : [];
      const dead = [];
      tickets.forEach((tk, idx) => {
        if (tk && tk.status === 'error') {
          if (tk.details && tk.details.error === 'DeviceNotRegistered') dead.push(chunk[idx].to);
          else console.error('Push error:', tk.message || tk.details?.error);
        }
      });
      if (dead.length) await PushToken.deleteMany({ token: { $in: dead } });
    }
  } catch (err) {
    console.error('Push service error:', err.message);
  }
};

const pushToUser = (userId, n) => pushToUsers([userId], n);

module.exports = { pushToUser, pushToUsers, localize };