// POST /api/e: what a visitor who came through a personal link does on tapeit.dev
// (see lib/outreach.js). The page script sends an event only when the tape_t cookie is
// set; this function records it only when the HttpOnly tape_r cookie holds a code we
// issued. Everything else gets the same empty answer and is not stored.
import { knownCode, record, cookie, gpc, cleanEvent, SECURITY_HEADERS } from '../../lib/outreach.js';

const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?tapeit\.dev$/, /^https:\/\/([a-z0-9-]+\.)?tape-site(-[a-z0-9]+)?\.pages\.dev$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const MAX_BODY = 512;
const done = () => new Response(null, { status: 204, headers: SECURITY_HEADERS });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.some((re) => re.test(origin))) return done();
  if (gpc(request) || !env.WAITLIST_DB) return done();
  const code = cookie(request, 'tape_r');
  if (!(await knownCode(code))) return done();
  const text = await request.text();
  if (text.length > MAX_BODY) return done();
  let body;
  try { body = JSON.parse(text); } catch { return done(); }
  const event = cleanEvent(body);
  if (!event) return done();
  try {
    await record(env.WAITLIST_DB, { code, ...event, country: request.cf?.country });
  } catch (error) {
    console.log('outreach event not recorded', error?.message || 'error');
  }
  return done();
}
