# Live end-to-end harness

Browser tests that drive the **real** app at https://eliteeducationuae.github.io/app/ against the live Supabase
project (`tzahajbulieoalzuzclv`), as dedicated test logins. Plain Node and Playwright, no test framework.

| Script | What it proves | Accounts |
| --- | --- | --- |
| `public.js` | Signed out, read-only: the sign-in screen and website pages load at 390px and 1280px with no console errors or sideways scrolling; a deep link lands on sign-in; the Apple and Google buttons show only for providers the live project has switched on; Continue with Google (when on) goes through the Supabase authorize URL to accounts.google.com; which sign-in providers are enabled | none |
| `auth.js` | Email sign-in and sign-out for admin, tutor and parent through the real sign-in screen; a wrong password is refused; the Google button's client id and redirect URI (Google itself is never signed in to) | all three |
| `lessons.js` | Admin books a lesson for the test student with the test tutor; the tutor records notes and homework; the parent sees both | all three |
| `calendar.js` | The tutor's Google Calendar status. If connected: a booked lesson gets a Google event id (`lesson_calendar_events`) and a Meet link shown as "Join lesson". If not: reports **NOT CONNECTED** and skips | admin, tutor |
| `payments.js` | Admin invoices a recorded test lesson; the parent pays on Stripe Checkout in **test mode** with 4242 4242 4242 4242; the admin refunds part with a credit note | admin, parent |
| `smoke.js` | Every main screen for each role at 390px and 1280px: no console errors, no error screen, no sideways scrolling. System health: every scheduled job Working, and the database version equals the newest file in `supabase/migrations` | all three |
| `email.js` | Inboxes cannot be read, so it checks the sending side: outbox rows queued for the test accounts since the run started are all sent without errors, and System health shows notifications Working | admin |
| `cleanup.js` | Undoes what the run created, through the app as the admin (see below) | admin |

`run-all.sh` runs `public`, `auth`, `lessons`, `calendar`, `payments` and `smoke` in parallel, then `email`, then
`cleanup`, and prints a summary table. Each script exits 0 (PASS or PARTIAL, meaning some checks were skipped with
a reason), 1 (FAIL) or 2 (REFUSED by the safety rule). Logs, screenshots and JSON results go to `out/<runid>/`
(ignored by git).

## Safety rule: never touch real families

`config.js` refuses to start a live run unless:

- every test login email contains **`+e2e`** (for example `craig+e2e-admin@eliteeducation.me`) or ends with the test
  domain in `E2E_TEST_DOMAIN` (for example `e2e.eliteeducation.me`, if Craig sets one up);
- the test family, student and tutor names contain **`E2E`**; the scripts also refuse to pick any student or tutor
  chip, lesson or invoice that is not an E2E record;
- `STRIPE_TEST_SECRET_KEY`, if set, is a test key (`sk_test_` or `rk_test_`).

`payments.js` additionally aborts **before entering any card details** unless Stripe Checkout is a `cs_test_`
session showing a "Test mode" or "Sandbox" badge. While the live project uses live Stripe keys, it will always
abort, by design. Google is never signed in to: the request to accounts.google.com is answered by a stub.

Every record a run creates carries `E2E-<runid>` (lesson subjects, notes, homework, refund and credit-note reasons),
and each script appends what it created to `out/<runid>/created.jsonl` for `cleanup.js`.

## One-off setup (Craig)

Create these in the live app, as you would for a real family and tutor:

1. **Test family** named `E2E Test`, with one student `E2E Student`, and a parent login such as
   `craig+e2e-parent@eliteeducation.me`. The family must hold **no prepaid package**, so recorded lessons become
   charges that can be invoiced.
2. **Test tutor** named `E2E Tutor` with a login such as `craig+e2e-tutor@eliteeducation.me`, teaching the test
   student, with vetting checks complete (otherwise booking is refused). For `calendar.js`, sign in as the tutor once
   and press **Connect Google Calendar** on the Account screen, using a Google account kept for testing.
3. **Test admin** login such as `craig+e2e-admin@eliteeducation.me`, given the admin role.
4. Sign in once as each to set the passwords and finish any onboarding.
5. For `payments.js`: the project's Stripe keys must be **test mode** keys (a staging setup), or the script aborts.

