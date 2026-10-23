// Tests for the Pages function and the page that posts to it, run with
// `node --test tests/*.test.mjs` (Node 22.13 or later). D1 is SQLite, so a small shim over
// Node's built-in node:sqlite runs the real SQL from schema.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, '../schema.sql'), 'utf8');
const waitlist = await import('../functions/api/waitlist.js');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first(column) { const row = db.prepare(sql).get(...args); return column ? (row?.[column] ?? null) : (row ?? null); },
    async run() { db.prepare(sql).run(...args); return { success: true }; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql), batch: async (statements) => Promise.all(statements.map((one) => one.run())), raw: db };
}

const post = (body, { ip = '203.0.113.7', origin = 'https://tapeit.dev', accept = 'application/json', type = 'application/json' } = {}) => new Request('https://tapeit.dev/api/waitlist', {
  method: 'POST',
  headers: { 'content-type': type, accept, 'cf-connecting-ip': ip, ...(origin ? { origin } : {}) },
  body: type === 'application/json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
});
const rows = (env) => env.WAITLIST_DB.raw.prepare('SELECT * FROM waitlist ORDER BY email').all();
const count = (env) => env.WAITLIST_DB.raw.prepare('SELECT count(*) n FROM waitlist').get().n;

test('a valid address is stored once, lowercased, with consent version, source and pick', async () => {
  const env = { WAITLIST_DB: d1() };
  const first = await waitlist.onRequestPost({ request: post({ email: '  Stefan@Example.COM ', source: 'hero', pick: 'memory', hp_ref: '' }), env });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });
  const again = await waitlist.onRequestPost({ request: post({ email: 'stefan@example.com', source: 'closing', pick: 'spec' }), env });
  assert.equal(again.status, 200, 'a duplicate gets the same answer');
  const [row, ...rest] = rows(env);
  assert.equal(rest.length, 0);
  assert.equal(row.email, 'stefan@example.com');
  assert.equal(row.consent_version, waitlist.CONSENT_VERSION);
  assert.equal(row.source, 'hero');
  assert.equal(row.pick, 'memory', 'an answer already given is never replaced');
  assert.ok(!('ip' in row));
});

test('unknown sources and picks are stored as empty', async () => {
  const env = { WAITLIST_DB: d1() };
  await waitlist.onRequestPost({ request: post({ email: 'odd@example.com', source: 'footer', pick: 'everything' }), env });
  await waitlist.onRequestPost({ request: post({ email: 'none@example.com' }), env });
  for (const row of rows(env)) { assert.equal(row.source, null); assert.equal(row.pick, null); }
});

test('a pick sent after joining fills an empty answer, without a second row', async () => {
  const env = { WAITLIST_DB: d1() };
  await waitlist.onRequestPost({ request: post({ email: 'later@example.com', source: 'hero' }), env });
  await waitlist.onRequestPost({ request: post({ email: 'later@example.com', source: 'closing', pick: 'notes' }), env });
  await waitlist.onRequestPost({ request: post({ email: 'later@example.com', source: 'closing', pick: 'plan' }), env });
  const [row, ...rest] = rows(env);
  assert.equal(rest.length, 0);
  assert.equal(row.source, 'hero');
  assert.equal(row.pick, 'notes');
});

test('invalid addresses are refused with 400 and nothing is stored', async () => {
  const env = { WAITLIST_DB: d1() };
  for (const email of ['', 'nope', 'a@b', 'x@y.z', 'with space@example.com', 'a'.repeat(250) + '@example.com', 42, null, '=hyperlink("http://x")@ex.com', '+1@example.com', 'a‮@example.com', 'a\u0007b@example.com', 'a​b@example.com', '<a>@example.com']) {
    const response = await waitlist.onRequestPost({ request: post({ email }), env });
    assert.equal(response.status, 400, String(email));
  }
  assert.equal(count(env), 0);
});

test('a filled honeypot looks like success but stores nothing', async () => {
  const env = { WAITLIST_DB: d1() };
  const response = await waitlist.onRequestPost({ request: post({ email: 'bot@example.com', hp_ref: 'ACME' }), env });
  assert.equal(response.status, 200);
  assert.equal(count(env), 0);
});

