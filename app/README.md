# Elite Education — tutoring app

The Elite Education app for iPhone (plus Android and web, from the same code). It runs scheduling, billing and student progress for **admins, tutors, parents and students**. It's built to replace Teachworks.

## Why it's better than Teachworks

| | Teachworks | Elite Education app |
|---|---|---|
| Mobile | Mostly web pages | A native app for every role, with home-screen tabs and dark mode |
| Progress tracking | Free-text notes | Curriculum-aware: IB AA/AI, IGCSE 4MA1/0580/0606 and A-Level syllabus topic trees, with 1–5 mastery ratings over time, heatmaps and "work on next" |
| Recording a lesson | Several screens | One pass: attendance, topics with suggestions, ratings, family summary, homework and private notes. Billing happens automatically. |
| Parents | Invoices and a portal | Upcoming lessons, lesson notes, child progress, PDF progress reports and invoices paid by card in AED |
| Cancellations | Manual | Your 24-hour policy is applied automatically. Parents see the fee before confirming; tutor cancellations never charge families; admins can waive fees. |
| Packages | Add-on | Prepaid lesson bundles: credits are used automatically, with low-credit alerts on the dashboard |
| Calendar | | Day, week and per-tutor timeline views, drag-to-reschedule, clash detection, holidays that recurring lessons skip, tutor time off with cover suggestions, and a live Apple/Google Calendar feed |
| Sign-up | Admin creates every account | Parents sign up themselves (6-digit email code), add their children and request a free consultation; existing families and tutors are linked automatically by email |
| Enquiries | Separate CRM | Built-in pipeline (new → contacted → trial booked → enrolled / lost) fed by the website form, the app and logged phone calls |
| Booking | Admin books everything | Parents pick a real open slot from the tutor's availability to request an extra lesson or a move; one-tap approval creates or moves the lesson |
| Messaging | Email only | A conversation per family with you and their tutors, announcements, and automatic emails + push for notes, invoices, messages and booking decisions |
| New students for tutors | Phone calls and WhatsApp | Post a role (prefilled from an enquiry); your tutors pitch for it; you pick one and schedule in one tap |
| Hiring | Google Forms | "Teach with us" form on the website and in the app, with CV upload, feeding a hiring pipeline. **Hire** creates the tutor. |
| Tutor pay | Tutors email invoices | Tutors submit a monthly invoice built from the lessons they taught. You approve it, pay it and record the reference. Bank details are collected in the app and kept private. |
| Reports | Written from scratch | Report rounds with a facts panel for each student, one-tap grades and **Draft for me** (AI). You review it and send it to families as a PDF. |
| Money | Spreadsheets | Profit and loss by month, expenses with receipts, the pay run and CSV exports for your accountant |
| Insights | Basic reports | Revenue trends, tutor capacity, family activity, enquiry conversion, students to check on and an AI summary |
| Desktop | | A sidebar layout on laptops, global search (Ctrl/⌘-K) and the web app at `/app` |

## Run it

```bash
cd app
npm install
npx expo start         # scan the QR code with Expo Go on your iPhone, or press w for web
```

The app connects to the live Supabase project (settings in `src/config.ts`). To explore with realistic sample data instead, start it with `EXPO_PUBLIC_DEMO=1 npx expo start` and pick a role on the sign-in screen.

Demo data is stored on the device. Use **Account → Reset demo data** to start again.

## Project layout

```
app/
  src/app/            screens (Expo Router): admin/, tutor/, parent/, student/, lesson/, invoice/, manage/…
  src/components/     UI kit, calendar, progress heatmap, billing cards
  src/domain/         pure business rules + unit tests (scheduling, billing, progress, calendar feed)
  src/data/           DataSource interface, Supabase implementation, offline demo implementation, syllabus data
  supabase/
    migrations/       database schema, row-level security, server functions (complete/cancel lesson, invoicing)
    functions/        Edge Functions: Stripe checkout + webhook, calendar feed, reminders, notifications, AI drafting
    tests/            permission tests run against a throwaway Postgres
```

## Going live

