-- Cloudflare D1 schema for tapeit.dev (database: tape-site, binding: WAITLIST_DB).
-- Apply once in the D1 console, or: npx wrangler d1 execute tape-site --remote --file schema.sql
-- Every statement uses IF NOT EXISTS, so running the whole file again is safe.

-- One row per address. No IP address, name or device data.
-- pick: the answer to "What would you tape first?" if one was given:
-- memory (agent memory), plan (a plan for parallel agents), spec (a team spec)
-- or notes (notes from a phone).
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  source TEXT,
  pick TEXT
);

-- Daily sign-up counters. The key is HMAC-SHA-256 of the connection (IPv4
-- address or IPv6 /64) under that day's random key in waitlist_salt. Rows from
-- before yesterday are deleted on every sign-up attempt.
CREATE TABLE IF NOT EXISTS waitlist_rate (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  count INTEGER NOT NULL
);

-- One random key per day for the counters above, deleted with them.
CREATE TABLE IF NOT EXISTS waitlist_salt (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

-- Personal links in outreach emails (lib/outreach.js): one row per event on a visit that
-- came through https://tapeit.dev/r/<code>. kind: hit (the link was fetched; detail is
-- desktop, mobile or scanner?), view (a page was shown in a browser; path), video (detail:
-- 0, 25, 50, 75 or 100 percent), time (detail: seconds the page was visible) or signup
-- (joined the waitlist; the address is never stored here). country: Cloudflare's
-- two-letter code. No IP address, user agent or referrer. Rows older than 90 days are
-- deleted whenever a new one is written. The functions also create this table if it is
-- missing.
CREATE TABLE IF NOT EXISTS outreach_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT,
  detail TEXT,
  country TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_events_code ON outreach_events (code, at);
CREATE INDEX IF NOT EXISTS outreach_events_at ON outreach_events (at);
