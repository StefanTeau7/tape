// GET /r/<code>: a personal link from one of our outreach emails (see lib/outreach.js).
//
// A code we issued is recorded as a "hit" (with the device type, or "scanner?" when the
// request looks like a mail server checking links), and the visit gets two cookies for
// 30 days: tape_r (HttpOnly, the code, read by /api/e) and tape_t=1 (lets the page script
// know this visit came through a personal link). Then it redirects to the page below.
// Unknown codes, and browsers sending Global Privacy Control, are redirected without any
// record or cookie.
import { knownCode, record, device, gpc, SECURITY_HEADERS } from '../../lib/outreach.js';

// Where personal links land. '/' until the intro video has its own page.
export const DESTINATION = '/';
const MAX_AGE = 30 * 86400;

export async function onRequestGet({ request, env, params }) {
  const code = String(params.code || '').toLowerCase();
  const headers = new Headers({ ...SECURITY_HEADERS, location: DESTINATION });
  if (!gpc(request) && env.WAITLIST_DB && await knownCode(code)) {
    try {
      await record(env.WAITLIST_DB, { code, kind: 'hit', path: '/r', detail: device(request.headers.get('user-agent') || ''), country: request.cf?.country });
      headers.append('set-cookie', `tape_r=${code}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Lax`);
      headers.append('set-cookie', `tape_t=1; Path=/; Max-Age=${MAX_AGE}; Secure; SameSite=Lax`);
    } catch (error) {
      console.log('outreach hit not recorded', error?.message || 'error');
    }
  }
  return new Response(null, { status: 302, headers });
}
