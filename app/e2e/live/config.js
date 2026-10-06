/* global __dirname */
// Live end-to-end harness: configuration and the safety rules every script obeys.
//
// Everything comes from environment variables. Secrets (passwords, the Stripe test key) are set in the cloud
// environment's settings, never written in this repository or pasted into a chat. See README.md.
//
// SAFETY RULE: the harness only ever signs in as dedicated test logins and only ever touches records whose
// names contain "E2E". It refuses to start when:
//   - any test login email does not contain "+e2e" (e.g. craig+e2e-admin@eliteeducation.me) and does not end
//     with the test domain set in E2E_TEST_DOMAIN (e.g. "@e2e.eliteeducation.me");
//   - the test family, student or tutor names do not contain "E2E";
//   - STRIPE_TEST_SECRET_KEY is set but is not a test-mode key (sk_test_ / rk_test_).
// payments.js also aborts if Stripe Checkout shows anything other than test mode.
// DEMO=1 runs the same scripts against the demo build (sample data in the browser only), so none of this applies.

const fs = require('fs');
const path = require('path');

const env = process.env;
const DEMO = env.DEMO === '1';

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

/** Demo build: the role buttons on the sign-in screen and the sample family stand in for the test accounts. */
const DEMO_MAP = {
  base: trimSlash(env.BASE || env.LIVE_BASE || 'http://localhost:8505'),
  roles: {
    admin: { button: 'Admin · ', name: "Craig O'Brien", email: 'craig@eliteeducation.me' },
    tutor: { button: 'Tutor · ', name: 'Sarah Khan', email: 'sarah@eliteeducation.me' },
    parent: { button: 'Parent · ', name: 'Fatima Al Mansoori', email: 'fatima@example.com' },
  },
  family: 'Al Mansoori',
  student: 'Layla Al Mansoori',
  tutor: 'Sarah Khan',
};

const LIVE = {
  base: trimSlash(env.LIVE_BASE || 'https://eliteeducationuae.github.io/app'),
  roles: {
    admin: { email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD },
    tutor: { email: env.E2E_TUTOR_EMAIL, password: env.E2E_TUTOR_PASSWORD },
    parent: { email: env.E2E_PARENT_EMAIL, password: env.E2E_PARENT_PASSWORD },
  },
  family: env.E2E_FAMILY_NAME || 'E2E Test',
  student: env.E2E_STUDENT_NAME || 'E2E Student',
  tutor: env.E2E_TUTOR_NAME || 'E2E Tutor',
};

const SUPABASE_URL = trimSlash(env.SUPABASE_URL || 'https://tzahajbulieoalzuzclv.supabase.co');
// The public (publishable) key shipped inside the app; reading through it is limited by row-level security.
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || 'sb_publishable_GGcYrMILBwC_39aVhEiQ4w_uuQ06_Q6';

/** A test login: contains "+e2e", or ends with the test domain Craig chose (E2E_TEST_DOMAIN). */
function isTestEmail(email, testDomain = env.E2E_TEST_DOMAIN) {
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  if (e.includes('+e2e')) return true;
  const d = String(testDomain || '').trim().toLowerCase();
  if (!d) return false;
  return e.endsWith(d.startsWith('@') ? d : `@${d}`) || e.endsWith(`.${d.replace(/^@/, '')}`);
}

const isTestName = (name) => /e2e/i.test(String(name || ''));

/** Problems that stop a live run before a browser is opened. `need` lists the roles the script signs in as. */
function safetyProblems(need = ['admin', 'tutor', 'parent']) {
  if (DEMO) return [];
  const problems = [];
  for (const role of need) {
    const r = LIVE.roles[role];
    const upper = role.toUpperCase();
    if (!r.email) problems.push(`E2E_${upper}_EMAIL is not set.`);
    else if (!isTestEmail(r.email)) problems.push(`E2E_${upper}_EMAIL (${r.email}) is not a test login: it must contain "+e2e" or end with E2E_TEST_DOMAIN.`);
    if (!r.password) problems.push(`E2E_${upper}_PASSWORD is not set.`);
  }
  for (const [key, value] of [['E2E_FAMILY_NAME', LIVE.family], ['E2E_STUDENT_NAME', LIVE.student], ['E2E_TUTOR_NAME', LIVE.tutor]]) {
    if (!isTestName(value)) problems.push(`${key} ("${value}") must contain "E2E" so that real families and tutors can never be chosen.`);
  }
  const sk = env.STRIPE_TEST_SECRET_KEY;
  if (sk && !/^(sk|rk)_test_/.test(sk)) problems.push('STRIPE_TEST_SECRET_KEY is not a test-mode key (sk_test_ or rk_test_). Live keys are never accepted.');
  if (!/^https:\/\//.test(LIVE.base)) problems.push(`LIVE_BASE (${LIVE.base}) must be an https address.`);
  return problems;
}

/** One id for the whole run (run-all.sh shares it), so every record a run creates carries "E2E-<runid>". */
function runId() {
  if (env.E2E_RUN_ID) return env.E2E_RUN_ID;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The newest migration in the repository, i.e. the database version System health should report. */
function expectedDbVersion() {
  const dir = path.resolve(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const last = files[files.length - 1];
  return { version: last.slice(0, 14), name: last.slice(15, -4) };
}

const config = {
  DEMO,
  base: DEMO ? DEMO_MAP.base : LIVE.base,
  roles: DEMO ? DEMO_MAP.roles : LIVE.roles,
  family: DEMO ? DEMO_MAP.family : LIVE.family,
  student: DEMO ? DEMO_MAP.student : LIVE.student,
  tutor: DEMO ? DEMO_MAP.tutor : LIVE.tutor,
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  googleClientId: env.E2E_GOOGLE_CLIENT_ID || '',
  stripeTestKey: env.STRIPE_TEST_SECRET_KEY || '',
  runId: runId(),
  runStartedAt: env.E2E_RUN_STARTED_AT || new Date().toISOString(),
  outDir: path.resolve(env.E2E_OUT || path.join(__dirname, 'out')),
  headed: env.HEADED === '1',
  chromium: env.E2E_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  playwright: env.E2E_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright',
  // How long to wait for webhooks, outbox sends and calendar sync before giving up.
  asyncTimeoutMs: Number(env.E2E_ASYNC_TIMEOUT_MS || (DEMO ? 5000 : 180000)),
};

module.exports = { config, isTestEmail, isTestName, safetyProblems, expectedDbVersion };