1. **Supabase** (free tier is fine). Create a project at [supabase.com](https://supabase.com).
   - Run `supabase/migrations/20261002000000_init.sql` in the SQL editor, or use `npx supabase db push`.
   - Create your login under Authentication → Users, then run `supabase/bootstrap.sql` (edit the email first).
   - The project URL and publishable key are in `src/config.ts`.
2. **Stripe** (UAE account, for card payments in AED).
   - `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_… APP_URL=https://…`
   - `npx supabase functions deploy create-checkout stripe-webhook ics send-reminders send-notifications`
   - In Stripe, add a webhook to `https://<project>.supabase.co/functions/v1/stripe-webhook` for `checkout.session.completed`.
   - Schedule `send-reminders` to run hourly (Supabase → Edge Functions → Schedules).
3. **App Store.** This needs an Apple Developer account ($99/yr). No Mac is required.
   ```bash
   npx eas-cli@latest init            # links the project and enables push notifications
   npx eas-cli@latest build -p ios    # cloud build
   npx eas-cli@latest submit -p ios   # sends it to TestFlight / App Store Connect
   ```

Secrets never go in the app or this repo. The anon key is safe to ship because row-level security decides what each person can see.

## Turning on the newer features

Run these once in the Supabase SQL editor, in order, if you haven't already:
`supabase/migrations/20261003000000_auto_link_logins.sql`, then `supabase/migrations/20261004000000_engagement.sql`.

**Sign-up codes.** In Supabase → Authentication → Emails → *Confirm signup*, add the code to the email so parents can type it into the app:

```html
<h2>Welcome to Elite Education</h2>
<p>Your code is <strong style="font-size:22px;letter-spacing:4px">{{ .Token }}</strong></p>
<p>Or <a href="{{ .ConfirmationURL }}">confirm your email here</a>.</p>
```

**Emails and push notifications.** Messages, lesson notes, invoices, enquiries and booking decisions are queued in the database and delivered by the `send-notifications` Edge Function:

1. Create a free [Resend](https://resend.com) account and verify the `eliteeducation.me` domain.
2. `npx supabase secrets set RESEND_API_KEY=re_… EMAIL_FROM="Elite Education <hello@eliteeducation.me>" APP_URL=https://eliteeducation.me`
3. `npx supabase functions deploy send-notifications`, then schedule it every minute (Supabase → Edge Functions → Schedules).

Until this is set up, everything still works in the app; the emails simply wait in the queue.

**Website enquiries.** The "Book a free consultation" form on eliteeducation.me posts straight into the enquiry pipeline.

**Roles, hiring, tutor invoices, reports and money (round 3).** Run `supabase/migrations/20261005000000_operations.sql` in the SQL editor. It also creates the private `applications` (CVs) and `receipts` storage buckets with their access rules.

**AI drafting (optional).** Report drafts, parent updates and the insights summary use Claude through the `ai-assist` Edge Function. Without it, tutors still get a template draft.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-…`
3. `npx supabase functions deploy ai-assist`

The function reads data as the signed-in person, so the AI only sees what that person can already see. It uses server-side fallbacks: if the main model declines a request, the API retries it on a recommended fallback model. Bank details are never sent.

**Web app at `/app`.** `.github/workflows/deploy.yml` publishes the website and the web app on every push to `main`. One-off setup: in GitHub, go to repo **Settings → Pages → Source** and choose **GitHub Actions**. Then:

- Set `APP_URL` to `https://eliteeducation.me/app` so email links open the web app.
- Add `https://eliteeducation.me/app/**` under Supabase → Authentication → URL configuration → Redirect URLs.

**Sign in with Apple and Google.** Families and tutors can choose "Continue with Apple" or "Continue with Google" instead of a password. Set it up once, in this order:

1. **Database.** Run `supabase/migrations/20261006000000_social_sign_in.sql` in the Supabase SQL editor.
2. **Redirect URLs.** In Supabase → Authentication → URL configuration → Redirect URLs, add all four of these:
   - `https://eliteeducation.me/app/`
   - `https://eliteeducation.me/app/**`
   - `eliteeducation://auth-callback`
   - `http://localhost:8081/**`
3. **Google.**
   1. In the [Google Cloud Console](https://console.cloud.google.com), create a project (for example "Elite Education").
   2. Under *APIs & Services → OAuth consent screen*, set the app name to **Elite Education**, add your support email, and add the authorised domain **eliteeducation.me**. Publish the app when you are ready for families to use it.
   3. Under *APIs & Services → Credentials*, choose *Create credentials → OAuth client ID*, type **Web application**. Under *Authorised redirect URIs*, add `https://<project-ref>.supabase.co/auth/v1/callback` (your project reference is in the Supabase URL).
   4. Copy the client ID and client secret into Supabase → Authentication → Providers → Google, and switch Google on.
   5. Keep this Google project: the Google Calendar step will reuse the same OAuth client later.
4. **Apple.** In [Apple Developer](https://developer.apple.com/account) → *Certificates, Identifiers & Profiles*:
   1. Under *Identifiers*, open the App ID `me.eliteeducation.app` and enable **Sign in with Apple**.
   2. Create a **Services ID** (for example `me.eliteeducation.signin`). Enable Sign in with Apple on it, with the domain `eliteeducation.me` and the return URL `https://<project-ref>.supabase.co/auth/v1/callback`.
   3. Under *Keys*, create a key with **Sign in with Apple** enabled and download the `.p8` file. Note the Key ID and your Team ID.
   4. In Supabase → Authentication → Providers → Apple, switch Apple on. Set the Client IDs to `me.eliteeducation.signin,me.eliteeducation.app`, and paste the secret generated from the `.p8` key (Supabase links to a generator on that page).
   5. The Apple secret expires every six months. Put a reminder in your calendar to generate a new one and paste it in again, or Apple sign-in on the web and Android will stop working.
5. **Rebuild the iPhone app** with EAS (`npx eas build --platform ios`). The new `usesAppleSignIn` setting adds the Sign in with Apple entitlement, so an older build will not show the native Apple sheet.

How it behaves:

- **Unknown emails** become new prospect families, exactly as if the parent had signed up with a password. They appear in *More → Families*.
- **Known emails link automatically.** If the Apple or Google email matches a tutor or a family already on file, that person signs straight into their own account.
- **Apple "Hide My Email".** If a parent chooses to hide their email, Apple gives a relay address ending `@privaterelay.appleid.com`, which will not match the family's email on file, so they arrive as a new prospect family. Either ask the parent to sign in again and choose **Share My Email**, or open the family in *More → Families* and change its email to the relay address. That moves the login to the correct family and archives the empty prospect family.
- **Email first, Apple or Google later.** A login is linked to its family when its email is confirmed. If someone confirmed a password account long ago and only later links Apple or Google to it, they are not re-linked automatically; the sign-in screen shows a banner asking them to contact us.
- **Parents without a name.** If Apple shares no name, onboarding asks the parent for it once. Parents who already have a name never see that field.
- **Demo mode:** both buttons sign in as the sample parent, Fatima Al Mansoori.

**Device checklist (Craig, on a real iPhone):** sign in with Apple in both light and dark mode, and check that the busy spinner shown over the Apple button while signing in matches the button (black on light, white on dark) and is clearly visible.

**WhatsApp reminders.** Families and tutors who choose to can receive short WhatsApp messages: a lesson reminder the day before, a note when lesson notes are ready, a message when an invoice is sent, a reminder when an invoice is overdue, and a reminder when homework is due. Nothing is ever sent unless the person has switched WhatsApp on and entered their number under *Account*; students cannot opt in. Every WhatsApp message is delivered during the day, UAE time: lesson reminders and lesson-notes messages between 08:00 and 21:00, and invoice, overdue-invoice and homework messages between 09:00 and 20:00, so nobody is messaged at night. Lesson notes recorded after an evening lesson, or an invoice sent late, are held and delivered at the start of the next window. Overdue reminders quote the balance still owed after any part payments. Messages use only the five approved templates below, and bank details are never sent (the sender refuses any message that looks like an IBAN or account number). Set it up once, in this order:

1. Create a [Twilio](https://www.twilio.com) account and upgrade it from trial.
2. Register the business number as a WhatsApp sender through Twilio's WhatsApp self sign-up (*Messaging → Senders → WhatsApp senders*). This includes verifying Elite Education in Meta Business Manager.
3. In Twilio's *Content Template Builder*, create the five templates below. For each one choose category **Utility**, language **English (UK)**, use the exact name and body shown, and enter the sample values when asked. Submit each for WhatsApp approval; approval usually takes from a few minutes to a day.
4. Once approved, copy each template's Content SID (it starts `HX`).
5. Set the secrets (your own values, never committed to the repository):
   ```bash
   npx supabase secrets set TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… TWILIO_WHATSAPP_FROM=+971… \
     TWILIO_TEMPLATE_LESSON_REMINDER=HX… TWILIO_TEMPLATE_LESSON_NOTES=HX… TWILIO_TEMPLATE_INVOICE_SENT=HX… \
     TWILIO_TEMPLATE_INVOICE_OVERDUE=HX… TWILIO_TEMPLATE_HOMEWORK_DUE=HX…
   ```
6. Redeploy: `npx supabase functions deploy send-notifications send-reminders`.
7. Test it by opting in on your own phone under *Account*, then sending yourself an invoice or waiting for a lesson reminder.

| Template name | When it is sent | Variables | Body |
| --- | --- | --- | --- |
| `elite_lesson_reminder` | About a day before each lesson | 1 first name, 2 student first names, 3 tutor name (or "you"), 4 day and time, e.g. `Tue 7 Oct, 16:00` | Dear {{1}}, this is a reminder that {{2}} has a lesson with {{3}} on {{4}} (UAE time). Elite Education \| eliteeducation.me |
| `elite_lesson_notes` | When the tutor shares lesson notes | 1 first name, 2 student first names, 3 date, e.g. `7 Oct` | Dear {{1}}, the lesson notes for {{2}} from {{3}} are now ready in the Elite Education app. Elite Education \| eliteeducation.me |
| `elite_invoice_sent` | When an invoice is sent | 1 first name, 2 invoice number, 3 amount, e.g. `AED 1,050.00`, 4 due date, e.g. `15 Oct 2026` | Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app and is due by {{4}}. Elite Education \| eliteeducation.me |
| `elite_invoice_overdue` | The morning after an invoice passes its due date unpaid | as for `elite_invoice_sent`, but 3 is the balance still owed | Dear {{1}}, invoice {{2}} for {{3}} was due on {{4}} and remains unpaid. You may view and pay it in the Elite Education app. If you have already paid, please disregard this message. Elite Education \| eliteeducation.me |
| `elite_homework_due` | During the day before homework is due | 1 first name, 2 student first name, 3 due date, e.g. `Wed 8 Oct`, 4 homework title | Dear {{1}}, this is a reminder that {{2}} has homework due on {{3}}: {{4}}. Elite Education \| eliteeducation.me |

Sample values for approval: first name `Mona`, student `Omar`, tutor `Ms Sarah Khan`, invoice `INV-0042`, amount `AED 1,050.00`, dates as in the table, homework `Quadratic equations worksheet`.

Until Twilio is configured, WhatsApp messages are marked `skipped` and push notifications and email carry on as normal. To check the queue, look at `notification_outbox` in the Supabase table editor: `whatsapp_status` is `pending`, `sent`, `skipped` or `failed`, and the `error` column explains any failure (for example Twilio code 21211 for an invalid number, or 21610 if the person has blocked the number).

**Before families can book lessons,** each tutor sets their weekly hours under *Me → Availability & time off* (or you can do it from *More → Tutors*).

## Round 4 setup checklist

Complete these once, in this order. The function names come from the round 4 plan; each feature's section above carries the detail.

1. **Database.** Run every migration newer than `20261006000000_social_sign_in.sql` in filename order in the Supabase SQL editor, or run `npx supabase db push`.
2. **Google.** Reuse the OAuth client from *Sign in with Apple and Google*. In the Google Cloud Console, enable the **Google Calendar API**, add the `calendar.events` and `calendar.freebusy` scopes to the OAuth consent screen, and add `https://<project-ref>.supabase.co/functions/v1/google-connect` as an authorised redirect URI. Then `npx supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…`.
3. **Apple.** Follow the Apple steps under *Sign in with Apple and Google*.
4. **Stripe.** In the Stripe dashboard, enable **Apple Pay** and **Google Pay** under *Settings → Payment methods*, verify the domain `eliteeducation.me`, switch on and configure the **Customer billing portal**, and add `payment_intent.succeeded` and `payment_intent.payment_failed` to the webhook's events.
5. **Twilio.** Follow *WhatsApp reminders* above.
6. **Deploy and schedule.** Run `npx supabase functions deploy google-connect calendar-sync charge-invoice billing-portal send-notifications send-reminders`. Schedule `calendar-sync` every 5 minutes, `send-notifications` every minute and `send-reminders` hourly.
7. **Check on a real device.** Light and dark mode, Sign in with Apple and Google, and a WhatsApp opt-in on your own number.

## Checks

```bash
npm run check      # lint + typecheck + unit tests
npm run test:db    # schema, row-level security and billing functions against a local Postgres
```

## Roadmap ideas

- AI worksheets on each student's weak topics
- Online booking of trial lessons from eliteeducation.me
- Bank-feed import for expenses
