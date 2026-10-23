// POST /api/waitlist: add an email address to the Tape waitlist (Cloudflare D1).
//
// Stored: the address, when it was added, which form it came from, the answer
// to "What would you tape first?" if one was given, and the version of the
// consent text shown next to the form (see consent-versions.md).
// Not stored: IP addresses. To limit abuse, sign-ups are counted per connection
// per day under a keyed hash: HMAC-SHA-256 of the connection (an IPv4 address,
// or an IPv6 /64 network) with a random key made for that day. Keys and
// counters older than yesterday are deleted on every sign-up attempt, so
// neither lasts more than two days. A duplicate address gets the same answer as
// a new one, so the form never reveals who is on the list.
//
// Once RESEND_API_KEY is set, a new address gets one email through Resend
// saying it's on the waitlist. There is no confirmation link, by choice. An
// address already on the list gets no second email, so the form can't be used
// to fill someone's inbox. A lost email never fails the sign-up.

export const CONSENT_VERSION = 'waitlist-2026-10-23';
export const DAILY_LIMIT = 25;
// Who signs the welcome email. The co-founder's name goes here.
export const SIGN_OFF = 'Stefan from Tape';
export const PICKS = new Set(['memory', 'plan', 'spec', 'notes']);
const SITE = 'https://tapeit.dev';
const REPLY_TO = 'hello@tapeit.dev';
const MAX_BODY = 4096;
const SOURCES = new Set(['hero', 'closing']);
const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?tapeit\.dev$/, /^https:\/\/([a-z0-9-]+\.)?tape-site(-[a-z0-9]+)?\.pages\.dev$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

// Letters, digits and the punctuation RFC 5322 allows in an unquoted address,
// plus non-ASCII letters for internationalised addresses. No spaces, quotes,
// angle brackets, control or direction characters.
const LOCAL = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u;
const DOMAIN = /^([\p{L}\p{N}]([\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/u;
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁩﻿]/u;

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cache-control': 'no-store',
};

const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra },
});

