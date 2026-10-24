# tapeit.dev

The Tape waitlist site: one static page plus one Cloudflare Pages Function.

```
public/              static site (the Pages build output directory)
  index.html         the page: the taped wall, How it feels, RIP copies, the pick, sign-up
  site.*.css         all styles (no inline styles: the CSP forbids them)
  tape.*.js          all behaviour: the typing wall, Rolf, the pick, the forms
  privacy.html       the privacy page
  404.html           the answer for addresses that don’t exist (without it, Pages would serve the home page)
  fonts/             self-hosted fonts and their licences
  assets/            favicon (Rolf), home-screen icon, link preview image (og.png)
  _headers, robots.txt, sitemap.xml
functions/api/
  waitlist.js        POST /api/waitlist → D1, and the welcome email
  e.js               POST /api/e: what a visitor who came through a personal link does next
functions/r/[code].js  GET /r/<code>: a personal link from an outreach email → record, cookies, redirect
functions/admin/outreach.js  GET /admin/outreach: who opened their link (password: STATS_PASSWORD)
lib/
  outreach.js        shared code for the three above: codes, recording, retention, caps
  outreach-codes.js  hashes of the codes we issued (generated from the outreach sheet)
public/track.*.js    sends a page view, video milestones, time on page and a sign-up, only on a personal-link visit
scripts/
  hash-assets.mjs    names the stylesheet and script after their content; run before every release
schema.sql           D1 tables
consent-versions.md  the exact text shown next to the forms for each CONSENT_VERSION
tests/               node --test tests/*.test.mjs
```

The page works without JavaScript: the wall shows its last frame, "What would you tape first?" is a plain radio group sent with the closing form, and both forms post to `/api/waitlist`, which answers with a page in the site's look. With JavaScript, the forms answer in place and the pick goes with whichever form is used.

## Releasing a change

Edit the files under their current names, then run `node scripts/hash-assets.mjs` before committing. It renames the stylesheet and script after their content and updates every HTML page, `_headers` and the stylesheet link in the function's own page to match.

Cloudflare tells browsers to keep stylesheets and scripts for hours (its zone-wide browser-cache setting overrides the shorter times in `_headers`). With fixed names, a visitor could get the new page with yesterday's styles. With content names, a page always loads the exact files it was built with, and those files are cached for a year. Font files carry a content hash in their names for the same reason, so a changed font needs a new name.

Run the tests before pushing:

```sh
node --test tests/*.test.mjs
```

They cover the function (storage, the pick, duplicates, honeypot, rate limit, origins, the email) and the page (no inline styles or scripts, the consent text matches `consent-versions.md`, both forms post to the function).

## Setup

Not done yet. In order:

1. **GitHub.** Create an empty private repository (for example `tape-site`) and push this one to it:

   ```sh
   git remote add origin git@github.com:<owner>/tape-site.git
   git push -u origin main
   ```

2. **Cloudflare Pages.** Workers & Pages → Create → Pages → Connect to Git → the repository.
   - Project name: `tape-site`. Cloudflare gave it the address `tape-site-crq.pages.dev`; the function accepts that, `tape-site.pages.dev` and their preview addresses as origins (`ALLOWED_ORIGINS` in `functions/api/waitlist.js`).
   - Production branch: `main`
   - Build command: none
   - Build output directory: `public`
   - Root directory: leave empty (the repository root)
3. **D1.** Storage & Databases → D1 → Create two databases, each loaded with `schema.sql` in its console:
   - `tape-site`: the real waitlist, bound as `WAITLIST_DB` for Production (Pages project → Settings → Bindings).
   - `tape-site-preview`: bound as `WAITLIST_DB` for Preview, so sign-ups on preview addresses never reach the real list.
4. **Domain.** With tapeit.dev on Cloudflare (buying it through Cloudflare Registrar does this), Pages project → Custom domains → add `tapeit.dev` and `www.tapeit.dev`.
5. **Sending email (Resend).** In Resend: Domains → Add domain → `tapeit.dev`, region North Virginia (us-east-1), return path `send`. Add the DNS records it lists in Cloudflare → tapeit.dev → DNS, all DNS only, then verify. For tapeit.dev (done Oct 23, 2026, sending through Resend Forge) these are a DKIM TXT record at `resend._domainkey` and two CNAMEs, `send` → `send.forge.rmta.net` and `rsend` → `rsend.forge.rmta.net`. Older Resend setups list an SPF TXT and a bounce MX on `send` instead. Leave open and click tracking off: the privacy page says the emails carry none. Then API Keys → Create → Sending access, limited to `tapeit.dev`.
   In the Pages project: Settings → Variables and secrets → Production → add the secret `RESEND_API_KEY` with that key. Optional: `WAITLIST_FROM`, the sender, by default `Tape <hello@tapeit.dev>`. Preview gets no key, so sign-ups on preview addresses never send email. Redeploy once after adding the secret; secrets apply to new deployments.
   For deliverability, tapeit.dev also has a DMARC record, TXT `_dmarc` → `v=DMARC1; p=none;`.
6. **Receiving email.** Cloudflare → tapeit.dev → Email → Email Routing → enable (it adds its own MX and TXT records on the apex; Resend's records sit on `send`, `rsend` and `resend._domainkey`, so they don't clash). Add the custom address `hello@tapeit.dev` → forward to Stefan's inbox, and confirm the destination from the email Cloudflare sends. The welcome email asks a question and says "Just hit reply", and its `reply_to` is `hello@tapeit.dev`, so this has to work before the first sign-up.
7. **Placeholders.** Fill in the company name and contact in `public/privacy.html` (highlighted on the page). The email's sign-off is `SIGN_OFF` in `functions/api/waitlist.js`.