test('more than the daily limit from one connection gets 429; another connection still works', async () => {
  const env = { WAITLIST_DB: d1() };
  for (let i = 0; i < waitlist.DAILY_LIMIT; i++) {
    assert.equal((await waitlist.onRequestPost({ request: post({ email: `p${i}@example.com` }), env })).status, 200);
  }
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'over@example.com' }), env })).status, 429);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'other@example.com' }, { ip: '198.51.100.9' }), env })).status, 200);
  const keys = env.WAITLIST_DB.raw.prepare('SELECT key FROM waitlist_rate').all().map((row) => row.key);
  assert.ok(keys.every((key) => /^[0-9a-f]{64}$/.test(key)), 'only keyed hashes are stored');
  assert.equal(env.WAITLIST_DB.raw.prepare('SELECT count(*) n FROM waitlist_salt').get().n, 1, 'one key for the day');
});

test('IPv6 sign-ups count per /64 network', async () => {
  assert.equal(waitlist.rateSubject('2001:db8:1:2:aaaa::1'), '2001:0db8:0001:0002::/64');
  assert.equal(waitlist.rateSubject('2001:db8:1:2::ffff'), waitlist.rateSubject('2001:db8:1:2:9:9:9:9'));
  assert.equal(waitlist.rateSubject('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(waitlist.rateSubject(''), 'unknown');
  const env = { WAITLIST_DB: d1() };
  for (let i = 0; i < waitlist.DAILY_LIMIT; i++) {
    await waitlist.onRequestPost({ request: post({ email: `v${i}@example.com` }, { ip: `2001:db8:1:2::${i + 1}` }), env });
  }
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'v-over@example.com' }, { ip: '2001:db8:1:2::abcd' }), env })).status, 429);
});

test('a database error answers 503', async () => {
  const broken = { prepare: () => { throw new Error('down'); }, batch: async () => { throw new Error('down'); } };
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'a@example.com' }), env: { WAITLIST_DB: broken } })).status, 503);
});

test('old rate counters are deleted', async () => {
  const env = { WAITLIST_DB: d1() };
  env.WAITLIST_DB.raw.prepare("INSERT INTO waitlist_rate (key, day, count) VALUES ('old', '2000-01-01', 30)").run();
  env.WAITLIST_DB.raw.prepare("INSERT INTO waitlist_salt (day, salt) VALUES ('2000-01-01', 'x')").run();
  await waitlist.onRequestPost({ request: post({ email: 'not-an-email' }), env });
  await waitlist.onRequestPost({ request: post({ email: 'fresh@example.com' }), env });
  assert.equal(env.WAITLIST_DB.raw.prepare("SELECT count(*) n FROM waitlist_rate WHERE key = 'old'").get().n, 0);
  assert.equal(env.WAITLIST_DB.raw.prepare("SELECT count(*) n FROM waitlist_salt WHERE day = '2000-01-01'").get().n, 0);
});

test('foreign origins are refused; tapeit.dev, www, previews and no origin are allowed', async () => {
  const env = { WAITLIST_DB: d1() };
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'a@example.com' }, { origin: 'https://evil.example' }), env })).status, 403);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'a@example.com' }, { origin: 'https://tapeit.dev.evil.example' }), env })).status, 403);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'b@example.com' }, { origin: null }), env })).status, 200);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'c@example.com' }, { origin: 'https://www.tapeit.dev' }), env })).status, 200);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'd@example.com' }, { origin: 'https://abc123.tape-site.pages.dev' }), env })).status, 200);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'e@example.com' }, { origin: 'https://tape-site.pages.dev' }), env })).status, 200);
});

test('a plain form post without JavaScript gets an HTML answer in the site’s look', async () => {
  const env = { WAITLIST_DB: d1() };
  const response = await waitlist.onRequestPost({ request: post({ email: 'form@example.com', source: 'closing', pick: 'plan' }, { accept: 'text/html', type: 'application/x-www-form-urlencoded' }), env });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /You’re taped in/);
  assert.match(html, /href="\/site(\.[0-9a-f]{12})?\.css"/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(rows(env)[0].pick, 'plan', 'the radio group posts with the closing form');
  const bad = await waitlist.onRequestPost({ request: post({ email: 'nope' }, { accept: 'text/html', type: 'application/x-www-form-urlencoded' }), env });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /doesn’t look like an email address/);
});

