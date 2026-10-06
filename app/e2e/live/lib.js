// Shared helpers for the live end-to-end harness: browser, reporting, sign-in and sign-out, run-id tagging,
// a ledger of what each run created (for cleanup.js), and read-only REST checks made as the signed-in admin.
const fs = require('fs');
const path = require('path');

const { config, safetyProblems } = require('./config');

const ACCOUNT_PATH = { admin: '/admin/more', tutor: '/tutor/account', parent: '/parent/account', student: '/student/account', accountant: '/accountant/account' };
const HOME_RE = /\/(admin|tutor|parent|student|accountant|onboarding)(\/|\?|$)/;

/** "E2E-<runid>", plus an optional suffix: put it in every name or note a script creates. */
const tag = (suffix) => `E2E-${config.runId}${suffix ? ` ${suffix}` : ''}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a browser for one script. `need` lists the roles the script signs in as (checked by the safety rule).
 * Returns the harness object `h` with the page and all helpers.
 */
async function start(name, { need = ['admin', 'tutor', 'parent'], width = 1280 } = {}) {
  const problems = safetyProblems(need);
  const runDir = path.join(config.outDir, config.runId);
  fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true });
  if (problems.length) {
    console.log(`[${name}] REFUSED to run against the live app:`);
    for (const p of problems) console.log(`  - ${p}`);
    writeResult(runDir, name, { status: 'REFUSED', ok: 0, fail: 0, skip: 0, notes: problems });
    process.exit(2);
  }

  const { chromium } = require(config.playwright);
  const launch = { executablePath: config.chromium, headless: !config.headed };
  if (process.env.E2E_PROXY) launch.proxy = { server: process.env.E2E_PROXY };
  // In a sandbox whose egress proxy re-signs TLS (Claude Code cloud sessions), Chromium does not read the system
  // trust store, so the proxy's own CA is trusted by its public key. TLS is still verified against it.
  const ca = trustedCa();
  if (ca) launch.args = [`--ignore-certificate-errors-spki-list=${ca}`];
  const browser = await chromium.launch(launch);

  const counts = { ok: 0, fail: 0, skip: 0 };
  const notes = [];
  const failures = [];
  const consoleErrors = [];
  const dialogs = [];
  let declineNext = 0;
  let ctx;
  let page;

  const log = (line) => console.log(`[${name}] ${line}`);

  const h = {
    name,
    config,
    runDir,
    tag,
    dialogs,
    consoleErrors,
    get page() {
      return page;
    },
    get context() {
      return ctx;
    },
    log,
    step: (msg) => log(`== ${msg}`),
    ok(cond, msg) {
      if (cond) {
        counts.ok++;
        log(`  ok   ${msg}`);
      } else {
        counts.fail++;
        failures.push(msg);
        log(`  FAIL ${msg}`);
      }
      return !!cond;
    },
    fail(msg) {
      return h.ok(false, msg);
    },
    skip(msg) {
      counts.skip++;
      notes.push(`SKIPPED: ${msg}`);
      log(`  skip ${msg}`);
    },
    note(msg) {
      notes.push(msg);
      log(`  note ${msg}`);
    },
    /** Remember something this run created, so cleanup.js can find it again. */
    record(kind, data) {
      fs.appendFileSync(path.join(runDir, 'created.jsonl'), JSON.stringify({ kind, script: name, at: new Date().toISOString(), ...data }) + '\n');
    },
    declineNextDialog(n = 1) {
      declineNext = n;
    },

    /** A fresh browser context (fresh cookies and storage) at the given width. */
    async open(w = width) {
      if (ctx) await ctx.close();
      ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: 1 });
      // Never let the harness open a real Meet call.
      await ctx.route('https://meet.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Meet (stubbed by the E2E harness)</p>' }));
      page = await ctx.newPage();
      page.on('pageerror', (e) => consoleErrors.push({ url: page.url(), text: `pageerror: ${e.message}` }));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        // GitHub Pages answers a deep link (e.g. /app/invoice/…) with its 404.html, which hands the address to the
        // app. Chrome logs that document's 404 as an error; it is expected, so only that one is set aside.
        const loc = (m.location() && m.location().url) || '';
        if (!config.DEMO && /status of 404/.test(m.text()) && loc.startsWith(config.base) && !/\.[a-z0-9]{2,5}(\?|$)/i.test(loc)) return;
        consoleErrors.push({ url: page.url(), text: `console: ${m.text()}` });
      });
      ctx.on('page', (p) => {
        p.on('dialog', (d) => d.accept().catch(() => undefined));
      });
      page.on('dialog', async (d) => {
        dialogs.push(d.message());
        if (declineNext > 0) {
          declineNext--;
          await d.dismiss().catch(() => undefined);
        } else await d.accept().catch(() => undefined);
      });
      return page;
    },
    async setWidth(w) {
      await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
    },

    // ---- finding and pressing things -------------------------------------------------------------
    vis: (loc) => loc.filter({ visible: true }),
    text: (t, exact = false) => page.getByText(t, { exact }).filter({ visible: true }),
    async has(t, exact = false) {
      return (await h.text(t, exact).count()) > 0;
    },
    async waitText(t, { exact = false, timeout = 20000 } = {}) {
      await h.text(t, exact).first().waitFor({ timeout });
    },
    async tryWaitText(t, opts) {
      try {
        await h.waitText(t, opts);
        return true;
      } catch {
        return false;
      }
    },
    button: (n) => page.getByRole('button', { name: n }).filter({ visible: true }),
    async press(n, { last = true, wait = 900 } = {}) {
      const b = h.button(n);
      await (last ? b.last() : b.first()).click();
      await page.waitForTimeout(wait);
    },
    async click(t, exact = false, wait = 800) {
      await h.text(t, exact).last().click();
      await page.waitForTimeout(wait);
    },
    box: (label) => page.getByRole('textbox', { name: label }).filter({ visible: true }).first(),
    async fill(label, value) {
      const b = h.box(label);
      await b.fill('');
      await b.fill(String(value));
      await page.waitForTimeout(200);
    },
    async go(p, wait = 1800) {
      await h.goto(config.base + p);
      await page.waitForTimeout(wait);
    },
    /** page.goto that tolerates a slow network: waits for the document only, and retries once. */
    async goto(url) {
      try {
        return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (err) {
        log(`  .. retrying ${url} after: ${String(err.message).split('\n')[0]}`);
        return page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
    },
    async shot(label) {
      const file = path.join(runDir, 'shots', `${name}-${label}.png`);
      await page.screenshot({ path: file }).catch(() => undefined);
      return file;
    },
    async bodyText() {
      return page.evaluate(() => document.body.innerText);
    },
    /** Poll `fn` until it returns a truthy value or the async timeout passes. */
    async poll(fn, { timeout = config.asyncTimeoutMs, every = 5000, label = 'condition' } = {}) {
      const until = Date.now() + timeout;
      for (;;) {
        const v = await fn().catch(() => null);
        if (v) return v;
        if (Date.now() > until) {
          log(`  .. gave up waiting for ${label} after ${Math.round(timeout / 1000)}s`);
          return null;
        }
        await sleep(every);
      }
    },

    // ---- signing in and out ------------------------------------------------------------------------
    /** Sign in through the real sign-in screen (email and password), or with the demo role button when DEMO=1. */
    async signIn(role) {
      const r = config.roles[role];
      if (config.DEMO) {
        await h.goto(config.base + '/');
        await page.waitForTimeout(400);
        // Only the session is forgotten: the demo data written so far stays in this browser.
        await page.evaluate(() => localStorage.removeItem('elite.demo.session'));
        await h.goto(config.base + '/');
        await h.waitText('Demo mode');
        await h.text(`${r.button}${r.name}`).first().click();
      } else {
        await h.goto(config.base + '/sign-in');
        await page.waitForTimeout(1500);
        if (await h.has('Demo mode')) throw new Error(`${config.base} is a demo build, not the live app. Refusing to continue.`);
        if (HOME_RE.test(new URL(page.url()).pathname)) await h.signOut();
        await h.box('Email').waitFor({ timeout: 30000 });
        await h.fill('Email', r.email);
        await h.fill('Password', r.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).last().click();
      }
      await page.waitForURL((u) => HOME_RE.test(u.pathname), { timeout: 30000, waitUntil: 'commit' });
      await page.waitForTimeout(1500);
      return true;
    },
    /** Sign out with the Sign out button on the role's account screen. */
    async signOut(role) {
      const pathname = new URL(page.url()).pathname;
      const r = role || (pathname.match(/\/(admin|tutor|parent|student|accountant)(\/|$)/) || [])[1];
      if (!r) return;
      await h.go(ACCOUNT_PATH[r]);
      const b = h.button('Sign out');
      await b.last().scrollIntoViewIfNeeded();
      await b.last().click();
      await page.waitForURL((u) => /sign-in/.test(u.pathname), { timeout: 20000, waitUntil: 'commit' }).catch(() => undefined);
      await page.waitForTimeout(800);
    },
    accountPath: (role) => ACCOUNT_PATH[role],

    // ---- read-only checks through the API, as the signed-in user (live only) --------------------------
    /** GET /rest/v1/<pathAndQuery> with the signed-in user's own session; row-level security applies. */
    async rest(pathAndQuery) {
      if (config.DEMO) return null;
      return page.evaluate(
        async ({ url, key, pq }) => {
          const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
          const s = k ? JSON.parse(localStorage.getItem(k)) : null;
          const token = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
          if (!token) throw new Error('No signed-in session in this browser.');
          const res = await fetch(`${url}/rest/v1/${pq}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`REST ${res.status}: ${await res.text()}`);
          return res.json();
        },
        { url: config.supabaseUrl, key: config.supabaseAnonKey, pq: pathAndQuery },
      );
    },

    /** Console errors since `since` (an index into consoleErrors). */
    errorsSince(since) {
      return consoleErrors.slice(since);
    },

    /** DEMO only: the demo data lives in this browser, so it is saved with the run for cleanup.js to reopen. */
    async saveDemoDb() {
      if (!config.DEMO || !page) return;
      const db = await page.evaluate(() => localStorage.getItem('elite.demo.db')).catch(() => null);
      if (db) fs.writeFileSync(path.join(runDir, `demo-db-${name}.json`), db);
    },
    async loadDemoDb(script) {
      const file = path.join(runDir, `demo-db-${script}.json`);
      if (!config.DEMO || !fs.existsSync(file)) return false;
      await h.goto(config.base + '/');
      await page.evaluate((db) => localStorage.setItem('elite.demo.db', db), fs.readFileSync(file, 'utf8'));
      return true;
    },

    async finish() {
      if (name !== 'cleanup') await h.saveDemoDb();
      const status = counts.fail ? 'FAIL' : counts.skip ? 'PARTIAL' : 'PASS';
      if (consoleErrors.length) notes.push(`${consoleErrors.length} console error(s) seen: ${consoleErrors.slice(0, 5).map((e) => e.text).join(' | ')}`);
      writeResult(runDir, name, { status, ...counts, failures, notes, demo: config.DEMO, base: config.base });
      log(`RESULT ${status}  ok=${counts.ok} fail=${counts.fail} skip=${counts.skip}`);
      await browser.close().catch(() => undefined);
      process.exit(counts.fail ? 1 : 0);
    },
    async abort(err) {
      counts.fail++;
      failures.push(`aborted: ${err && err.message ? err.message.split('\n')[0] : err}`);
      log(`ABORTED: ${err && err.stack ? err.stack : err}`);
      await h.shot('aborted');
      return h.finish();
    },
  };

  log(`${config.DEMO ? 'DEMO' : 'LIVE'} run ${config.runId} against ${config.base}`);
  await h.open(width);
  return h;
}

