/**
 * The Content-Security-Policy <meta> tags of the website and the web app (GitHub Pages cannot send headers).
 * If this fails after an inline script on the website changed, run: node app/scripts/site-csp.cjs --write
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/config';

// The app has no Node types, so the calls the test needs are typed here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync: (file: string, enc: 'utf8') => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as { resolve: (...parts: string[]) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const site = require('../../../scripts/site-csp.cjs') as {
  PAGES: string[];
  ROOT: string;
  inlineScripts: (html: string) => string[];
  sitePolicy: (pages: string[]) => string;
};

const read = (file: string) => fs.readFileSync(file, 'utf8');
const policyOf = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? null;
const directives = (policy: string) =>
  Object.fromEntries(
    policy
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name, values]),
  ) as Record<string, string[]>;

describe('website Content-Security-Policy', () => {
  const pages = site.PAGES.map((p) => read(path.resolve(site.ROOT, p)));

  it('is on every page, before any script or stylesheet, and matches the current inline scripts', () => {
    const expected = site.sitePolicy(pages);
    site.PAGES.forEach((name, i) => {
      const html = pages[i];
      expect({ name, policy: policyOf(html) }).toEqual({ name, policy: expected });
      const meta = html.indexOf('http-equiv="Content-Security-Policy"');
      for (const tag of ['<script', '<link rel="stylesheet"', '<style']) {
        const at = html.indexOf(tag);
        if (at >= 0) expect(meta).toBeLessThan(at);
      }
      expect(html).toContain('<meta name="referrer" content="strict-origin-when-cross-origin">');
    });
  });

  it('allows no eval, no plugins and no inline scripts beyond the hashed ones', () => {
    const d = directives(site.sitePolicy(pages));
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(d['script-src']).not.toContain("'unsafe-eval'");
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['connect-src']).toContain(SUPABASE_URL);
  });

  it('never carries a secret key', () => {
    for (const html of pages) {
      expect(html).not.toMatch(/sb_secret_|service_role|sk_live_|sk_test_|rk_live_|whsec_|-----BEGIN [A-Z ]*PRIVATE KEY/);
      const keys = html.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [];
      keys.forEach((k) => expect(k).toBe(SUPABASE_PUBLISHABLE_KEY));
    }
  });
});

describe('web app Content-Security-Policy (public/index.html)', () => {
  const html = read(path.resolve('public/index.html'));
  const policy = policyOf(html.replace(/" \/>/g, '">'));
  const d = directives(policy ?? '');

  it('is set, before the inline style', () => {
    expect(policy).toBeTruthy();
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style'));
    expect(html).toContain('<meta name="referrer" content="strict-origin-when-cross-origin" />');
  });

  it('allows scripts from the site only, with no eval', () => {
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
  });

  it('lets the app reach its Supabase project, including realtime', () => {
    expect(d['connect-src']).toEqual(expect.arrayContaining(["'self'", SUPABASE_URL, SUPABASE_URL.replace(/^https:/, 'wss:')]));
    expect(d['img-src']).toContain(SUPABASE_URL);
  });

  it('keeps the template placeholders Expo fills in', () => {
    expect(html).toContain('%LANG_ISO_CODE%');
    expect(html).toContain('%WEB_TITLE%');
    expect(html).toContain('<div id="root"></div>');
  });
});
