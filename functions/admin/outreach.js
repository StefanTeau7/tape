// GET /admin/outreach: who opened their personal link, and what they did next.
// Off unless the Pages secret STATS_PASSWORD is set; then any user name with that password
// (HTTP Basic auth). ?format=csv downloads the same table for the outreach sheet.
import { ensureSchema, knownCode, SECURITY_HEADERS } from '../../lib/outreach.js';

const HTML_HEADERS = { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const csvCell = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function sameSecret(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function authorized(request, password) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const given = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : '';
  return given.length > 0 && sameSecret(given, password);
}

export const SUMMARY_SQL = `SELECT code,
  MIN(CASE WHEN kind = 'hit' THEN at END) AS first_click,
  SUM(kind = 'hit') AS link_hits,
  SUM(kind = 'hit' AND detail = 'scanner?') AS scanner_hits,
  SUM(kind = 'view') AS page_views,
  GROUP_CONCAT(DISTINCT CASE WHEN kind = 'view' THEN path END) AS pages,
  MAX(CASE WHEN kind = 'video' THEN CAST(detail AS INTEGER) END) AS video_pct,
  SUM(CASE WHEN kind = 'time' THEN CAST(detail AS INTEGER) ELSE 0 END) AS seconds,
  MAX(kind = 'signup') AS joined_waitlist,
  MAX(country) AS country,
  MAX(at) AS last_seen
FROM outreach_events GROUP BY code ORDER BY last_seen DESC`;

const COLUMNS = [
  ['code', 'Code'], ['first_click', 'First click (UTC)'], ['link_hits', 'Link opened'], ['scanner_hits', 'Of those, mail scanners?'],
  ['page_views', 'Pages seen in a browser'], ['pages', 'Which pages'], ['video_pct', 'Video watched (%)'], ['seconds', 'Seconds on the site'],
  ['joined_waitlist', 'Joined the waitlist'], ['country', 'Country'], ['last_seen', 'Last seen (UTC)'],
];

export async function onRequestGet({ request, env }) {
  if (!env.STATS_PASSWORD || !env.WAITLIST_DB) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  if (!(await authorized(request, env.STATS_PASSWORD))) {
    return new Response('Password required', { status: 401, headers: { ...SECURITY_HEADERS, 'www-authenticate': 'Basic realm="Tape outreach", charset="UTF-8"' } });
  }
  await ensureSchema(env.WAITLIST_DB);
  const { results: all = [] } = await env.WAITLIST_DB.prepare(SUMMARY_SQL).all();
  // only codes currently issued (a withdrawn or test code stays out of the table)
  const results = [];
  for (const row of all) if (await knownCode(row.code)) results.push(row);
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const lines = [COLUMNS.map(([, label]) => csvCell(label)).join(',')].concat(results.map((row) => COLUMNS.map(([key]) => csvCell(row[key])).join(',')));
    return new Response(lines.join('\n') + '\n', { headers: { ...SECURITY_HEADERS, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="tape-outreach-clicks.csv"' } });
  }
  const head = COLUMNS.map(([, label]) => `<th>${esc(label)}</th>`).join('');
  const body = results.map((row) => `<tr>${COLUMNS.map(([key]) => `<td>${esc(row[key])}</td>`).join('')}</tr>`).join('\n');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Outreach links · Tape</title></head>
<body><h1>Outreach links</h1>
<p>${results.length} personal links opened. "Link opened" counts every fetch of the link, including mail servers that check links before delivery; "Pages seen in a browser" only counts real page views. Match codes to teams with the Code column of the outreach sheet. <a href="?format=csv">Download as CSV</a></p>
<table border="1" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>
${body || `<tr><td colspan="${COLUMNS.length}">No personal links opened yet.</td></tr>`}
</tbody></table></body></html>`, { headers: HTML_HEADERS });
}
