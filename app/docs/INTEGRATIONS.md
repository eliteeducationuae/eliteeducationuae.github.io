# Integrations: live setup (Google, Stripe, Resend)

One page, in the order to do it. Supabase project: `tzahajbulieoalzuzclv`. The app lives at
`https://eliteeducationuae.github.io/app` (and at `https://eliteeducation.me/app` once the domain points at GitHub
Pages). Wherever this guide says **APP**, use the one address families actually use, with no trailing slash.
Run every `npx supabase …` command from the `app/` folder (so `supabase/config.toml` is used), logged in with
`npx supabase login` and linked with `npx supabase link --project-ref tzahajbulieoalzuzclv`.

## 0. Database first

Run every migration up to `supabase/migrations/20261114000300_sec_fn.sql` in the Supabase SQL editor, in filename
order, **before** deploying the functions below (it adds the PKCE column, the rate limits and `reset_ics_token`).

## 1. Google Cloud (sign-in and Calendar share one OAuth client)

1. [console.cloud.google.com](https://console.cloud.google.com) → project picker → **New project** → name
   `Elite Education` → **Create**, then select it.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - **Branding:** App name `Elite Education`; user support email `hello@eliteeducation.me`; logo optional;
     home page `https://eliteeducation.me`; privacy policy `https://eliteeducation.me/privacy/`; terms
     `https://eliteeducation.me/terms/`. **Authorised domains:** `eliteeducation.me` and `supabase.co`.
     Developer contact: your email. **Save**.
   - **Audience:** User type **External**. Click **Publish app** when ready (while in *Testing*, only listed test
     users can sign in and Calendar access expires after 7 days).
   - **Data access → Add or remove scopes:** tick `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`,
     and add manually `https://www.googleapis.com/auth/calendar.events` and
     `https://www.googleapis.com/auth/calendar.freebusy` → **Update** → **Save**. The two Calendar scopes are
     *sensitive*: submit the app for Google verification (a short screen recording of connecting a calendar in the
     app, and why each scope is needed) so connections stop expiring and the "unverified app" warning disappears.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**, name
   `Elite Education web`:
   - **Authorised JavaScript origins:** `https://eliteeducationuae.github.io`, `https://eliteeducation.me`
     (origins only, no path).
   - **Authorised redirect URIs** (exactly, no trailing slash):
     - `https://tzahajbulieoalzuzclv.supabase.co/auth/v1/callback` (Google sign-in, via Supabase Auth)
     - `https://tzahajbulieoalzuzclv.supabase.co/functions/v1/google-connect` (Google Calendar connection)
   - **Create**, then copy the **Client ID** and **Client secret**.

## 2. Supabase Auth: Google provider and addresses

1. **Authentication → Sign In / Providers → Google** → enable → paste Client ID and Client secret → leave
   *Skip nonce checks* off → **Save**.
2. **Authentication → URL Configuration:** Site URL = `APP/`. Redirect URLs (add each):
   `https://eliteeducationuae.github.io/app/`, `https://eliteeducationuae.github.io/app/**`,
   `https://eliteeducation.me/app/`, `https://eliteeducation.me/app/**`, `eliteeducation://auth-callback`.
   Do **not** leave `http://localhost:8081/**` in the live project unless you develop against it.
3. **Authentication → Emails → SMTP Settings** → enable custom SMTP (Supabase's own sender only reaches project
   team members, so password resets, sign-up codes and the accountant invitation would never arrive): host
   `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key (step 4), sender email
   `hello@eliteeducation.me`, sender name `Elite Education`.

## 3. Stripe

1. Dashboard top-right: switch **Test mode** off for live (repeat everything in test mode with test keys first).
2. **Developers → API keys → Secret key → Reveal** → copy `sk_live_…` (`STRIPE_SECRET_KEY`). A restricted key also
   works if it has *write* on Checkout Sessions, Customers, Customer portal, PaymentIntents and Refunds, and *read* on
   PaymentMethods.
3. **Developers → Webhooks → Add endpoint:** URL
   `https://tzahajbulieoalzuzclv.supabase.co/functions/v1/stripe-webhook`; *Listen to* **Events on your account**;
   select exactly these ten events (the full list `stripe-webhook` handles):
   `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_method.attached`, `payment_method.detached`, `customer.updated`, `refund.created`, `refund.updated`,
   `refund.failed`, `charge.refund.updated` → **Add endpoint** → **Signing secret → Reveal** → copy `whsec_…`
   (`STRIPE_WEBHOOK_SECRET`). Test and live endpoints have different secrets.
4. **Settings → Payments → Payment methods:** turn on **Cards**, **Apple Pay** and **Google Pay**. Hosted Checkout
   needs no domain file. (Only if card fields are ever embedded on our own pages: **Settings → Payments → Payment
   method domains → Add** `eliteeducation.me` and `eliteeducationuae.github.io`.)
5. **Settings → Billing → Customer portal:** allow customers to update payment methods; business name
   `Elite Education`; privacy and terms links as in 1.3 → **Save**.
6. **Settings → Business → Public details:** statement descriptor `ELITE EDUCATION`, support email and phone.

## 4. Resend (email)

1. [resend.com](https://resend.com) → **Domains → Add domain** → `eliteeducation.me` → region **Ireland
   (eu-west-1)** → **Add**.
2. At the DNS host for `eliteeducation.me`, add the records Resend shows, copying each value exactly:

   | Type | Name (host) | Value | Notes |
   |------|-------------|-------|-------|
   | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | priority 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the bounce domain |
   | TXT | `resend._domainkey` | `p=MIGfMA0…` (the DKIM key Resend shows) | DKIM |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@eliteeducation.me` | add if you have no DMARC yet; tighten to `p=quarantine` after a clean fortnight |

   Do not change the existing MX records of `eliteeducation.me` itself (your mailbox). Then **Verify DNS Records**
   and wait for *Verified*.
3. **API Keys → Create API key** → name `supabase-live`, permission **Sending access**, domain `eliteeducation.me`
   → copy `re_…` (`RESEND_API_KEY`; the same key is the SMTP password in 2.3, or create a second one for SMTP).
4. `EMAIL_FROM` = `Elite Education <hello@eliteeducation.me>` (must be on the verified domain).

## 5. Secrets (Supabase → Edge Functions → Secrets, or the CLI)

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically; never set them.
Generate each random value with `openssl rand -hex 32`.

```bash
npx supabase secrets set APP_URL=https://eliteeducationuae.github.io/app   # or https://eliteeducation.me/app
npx supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… CALENDAR_SYNC_SECRET=<random>
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…
npx supabase secrets set RESEND_API_KEY=re_… EMAIL_FROM="Elite Education <hello@eliteeducation.me>" HEALTH_ALERT_EMAIL=hello@eliteeducation.me
npx supabase secrets set CRON_SECRET=<random>          # then schedule with the x-cron-secret header (README, step 9)
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-…    # optional: AI drafts
npx supabase secrets set TURNSTILE_SECRET_KEY=… TURNSTILE_ALLOWED_HOSTNAMES=eliteeducation.me,www.eliteeducation.me  # optional
# Optional, only for a second app address that must receive the Google result (never localhost on live):
# npx supabase secrets set CALENDAR_RETURN_URLS=https://staging.example
```

| Secret | Read by |
|--------|---------|
| `APP_URL` | create-checkout, billing-portal, google-connect, send-notifications, invite-accountant, health-check |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | google-connect, calendar-sync |
| `CALENDAR_SYNC_SECRET` (`x-sync-secret` header) | calendar-sync (refuses every call without it) |
| `CALENDAR_RETURN_URLS` | google-connect (optional extra return prefixes) |
| `STRIPE_SECRET_KEY` | create-checkout, billing-portal, charge-invoice, refund-payment, stripe-webhook |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook |
| `RESEND_API_KEY`, `EMAIL_FROM` | send-notifications, health-check |
| `HEALTH_ALERT_EMAIL` | health-check (else every admin) |
| `CRON_SECRET` (`x-cron-secret` header) | send-notifications, send-reminders |
| `ANTHROPIC_API_KEY` | ai-assist |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES` | verify-captcha |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_TEMPLATE_*` (six) | send-notifications |

## 6. Deploy, schedule, check

1. `npx supabase functions deploy` (all functions; `config.toml` keeps `stripe-webhook`, `ics`, `google-connect` and
   `verify-captcha` open without a login, each protected by its own signature, token or state).
2. Schedules (SQL in the README): `calendar-sync` every 5 min (`x-sync-secret`), `charge-invoice` every 15 min and
   `health-check` every 15 min (legacy `service_role` key), `backup-export` daily 22:10 UTC, `send-notifications`
   every minute and `send-reminders` hourly (`x-cron-secret`).
3. Checks: sign in with Google; as a tutor, *Connect Google Calendar* returns to the app with "connected" and a
   lesson appears within 5 minutes; pay a test invoice with `4242 4242 4242 4242` and see it marked paid; in
   Stripe → Webhooks the endpoint shows 2xx deliveries; send yourself a notification and check the email arrives
   from `hello@eliteeducation.me` with SPF/DKIM *pass* (Gmail → *Show original*).
4. A leaked calendar feed link: the person (or an admin for them) calls `reset_ics_token`; from the SQL editor,
   `update public.profiles set ics_token = gen_random_uuid() where email = '<their email>';`.
