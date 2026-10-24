// Personal links in outreach emails: shared code for /r/<code>, /api/e and /admin/outreach.
//
// Each outreach email carries one personal link, https://tapeit.dev/r/<code>, where the
// code is the company's name plus four random characters (the outreach sheet maps codes to
// teams; nothing here knows who a code belongs to). Only codes we issued are recorded: the
// function keeps the first 16 hex characters of SHA-256 of each code (lib/outreach-codes.js).
//
// Recorded per event: the code, the kind of event, the page path, a short detail (device
// type for a link hit, a video milestone, seconds on the page), the visitor's country as
// Cloudflare reports it, and the time. Never recorded: IP addresses, the full user agent,
// referrers, or anything typed into a form. Visitors who did not arrive through a personal
// link are not recorded at all, and neither is anyone whose browser sends Global Privacy
// Control. Events older than 90 days are deleted whenever a new one is written.
import { CODE_HASHES } from './outreach-codes.js';

export const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z2-9]{4}$/;
export const RETENTION_DAYS = 90;
export const PER_CODE_DAILY = 500;
export const ALL_DAILY = 20000;
export const KINDS = new Set(['view', 'video', 'time', 'signup']);
const VIDEO_MARKS = new Set(['0', '25', '50', '75', '100']);
const PATH = /^\/[a-z0-9\-/]{0,60}$/;
const SCANNER = /(bot|crawl|spider|slurp|preview|scan|proofpoint|mimecast|barracuda|safelinks|microsoft office|outlook|google-safety|curl|wget|python|go-http|java\/|okhttp|headless|phantom)/i;

let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS outreach_events (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, detail TEXT, country TEXT, at TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS outreach_events_code ON outreach_events (code, at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS outreach_events_at ON outreach_events (at)').run();
  schemaReady = true;
}

export async function codeHash(code) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function knownCode(code, hashes = CODE_HASHES) {
  return typeof code === 'string' && code.length <= 48 && CODE.test(code) && hashes.has(await codeHash(code));
}

export const device = (ua = '') => (SCANNER.test(ua) ? 'scanner?' : /Mobi|Android|iPhone|iPad/.test(ua) ? 'mobile' : 'desktop');

export function cookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export const gpc = (request) => request.headers.get('sec-gpc') === '1';

// One event, within the daily caps; old events are deleted on the way.
export async function record(db, { code, kind, path = null, detail = null, country = null }, now = new Date()) {
  await ensureSchema(db);
  const day = now.toISOString().slice(0, 10);
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 864e5).toISOString();
  await db.prepare('DELETE FROM outreach_events WHERE at < ?').bind(cutoff).run();
  const mine = await db.prepare('SELECT count(*) AS n FROM outreach_events WHERE code = ? AND at >= ?').bind(code, day).first('n');
  if (mine >= PER_CODE_DAILY) return false;
  const all = await db.prepare('SELECT count(*) AS n FROM outreach_events WHERE at >= ?').bind(day).first('n');
  if (all >= ALL_DAILY) return false;
  await db.prepare('INSERT INTO outreach_events (code, kind, path, detail, country, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(code, kind, path, detail, country ? String(country).slice(0, 2) : null, now.toISOString()).run();
  return true;
}

// The event a page sends, cleaned: anything unexpected becomes null or is refused.
export function cleanEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const kind = String(body.k || '');
  if (!KINDS.has(kind)) return null;
  const path = typeof body.p === 'string' && PATH.test(body.p) ? body.p : null;
  let detail = null;
  if (kind === 'video') { detail = String(body.d ?? ''); if (!VIDEO_MARKS.has(detail)) return null; }
  if (kind === 'time') { const s = Math.round(Number(body.d)); if (!Number.isFinite(s) || s < 0) return null; detail = String(Math.min(s, 3600)); }
  return { kind, path, detail };
}

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
};
