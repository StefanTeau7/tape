// Names the page's stylesheet and script after their content, and points the
// HTML pages, _headers and the Pages function's own page at the new names. Run
// it before every release:
//
//   node scripts/hash-assets.mjs
//
// Why: browsers may keep a stylesheet or script for hours (Cloudflare's own
// browser-cache setting overrides the shorter times in _headers). With a fixed
// name, a new page could load with yesterday's styles. A changed file gets a new
// name, so a page always loads exactly the files it was built with, and those
// files can be cached for a year.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../public/', import.meta.url).pathname;
const functionsDir = new URL('../functions/api/', import.meta.url).pathname;
// Each asset's base name and extension; the hash goes between them.
const assets = [
  ['site', 'css'],
  ['tape', 'js'],
  ['track', 'js'],
];
const pages = readdirSync(root).filter((name) => name.endsWith('.html')).concat('_headers').map((name) => join(root, name))
  .concat(readdirSync(functionsDir).filter((name) => name.endsWith('.js')).map((name) => join(functionsDir, name)));
const files = readdirSync(root);
const renames = [];

for (const [base, ext] of assets) {
  const pattern = new RegExp(`^${base}(?:\\.[0-9a-f]{12})?\\.${ext}$`);
  const current = files.filter((name) => pattern.test(name));
  if (current.length !== 1) throw new Error(`expected one ${base}.*.${ext} in public/, found ${current.length}: ${current.join(', ')}`);
  const hash = createHash('md5').update(readFileSync(join(root, current[0]))).digest('hex').slice(0, 12);
  const next = `${base}.${hash}.${ext}`;
  if (next === current[0]) continue;
  renameSync(join(root, current[0]), join(root, next));
  renames.push([current[0], next]);
}

for (const path of pages) {
  let text = readFileSync(path, 'utf8');
  const before = text;
  // Replace whole names only: "site.css" inside "my-site.css" must not match.
  for (const [from, to] of renames) text = text.replace(new RegExp(`(^|[/"'\\s])${from.replace(/\./g, '\\.')}(?=$|["'\\s])`, 'gm'), `$1${to}`);
  if (text !== before) writeFileSync(path, text);
}

console.log(renames.length ? renames.map(([from, to]) => `${from} -> ${to}`).join('\n') : 'All assets already named by content.');
