// Tests for the personal links in outreach emails: /r/<code>, /api/e and /admin/outreach.
// Same D1 shim as functions.test.mjs: Node's built-in SQLite running schema.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, '../schema.sql'), 'utf8');
const lib = await import('../lib/outreach.js');
const codes = await import('../lib/outreach-codes.js');
const hit = await import('../functions/r/[code].js');
const events = await import('../functions/api/e.js');
const admin = await import('../functions/admin/outreach.js');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first(column) { const row = db.prepare(sql).get(...args); return column ? (row?.[column] ?? null) : (row ?? null); },
    async run() { db.prepare(sql).run(...args); return { success: true }; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql), raw: db };
}

const CODE = 'acme-k7p2';
codes.CODE_HASHES.add(await lib.codeHash(CODE));   // issue one code for the tests
const rows = (env) => env.WAITLIST_DB.raw.prepare('SELECT * FROM outreach_events ORDER BY id').all();
const get = (path, headers = {}) => new Request(`https://tapeit.dev${path}`, { headers });
const beacon = (body, cookie = `tape_r=${CODE}; tape_t=1`, headers = {}) => new Request('https://tapeit.dev/api/e', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://tapeit.dev', cookie, ...headers }, body: JSON.stringify(body),
});

test('an issued code is recorded as a hit, gets the two cookies and lands on the destination', async () => {
  const env = { WAITLIST_DB: d1() };
  const res = await hit.onRequestGet({ request: get(`/r/${CODE}`, { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605' }), env, params: { code: CODE } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), hit.DESTINATION);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith(`tape_r=${CODE};`) && /HttpOnly/.test(c) && /Secure/.test(c)));
  assert.ok(cookies.some((c) => c.startsWith('tape_t=1;') && !/HttpOnly/.test(c)));
  const [row, ...rest] = rows(env);
  assert.equal(rest.length, 0);
  assert.deepEqual([row.code, row.kind, row.detail], [CODE, 'hit', 'desktop']);
  assert.ok(!('ip' in row) && !('user_agent' in row));
});

test('unknown or malformed codes and Global Privacy Control are redirected without a record or cookie', async () => {
  const env = { WAITLIST_DB: d1() };
  for (const [code, headers] of [['acme-zzzz', {}], ['../etc', {}], ['ACME-K7P2x', {}], [CODE, { 'sec-gpc': '1' }]]) {
    const res = await hit.onRequestGet({ request: get(`/r/${code}`, headers), env, params: { code } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.getSetCookie().length, 0, code);
  }
  assert.equal(rows(env).length, 0);
});

test('mail scanners are marked, not hidden', async () => {
  const env = { WAITLIST_DB: d1() };
  await hit.onRequestGet({ request: get(`/r/${CODE}`, { 'user-agent': 'Mozilla/5.0 (compatible; Proofpoint URL Defense)' }), env, params: { code: CODE } });
  assert.equal(rows(env)[0].detail, 'scanner?');
});

test('page events are stored only with an issued code in the cookie, and cleaned', async () => {
  const env = { WAITLIST_DB: d1() };
  for (const body of [{ k: 'view', p: '/' }, { k: 'video', p: '/intro', d: 50 }, { k: 'time', p: '/', d: 99999 }, { k: 'signup', p: '/' }]) {
    const res = await events.onRequestPost({ request: beacon(body), env });
    assert.equal(res.status, 204);
  }
  for (const [body, cookie] of [[{ k: 'view', p: '/' }, ''], [{ k: 'view', p: '/' }, 'tape_r=acme-zzzz'], [{ k: 'email', p: '/', d: 'x@y.z' }, undefined], [{ k: 'video', p: '/', d: 33 }, undefined]]) {
    await events.onRequestPost({ request: beacon(body, cookie ?? `tape_r=${CODE}`), env });
  }
  const stored = rows(env).map((r) => [r.kind, r.path, r.detail]);
  assert.deepEqual(stored, [['view', '/', null], ['video', '/intro', '50'], ['time', '/', '3600'], ['signup', '/', null]]);
});

test('events from other origins or with Global Privacy Control are dropped', async () => {
  const env = { WAITLIST_DB: d1() };
  await events.onRequestPost({ request: beacon({ k: 'view', p: '/' }, undefined, { origin: 'https://evil.example' }), env });
  await events.onRequestPost({ request: beacon({ k: 'view', p: '/' }, undefined, { 'sec-gpc': '1' }), env });
  assert.equal(rows(env).length, 0);
});

test('events older than 90 days are deleted when a new one is written; a code has a daily cap', async () => {
  const env = { WAITLIST_DB: d1() };
  const db = env.WAITLIST_DB;
  await lib.record(db, { code: CODE, kind: 'view', path: '/' }, new Date('2026-01-01T10:00:00Z'));
  await lib.record(db, { code: CODE, kind: 'view', path: '/' }, new Date('2026-06-01T10:00:00Z'));
  assert.equal(rows(env).length, 1, 'the January event is gone by June');
  db.raw.prepare('DELETE FROM outreach_events').run();
  const day = new Date('2026-06-02T10:00:00Z');
  for (let i = 0; i < lib.PER_CODE_DAILY + 5; i++) await lib.record(db, { code: CODE, kind: 'view', path: '/' }, day);
  assert.equal(rows(env).length, lib.PER_CODE_DAILY);
});

test('the stats page is off without STATS_PASSWORD, asks for it, and shows one row per code', async () => {
  const env = { WAITLIST_DB: d1() };
  assert.equal((await admin.onRequestGet({ request: get('/admin/outreach'), env })).status, 404);
  env.STATS_PASSWORD = 'correct horse';
  assert.equal((await admin.onRequestGet({ request: get('/admin/outreach'), env })).status, 401);
  const wrong = { authorization: 'Basic ' + btoa('stefan:wrong') };
  assert.equal((await admin.onRequestGet({ request: get('/admin/outreach', wrong), env })).status, 401);
  await hit.onRequestGet({ request: get(`/r/${CODE}`), env, params: { code: CODE } });
  await events.onRequestPost({ request: beacon({ k: 'view', p: '/' }), env });
  await events.onRequestPost({ request: beacon({ k: 'video', p: '/intro', d: 75 }), env });
  const ok = { authorization: 'Basic ' + btoa('stefan:correct horse') };
  const page = await admin.onRequestGet({ request: get('/admin/outreach', ok), env });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(CODE) && html.includes('<td>75</td>'));
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const csv = await (await admin.onRequestGet({ request: get('/admin/outreach?format=csv', ok), env })).text();
  assert.ok(csv.split('\n')[1].startsWith(CODE + ','));
});

test('pages load the tracking script, and robots.txt keeps personal links out of search', () => {
  const pub = resolve(here, '../public');
  for (const page of ['index.html', 'privacy.html']) assert.match(readFileSync(resolve(pub, page), 'utf8'), /<script src="track(\.[0-9a-f]{12})?\.js" defer><\/script>/, page);
  const robots = readFileSync(resolve(pub, 'robots.txt'), 'utf8');
  assert.match(robots, /Disallow: \/r\//);
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(readFileSync(resolve(pub, 'privacy.html'), 'utf8'), /Personal links in our emails/);
});