test('oversized bodies and missing database are refused', async () => {
  const big = new Request('https://tapeit.dev/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email: 'a@example.com', pad: 'x'.repeat(5000) }) });
  assert.equal((await waitlist.onRequestPost({ request: big, env: { WAITLIST_DB: d1() } })).status, 413);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'a@example.com' }), env: {} })).status, 503);
  assert.equal(waitlist.onRequest().status, 405);
});

// The welcome email ------------------------------------------------------------

// Stands in for Resend: records each request and answers with `status`, or
// throws like an unreachable network when `status` is 0.
async function withResend(status, run) {
  const calls = [];
  const original = { fetch: globalThis.fetch, error: console.error };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    if (!status) throw new TypeError('fetch failed');
    return new Response(status === 200 ? '{"id":"test"}' : '{"name":"validation_error"}', { status });
  };
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try { await run(calls, logged); } finally { globalThis.fetch = original.fetch; console.error = original.error; }
}
const keyed = () => ({ WAITLIST_DB: d1(), RESEND_API_KEY: 're_test' });

test('without RESEND_API_KEY a sign-up sends no email', () => withResend(200, async (calls) => {
  const env = { WAITLIST_DB: d1() };
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'quiet@example.com' }), env })).status, 200);
  assert.equal(calls.length, 0);
}));

test('a new address gets one “You’re taped in” email from hello@tapeit.dev, without request data, links to confirm or tracking', () => withResend(200, async (calls) => {
  const env = keyed();
  const response = await waitlist.onRequestPost({ request: post({ email: '  New@Example.COM ', pick: 'memory' }), env });
  assert.deepEqual(await response.json(), { ok: true }, 'the answer is the same as without email');
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.init.headers.authorization, 'Bearer re_test');
  assert.equal(call.body.from, 'Tape <hello@tapeit.dev>');
  assert.equal(call.body.reply_to, 'hello@tapeit.dev');
  assert.deepEqual(call.body.to, ['new@example.com']);
  assert.equal(call.body.subject, 'You’re taped in');
  for (const part of [call.body.html, call.body.text]) {
    assert.ok(part.includes('You’re on the Tape waitlist.'));
    assert.ok(part.includes('We’re letting people in in small waves, starting with teams that use AI agents every day.'));
    assert.ok(part.includes('what would you tape first?'));
    assert.ok(part.includes('Just hit reply. We read every answer.'));
    assert.ok(part.includes(waitlist.SIGN_OFF));
    assert.ok(part.includes('Tape · '));
    assert.ok(!part.includes('example.com'), 'the address itself is not repeated in the email');
    assert.ok(!/confirm|verify/i.test(part), 'no confirmation step');
  }
  assert.ok(!/<img|<script|<style|utm_|token=/i.test(call.body.html), 'no images, scripts, tracking or links beyond the site');
  assert.deepEqual([...call.body.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]), ['https://tapeit.dev']);
}));

test('an address already on the list gets no second email, and the same answer', () => withResend(200, async (calls) => {
  const env = keyed();
  await waitlist.onRequestPost({ request: post({ email: 'twice@example.com' }), env });
  const again = await waitlist.onRequestPost({ request: post({ email: 'Twice@example.com', source: 'closing', pick: 'plan' }), env });
  assert.deepEqual(await again.json(), { ok: true });
  assert.equal(calls.length, 1, 'adding a pick later sends nothing either');
}));

test('the email goes out after the answer when the platform offers waitUntil', () => withResend(200, async (calls) => {
  const env = keyed();
  const pending = [];
  const response = await waitlist.onRequestPost({ request: post({ email: 'later@example.com' }), env, waitUntil: (promise) => pending.push(promise) });
  assert.equal(response.status, 200);
  assert.equal(pending.length, 1);
  assert.equal(await pending[0], true);
  assert.equal(calls.length, 1);
}));

