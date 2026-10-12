/* eslint-disable */
/**
 * Keeps the website's Content-Security-Policy <meta> tags up to date.
 *
 *   node scripts/site-csp.cjs           # check: exits 1 if a page's policy is missing or out of date
 *   node scripts/site-csp.cjs --write   # rewrite the policy in every page
 *
 * GitHub Pages cannot send HTTP headers, so each page carries its policy in a <meta http-equiv> tag. Inline scripts
 * are allowed by their SHA-256 hash, so after editing an inline <script> in index.html or 404.html, run this with
 * --write (the unit test src/lib/__tests__/csp.test.ts fails until you do).
 *
 * frame-ancestors, report-uri and sandbox are ignored in a <meta> policy, so they are not set here.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['index.html', '404.html', 'privacy/index.html', 'terms/index.html', 'support/index.html'];
const SUPABASE = 'https://tzahajbulieoalzuzclv.supabase.co';
const TURNSTILE = 'https://challenges.cloudflare.com';

/** The text of every inline (src-less) script in a page. */
function inlineScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\ssrc\s*=/i.test(m[1] || '')) continue;
    out.push(m[2]);
  }
  return out;
}

const hash = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** One policy for the whole site, allowing every page's inline scripts. */
function sitePolicy(pages) {
  const hashes = [...new Set(pages.flatMap((html) => inlineScripts(html).map(hash)))].sort();
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...hashes, TURNSTILE].join(' '),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self' ${SUPABASE} ${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const CSP_RE = /[ \t]*<meta http-equiv="Content-Security-Policy" content="[^"]*">\n/;
const REFERRER_RE = /[ \t]*<meta name="referrer" content="[^"]*">\n/;

function withPolicy(html, policy) {
  const charset = /^([ \t]*)<meta charset="[^"]*">\n/im.exec(html);
  if (!charset) throw new Error('page has no <meta charset> line');
  const indent = charset[1];
  const tags = `${indent}<meta http-equiv="Content-Security-Policy" content="${policy}">\n${indent}<meta name="referrer" content="strict-origin-when-cross-origin">\n`;
  const stripped = html.replace(CSP_RE, '').replace(REFERRER_RE, '');
  const at = stripped.indexOf(charset[0]) + charset[0].length;
  return stripped.slice(0, at) + tags + stripped.slice(at);
}

function main() {
  const write = process.argv.includes('--write');
  const files = PAGES.map((p) => path.join(ROOT, p));
  const pages = files.map((f) => fs.readFileSync(f, 'utf8'));
  const policy = sitePolicy(pages);
  let stale = 0;
  files.forEach((file, i) => {
    const next = withPolicy(pages[i], policy);
    if (next === pages[i]) return;
    if (write) {
      fs.writeFileSync(file, next);
      console.log(`updated ${path.relative(ROOT, file)}`);
    } else {
      stale++;
      console.error(`out of date: ${path.relative(ROOT, file)}`);
    }
  });
  if (stale) {
    console.error('Run: node app/scripts/site-csp.cjs --write');
    process.exit(1);
  }
}

module.exports = { inlineScripts, sitePolicy, withPolicy, PAGES, ROOT };
if (require.main === module) main();
