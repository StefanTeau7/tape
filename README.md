# tapeit.dev

The Tape waitlist site: one static page plus one Cloudflare Pages Function.

```
public/              static site (the Pages build output directory)
  index.html         the page: the taped wall, How it feels, RIP copies, the try-it doc, the pick, sign-up
  site.*.css         all styles (no inline styles: the CSP forbids them)
  tape.*.js          all behaviour: the typing wall, Rolf, the try-it doc, the pick, the forms
  privacy.html       the privacy page
  404.html           the answer for addresses that don’t exist (without it, Pages would serve the home page)
  fonts/             self-hosted fonts and their licences
  assets/            favicon (Rolf), home-screen icon, link preview image (og.png)
  _headers, robots.txt, sitemap.xml
functions/api/
  waitlist.js        POST /api/waitlist → D1, and the welcome email
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
   - Project name: `tape-site` (the function accepts `tape-site.pages.dev` and its preview addresses as origins; another name needs `ALLOWED_ORIGINS` in `functions/api/waitlist.js` changed)
   - Production branch: `main`
   - Build command: none
   - Build output directory: `public`
   - Root directory: leave empty (the repository root)
3. **D1.** Storage & Databases → D1 → Create two databases, each loaded with `schema.sql` in its console:
   - `tape-site`: the real waitlist, bound as `WAITLIST_DB` for Production (Pages project → Settings → Bindings).
   - `tape-site-preview`: bound as `WAITLIST_DB` for Preview, so sign-ups on preview addresses never reach the real list.
4. **Domain.** With tapeit.dev on Cloudflare (buying it through Cloudflare Registrar does this), Pages project → Custom domains → add `tapeit.dev` and `www.tapeit.dev`.
5. **Sending email (Resend).** In Resend: Domains → Add domain → `tapeit.dev`. Add the DNS records it lists in Cloudflare → tapeit.dev → DNS (a DKIM TXT record at `resend._domainkey`, and an SPF TXT record and a bounce MX record on the `send` subdomain), set to DNS only, then verify. Leave open and click tracking off: the privacy page says the emails carry none. Then API Keys → Create → Sending access, limited to `tapeit.dev`.
   In the Pages project: Settings → Variables and secrets → Production → add the secret `RESEND_API_KEY` with that key. Optional: `WAITLIST_FROM`, the sender, by default `Tape <hello@tapeit.dev>`. Preview gets no key, so sign-ups on preview addresses never send email. Redeploy once after adding the secret; secrets apply to new deployments.
   Recommended for deliverability: a DMARC record, TXT `_dmarc` → `v=DMARC1; p=none;`.
6. **Receiving email.** Cloudflare → tapeit.dev → Email → Email Routing → enable (it adds its own MX and TXT records on the apex; Resend's MX sits on `send`, so they don't clash). Add the custom address `hello@tapeit.dev` → forward to Stefan's inbox, and confirm the destination from the email Cloudflare sends. The welcome email asks a question and says "Just hit reply", and its `reply_to` is `hello@tapeit.dev`, so this has to work before the first sign-up.
7. **Placeholders.** Fill in the company name and contact in `public/privacy.html` (highlighted on the page). The email's sign-off is `SIGN_OFF` in `functions/api/waitlist.js`.

Every push to `main` then deploys to production. Other branches get preview addresses such as `https://feat-copy.tape-site.pages.dev`.

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