for (const [status, label] of [[500, 'refused'], [0, 'unreachable']]) {
  test(`${label === 'unreachable' ? 'an' : 'a'} ${label} email never fails the sign-up and logs no address`, () => withResend(status, async (calls, logged) => {
    const env = keyed();
    const response = await waitlist.onRequestPost({ request: post({ email: 'bounce@example.com' }), env });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(count(env), 1);
    assert.equal(logged.length, 1);
    assert.ok(!logged[0].includes('bounce'), logged[0]);
  }));
}

test('bots and rate-limited sign-ups get no email', () => withResend(200, async (calls) => {
  const env = keyed();
  await waitlist.onRequestPost({ request: post({ email: 'bot@example.com', hp_ref: 'ACME' }), env });
  assert.equal(calls.length, 0);
  for (let i = 0; i < waitlist.DAILY_LIMIT; i++) await waitlist.onRequestPost({ request: post({ email: `r${i}@example.com` }), env });
  assert.equal(calls.length, waitlist.DAILY_LIMIT);
  assert.equal((await waitlist.onRequestPost({ request: post({ email: 'over@example.com' }), env })).status, 429);
  assert.equal(calls.length, waitlist.DAILY_LIMIT);
}));

test('WAITLIST_FROM changes the sender', () => withResend(200, async (calls) => {
  const env = { ...keyed(), WAITLIST_FROM: 'Stefan from Tape <stefan@tapeit.dev>' };
  await waitlist.onRequestPost({ request: post({ email: 'from@example.com' }), env });
  assert.equal(calls[0].body.from, 'Stefan from Tape <stefan@tapeit.dev>');
  assert.equal(calls[0].body.reply_to, 'hello@tapeit.dev');
}));

// The page -----------------------------------------------------------------------

const publicDir = resolve(here, '../public');
const pages = readdirSync(publicDir).filter((name) => name.endsWith('.html'));

test('pages carry no inline styles or scripts, which the CSP would block', () => {
  for (const name of pages) {
    const html = readFileSync(resolve(publicDir, name), 'utf8');
    assert.ok(!/\sstyle=/i.test(html), `${name}: style attribute`);
    assert.ok(!/<style/i.test(html), `${name}: <style>`);
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) assert.match(tag, /\ssrc="[^"]+"/, `${name}: inline script`);
    assert.ok(!/\son[a-z]+=/i.test(html), `${name}: inline event handler`);
    assert.ok(!/https?:\/\/(?!tapeit\.dev)[^"'\s]*\.(css|js|woff2?)\b/i.test(html), `${name}: asset from another host`);
  }
});

test('both forms show the consent text recorded for CONSENT_VERSION', () => {
  const html = readFileSync(resolve(publicDir, 'index.html'), 'utf8');
  const versions = readFileSync(resolve(here, '../consent-versions.md'), 'utf8');
  const section = versions.split(/^## /m).find((part) => part.startsWith(waitlist.CONSENT_VERSION));
  assert.ok(section, `consent-versions.md has a section for ${waitlist.CONSENT_VERSION}`);
  const quoted = [...section.matchAll(/^> (.+)$/gm)].map((match) => match[1].trim());
  assert.ok(quoted.length > 0);
  const text = (fragment) => fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const shown = [...html.matchAll(/<div class="fine"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => text(match[1]));
  assert.equal(shown.length, 2, 'one note under each form');
  for (const note of shown) assert.equal(note, quoted.join(' '));
});

test('every form posts to the function, with a honeypot and a known source', () => {
  const html = readFileSync(resolve(publicDir, 'index.html'), 'utf8');
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)];
  assert.equal(forms.length, 2);
  for (const [whole, inner] of forms) {
    assert.match(whole, /action="\/api\/waitlist" method="post"/);
    assert.match(inner, /name="hp_ref"/);
    assert.match(inner, /name="source" value="(hero|closing)"/);
  }
  const picks = [...html.matchAll(/name="pick" value="([a-z]+)" form="join-closing"/g)].map((match) => match[1]);
  assert.deepEqual(picks.sort(), [...waitlist.PICKS].sort());
});