// The answer for browsers posting the form without JavaScript, in the site's
// own look. Title and message are always fixed strings from this file, never
// request data.
const page = (status, title, message) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#EEEBE4"><title>${title} · Tape</title><link rel="icon" type="image/svg+xml" href="/assets/rolf.svg"><link rel="stylesheet" href="/site.d585c4bcdbec.css"></head>
<body><div class="page">
<header class="top"><a class="logo" href="/" aria-label="Tape home"><span class="lift logo-tilt" aria-hidden="true"><span class="mt logo-strip">Tape</span></span></a></header>
<main class="doc doc-answer"><h1>${title}</h1><p>${message}</p><p><a href="/">Back to Tape</a></p></main>
<footer class="foot foot-plain"><span>© 2026 Tape</span><span class="foot-links"><a href="/privacy">Privacy</a></span></footer>
</div></body></html>`, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
});

const JOINED = ['You’re taped in', 'We’ll email you when it’s your turn.'];
const wantsJson = (request) => (request.headers.get('accept') || '').includes('application/json');

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || INVISIBLE.test(email)) return null;
  // A leading = + - @ would turn into a formula if the list is opened as a spreadsheet.
  if (/^[=+\-@]/.test(email)) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at), domain = email.slice(at + 1);
  return local.length <= 64 && LOCAL.test(local) && DOMAIN.test(domain) ? email : null;
}

// The connection a sign-up is counted against: an IPv4 address, or the /64
// network of an IPv6 address (one household or phone usually holds a whole /64).
export function rateSubject(ip) {
  if (typeof ip !== 'string' || !ip) return 'unknown';
  const value = ip.trim().toLowerCase();
  if (!value.includes(':')) return value;
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/.exec(value);
  if (mapped) return mapped[1];
  const [head, tail] = value.split('::');
  const before = head ? head.split(':') : [];
  const after = tail === undefined ? null : (tail ? tail.split(':') : []);
  const groups = after === null ? before : [...before, ...Array(Math.max(0, 8 - before.length - after.length)).fill('0'), ...after];
  return `${groups.slice(0, 4).map((group) => group.padStart(4, '0')).join(':')}::/64`;
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return { tooLarge: true };
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return { tooLarge: true }; }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { return {}; }
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  return {};
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

// Today's random key, made by whichever request needs it first.
async function dayKey(db, day) {
  const fresh = hex(crypto.getRandomValues(new Uint8Array(32)));
  return db.prepare('INSERT INTO waitlist_salt (day, salt) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET salt = waitlist_salt.salt RETURNING salt')
    .bind(day, fresh).first('salt');
}

async function counterKey(salt, subject) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(subject)));
}

// Deletes keys and counters from before yesterday.
export async function forgetOldCounters(db, now = new Date()) {
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  await db.batch([
    db.prepare('DELETE FROM waitlist_rate WHERE day < ?').bind(yesterday),
    db.prepare('DELETE FROM waitlist_salt WHERE day < ?').bind(yesterday),
  ]);
}

// The email a new address gets, in the site's paper, ink and masking tape:
// plain tables with inline styles, which is what email clients render
// reliably. Fixed text only: no request data, images or tracking.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const P = `margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.55;color:#3D3A33;`;
export const WELCOME = {
  subject: 'You’re taped in',
  html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>You’re taped in</title></head>
<body style="margin:0;padding:0;background:#EEEBE4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">You’re on the Tape waitlist. One question while you wait.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEEBE4;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFDF8;border:2px solid #1A1814;border-radius:10px;">
<tr><td style="padding:34px 32px 26px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px;transform:rotate(-2deg);"><tr><td style="background:#E5D6A4;padding:5px 16px 8px 14px;font-family:${FONT};font-size:24px;font-weight:800;letter-spacing:-0.05em;line-height:1;color:#1A1814;">Tape</td></tr></table>
<h1 style="margin:0 0 18px;font-family:${FONT};font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-0.035em;color:#1A1814;">You’re taped in</h1>
<p style="${P}">Hi! You’re on the Tape waitlist.</p>
<p style="${P}">We’re letting people in in small waves, starting with teams that use AI agents every day.</p>
<p style="${P}">One question while you wait: <strong style="color:#1A1814;">what would you tape first?</strong> Just hit reply. We read every answer.</p>
<p style="margin:22px 0 0;font-family:${FONT};font-size:16px;line-height:1.55;color:#1A1814;">${SIGN_OFF}</p>
<p style="margin:28px 0 0;font-family:${FONT};font-size:13px;line-height:1.55;color:#6B665C;">Didn’t sign up? Reply to this email and we’ll take your address off the list.</p>
</td></tr>
<tr><td style="padding:18px 32px 24px;border-top:1.5px dashed #BDB6A6;font-family:${FONT};font-size:12px;line-height:1.6;color:#6B665C;">Tape · <a href="${SITE}" style="color:#6B665C;">tapeit.dev</a></td></tr>
</table></td></tr></table>
</body></html>`,
  text: `You’re taped in

Hi! You’re on the Tape waitlist.

We’re letting people in in small waves, starting with teams that use AI agents every day.

One question while you wait: what would you tape first? Just hit reply. We read every answer.

${SIGN_OFF}

Didn’t sign up? Reply to this email and we’ll take your address off the list.

Tape · tapeit.dev
${SITE}
`,
};

// Sends the email through Resend's API. Never throws: the sign-up is already
// stored. Logs only the status, never the address.
export async function sendWelcome(env, email) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.WAITLIST_FROM || 'Tape <hello@tapeit.dev>', to: [email], reply_to: REPLY_TO, ...WELCOME }),
      signal: controller.signal,
    });
    if (!response.ok) console.error('waitlist email refused', response.status, (await response.json().catch(() => ({}))).name || '');
    return response.ok;
  } catch (error) {
    console.error('waitlist email failed', error?.name || 'error');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const asJson = wantsJson(request);
  const fail = (status, code, message) => asJson ? json(status, { ok: false, error: code }) : page(status, 'That didn’t work', message);
  const joined = () => asJson ? json(200, { ok: true }) : page(200, ...JOINED);

  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.some((pattern) => pattern.test(origin))) return fail(403, 'origin', 'Sign up from tapeit.dev.');
  const db = env.WAITLIST_DB;
  if (!db) return fail(503, 'unavailable', 'The waitlist isn’t available right now. Try again later.');

  const body = await readBody(request);
  if (body.tooLarge) return fail(413, 'too_large', 'That request was too large.');

  // A filled hidden field means a bot: answer as if it worked, store nothing.
  if (typeof body.hp_ref === 'string' && body.hp_ref.trim() !== '') return joined();

  const email = normalizeEmail(body.email);
  if (!email) return fail(400, 'invalid_email', 'That doesn’t look like an email address. Go back and check it.');

  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    await forgetOldCounters(db, now);
    const salt = await dayKey(db, day);
    const key = await counterKey(salt, rateSubject(request.headers.get('cf-connecting-ip')));
    const counted = await db.prepare('INSERT INTO waitlist_rate (key, day, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count')
      .bind(key, day).first('count');
    if (Number(counted) > DAILY_LIMIT) return fail(429, 'rate_limited', 'Too many sign-ups from this connection today. Try again tomorrow.');

    const source = SOURCES.has(body.source) ? body.source : null;
    const pick = PICKS.has(body.pick) ? body.pick : null;
    const added = await db.prepare('INSERT INTO waitlist (email, created_at, consent_version, source, pick) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING RETURNING email')
      .bind(email, now.toISOString(), CONSENT_VERSION, source, pick).first('email');
    // Someone who joined before answering "What would you tape first?" can add
    // the answer later. An answer already given is never replaced.
    if (!added && pick) await db.prepare('UPDATE waitlist SET pick = ? WHERE email = ? AND pick IS NULL').bind(pick, email).run();
    // Only a new address gets the email, sent after the answer where the platform allows it.
    if (added && env.RESEND_API_KEY) {
      const sending = sendWelcome(env, email);
      if (typeof context.waitUntil === 'function') context.waitUntil(sending);
      else await sending;
    }
  } catch {
    return fail(503, 'unavailable', 'The waitlist isn’t available right now. Try again later.');
  }
  return joined();
}

export function onRequest() {
  return json(405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST' });
}