Every push to `main` then deploys to production. Other branches get preview addresses such as `https://feat-copy.tape-site-crq.pages.dev`.

After `schema.sql` changes, run the new statements in both databases' consoles. Every statement uses `IF NOT EXISTS`, so running the whole file again is safe.

## The waitlist

- **Stored:** the address, its timestamp, the form used (`hero` or `closing`), the answer to "What would you tape first?" if given (`memory`, `plan`, `spec` or `notes`), and the consent-text version. The text for each version is in `consent-versions.md`; change `CONSENT_VERSION` in `functions/api/waitlist.js` and add the new text there whenever the text next to the forms changes. A test fails if the page and the record disagree.
- **Not stored:** IP addresses. Sign-ups are counted per connection per day (25 a day per IPv4 address or IPv6 /64) under HMAC-SHA-256 with a random key made each day. Keys and counters older than yesterday are deleted on every sign-up attempt.
- **Duplicates** get the same answer as a new address, so the form never reveals who is on the list. Someone who joined before picking can still add a pick (the page sends it); an answer already given is never replaced.
- **Email:** with `RESEND_API_KEY` set, a new address gets one email, "You're taped in" (`WELCOME` in `functions/api/waitlist.js`), sent after the answer. There is no confirmation link, by choice. An address already on the list gets no second email, so the form can't be used to fill someone's inbox. A lost email never fails the sign-up; failures are logged with their status only, never the address (the deployment's real-time Functions logs).
- **Export** in the D1 console:

```sql
SELECT email, created_at, source, pick FROM waitlist ORDER BY created_at;
```

- **What people want first:**

```sql
SELECT pick, count(*) AS people FROM waitlist GROUP BY pick ORDER BY people DESC;
```

- **Delete on request:**

```sql
DELETE FROM waitlist WHERE email = 'name@example.com';
```

## Fonts

`public/fonts/` holds Inter Tight, Instrument Sans (both variable) and IBM Plex Mono 400/500/600 from Fontsource 5.3.0, Latin and Latin Extended subsets, under the SIL Open Font License 1.1, and Permanent Marker (Latin) under the Apache License 2.0. The licence texts sit next to the files. The page requests nothing from other hosts.

## Local preview

With wrangler (`npm i -g wrangler`, or prefix the commands with `npx`) and a local copy of the database. `wrangler d1 execute` needs the database named in a config file, so keep a small one outside the repository: a `wrangler.toml` in the repository root would become the Pages project's configuration and override the bindings set in the dashboard.

```sh
# once: a config outside the repo that names a local database
mkdir -p ../tape-local && cat > ../tape-local/wrangler.toml <<'EOF'
name = "tape-site-local"
compatibility_date = "2026-10-01"
[[d1_databases]]
binding = "WAITLIST_DB"
database_name = "tape-site"
database_id = "11111111-1111-1111-1111-111111111111"
EOF
npx wrangler d1 execute tape-site --local --config ../tape-local/wrangler.toml --persist-to ../tape-local/state --file schema.sql

# then, from the repository root
npx wrangler pages dev public --d1 WAITLIST_DB=11111111-1111-1111-1111-111111111111 --persist-to ../tape-local/state
```

The page is then at http://localhost:8788, with the function and the CSP from `_headers`. Sign-ups land in the local database:

```sh
npx wrangler d1 execute tape-site --local --config ../tape-local/wrangler.toml --persist-to ../tape-local/state --command "SELECT * FROM waitlist"
```


## Personal links (outreach emails)

Each outreach email carries one personal link, `https://tapeit.dev/r/<code>`. The code is the company's name plus four random characters; the outreach sheet maps codes to teams, and the site only knows the code. `lib/outreach-codes.js` lists the first 16 hex characters of SHA-256 of every code issued, so links nobody issued are never recorded. Regenerate it from the sheet when new codes are issued.

- **Opening the link** records a `hit` (device type, or `scanner?` when it looks like a mail server checking links before delivery), sets `tape_r` (HttpOnly, the code) and `tape_t=1` for 30 days, and redirects to `DESTINATION` in `functions/r/[code].js`, the home page until the intro video has its own page.
- **On that visit** `track.js` sends page views, video milestones (0, 25, 50, 75, 100%), seconds a page was visible and a waitlist sign-up (never the address) to `/api/e`, which stores them under the code from the HttpOnly cookie. Visitors without the cookie, and browsers that send Global Privacy Control, send and store nothing.
- **Not stored:** IP addresses, user agents, referrers, form contents. Country is Cloudflare's two-letter code. Events older than 90 days are deleted whenever a new one is written; each code is capped at 500 events a day, and all codes together at 20,000.
- **Results:** in the Pages project, Settings → Variables and secrets → Production → add the secret `STATS_PASSWORD`, then redeploy. `https://tapeit.dev/admin/outreach` then asks for a password (any user name): one row per code with first click, link opens and how many were mail scanners, pages seen in a browser, video watched, seconds on the site, sign-up, country and last visit. `?format=csv` downloads it. Without the secret the page doesn't exist.
- **Raw events** in the D1 console: `SELECT * FROM outreach_events ORDER BY at DESC LIMIT 200;`
- The privacy page describes all of this under "Personal links in our emails". Keep it in step with the code.
