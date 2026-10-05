// The server creates notification links as WEB paths (/jobs/<id>, /chat/<id>).
// The mobile app has no such routes — its screens are /job and /chat, which
// take the id as a parameter. This turns a server link into something
// router.push() can open. Links it doesn't recognise are passed through
// unchanged, so existing ones (/wallet, /my-work, /jobs/my, ...) keep working.

const OBJECT_ID = '([a-fA-F0-9]{24})';

export function resolveNotificationLink(link) {
  if (!link || typeof link !== 'string') return null;

  let m = link.match(new RegExp(`^/jobs/urgent/${OBJECT_ID}$`)) || link.match(new RegExp(`^/jobs/${OBJECT_ID}$`));
  if (m) return { pathname: '/job', params: { id: m[1] } };

  m = link.match(new RegExp(`^/chat/${OBJECT_ID}$`));
  if (m) return { pathname: '/chat', params: { id: m[1] } };

  return link;
}