/** SPKI hash of the egress proxy's CA (E2E_TRUST_CA, or the cloud session's agent proxy CA when present). */
function trustedCa() {
  const file = process.env.E2E_TRUST_CA || (process.env.HTTPS_PROXY && fs.existsSync('/root/.ccr/agent-proxy-ca.crt') ? '/root/.ccr/agent-proxy-ca.crt' : '');
  if (!file || !fs.existsSync(file)) return '';
  const crypto = require('crypto');
  const cert = new crypto.X509Certificate(fs.readFileSync(file));
  return crypto.createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
}

function writeResult(runDir, name, result) {
  fs.writeFileSync(path.join(runDir, `${name}.json`), JSON.stringify({ name, runId: config.runId, finishedAt: new Date().toISOString(), ...result }, null, 2));
}

/** Read what this run (or another run id) created. */
function readLedger(runId = config.runId) {
  const file = path.join(config.outDir, runId, 'created.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Run a script body with the harness, turning any thrown error into a clear FAIL. */
async function run(name, opts, body) {
  let h;
  try {
    h = await start(name, opts);
    await body(h);
    await h.finish();
  } catch (err) {
    if (h) await h.abort(err);
    else {
      console.error(err);
      process.exit(1);
    }
  }
}

/** A date `days` from today as YYYY-MM-DD (local time). */
function dateKey(days) {
  const d = new Date(Date.now() + days * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { run, tag, sleep, readLedger, dateKey, config };