Then add the settings as **environment variables in the cloud environment's settings** (claude.ai, Claude Code
environment settings). Never put passwords or keys in this repository, in a commit, or in a chat message.

| Variable | Required | Example or default |
| --- | --- | --- |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | yes | `craig+e2e-admin@eliteeducation.me` |
| `E2E_TUTOR_EMAIL`, `E2E_TUTOR_PASSWORD` | yes | `craig+e2e-tutor@eliteeducation.me` |
| `E2E_PARENT_EMAIL`, `E2E_PARENT_PASSWORD` | yes | `craig+e2e-parent@eliteeducation.me` |
| `E2E_FAMILY_NAME`, `E2E_STUDENT_NAME`, `E2E_TUTOR_NAME` | no | `E2E Test`, `E2E Student`, `E2E Tutor` (must contain E2E) |
| `E2E_TEST_DOMAIN` | no | a domain used only for test logins |
| `E2E_SERVICE_NAME` | no | the lesson type to book (defaults to the first listed) |
| `E2E_GOOGLE_CLIENT_ID` | no | the Google OAuth client id, to check it exactly (otherwise only its shape) |
| `STRIPE_TEST_SECRET_KEY` | no | `sk_test_…` (only ever checked to be a test key) |
| `LIVE_BASE`, `LIVE_SITE` | no | `https://eliteeducationuae.github.io/app`, `https://eliteeducationuae.github.io` |
| `E2E_ASYNC_TIMEOUT_MS` | no | how long to wait for webhooks, sync and emails (180000) |
| `E2E_SKIP_CLEANUP=1` | no | keep the run's data to look at it in the app |

The machine also needs network access to `eliteeducationuae.github.io`, `tzahajbulieoalzuzclv.supabase.co`,
`checkout.stripe.com` (and Stripe's `js.stripe.com`, `m.stripe.network`) and `accounts.google.com`.

## Running

```sh
cd app/e2e/live
./run-all.sh                    # everything, live
node public.js                  # signed-out checks only; needs no accounts
node lessons.js                 # one area
node cleanup.js <runid>         # tidy up after an interrupted run
```

In a Claude Code cloud session the egress proxy re-signs TLS, and Chromium does not read the system trust store, so
`lib.js` trusts that proxy's CA (`/root/.ccr/agent-proxy-ca.crt`, or `E2E_TRUST_CA`) by its public key. TLS is still
verified.

## What cleanup can and cannot undo

- Scheduled test lessons are **cancelled** with more than the notice period, so nothing is charged.
- Recorded lessons cannot be cancelled or deleted. They, their notes and homework stay on the E2E student as history.
- Uninvoiced charges from recorded test lessons are invoiced to the E2E family and **credited in full** with a credit
  note (the lessons are not released to be invoiced again), so nothing is left waiting under Ready to invoice.
- Issued invoices are permanent tax records and are never deleted. Unpaid ones are credited in full; paid ones have
  the rest of the payment refunded (Stripe test mode) with a credit note, so each nets to zero in the books and VAT.
- Notifications already sent, and the history log, stay.

## Dry run against the demo build

`DEMO=1` maps sign-in to the demo role buttons (Admin · Craig O'Brien, Tutor · Sarah Khan, Parent · Fatima Al
Mansoori) and uses the sample family (Al Mansoori, Layla). Nothing leaves the browser, so the safety rule does not
apply. Live-only checks (Stripe Checkout, Google redirect, outbox rows, Google event ids) are reported as SKIPPED.
Each script's demo data is saved to `out/<runid>/demo-db-<script>.json` so that `cleanup.js` can reopen it.

```sh
cd app && EXPO_PUBLIC_DEMO=1 npx expo export --platform web     # build the demo into app/dist
# serve app/dist on a port (any static server that falls back to index.html), and the repo root for SITE
cd e2e/live && DEMO=1 BASE=http://localhost:8505 SITE=http://localhost:8605 ./run-all.sh
DEMO=1 E2E_DEMO_CALENDAR=not-connected node calendar.js   # rehearse the "not connected" report
```
