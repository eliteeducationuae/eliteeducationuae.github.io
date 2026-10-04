# Elite Education — tutoring app

The Elite Education app for iPhone (plus Android and web, from the same code). It runs scheduling, billing and student progress for **admins, tutors, parents and students**. It's built to replace Teachworks.

## Why it's better than Teachworks

| | Teachworks | Elite Education app |
|---|---|---|
| Mobile | Mostly web pages | A native app for every role, with home-screen tabs and dark mode |
| Progress tracking | Free-text notes | Every subject, phase and curriculum: each student has a list of subjects, each with its own topic list (built-in IB, IGCSE and A-Level maths trees, plus shared lists tutors build as they teach), with 1–5 mastery ratings over time, heatmaps and "work on next" |
| Recording a lesson | Several screens | One pass: attendance, topics with suggestions, ratings, family summary, homework and private notes. Billing happens automatically. |
| Parents | Invoices and a portal | Upcoming lessons, lesson notes, child progress, PDF progress reports and invoices paid by card in AED |
| Cancellations | Manual | Your 24-hour policy is applied automatically. Parents see the fee before confirming; tutor cancellations never charge families; admins can waive fees. |
| Packages | Add-on | Prepaid lesson bundles: credits are used automatically, with low-credit alerts on the dashboard |
| Calendar | | Day, week and per-tutor timeline views, drag-to-reschedule, clash detection, holidays that recurring lessons skip, tutor time off with cover suggestions, a live Apple/Google Calendar feed for families, and two-way Google Calendar sync for tutors and the office: lessons appear in Google with a Meet link, and Google busy times are kept out of bookable slots |
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
    functions/        Edge Functions: Stripe checkout + webhook, calendar feed, reminders, notifications, AI drafting,
                      Google Calendar connection (google-connect) and two-way sync (calendar-sync)
    tests/            permission tests run against a throwaway Postgres
```

## Going live

1. **Supabase** (free tier is fine). Create a project at [supabase.com](https://supabase.com).
   - Run `supabase/migrations/20261002000000_init.sql` in the SQL editor, or use `npx supabase db push`.
   - Create your login under Authentication → Users, then run `supabase/bootstrap.sql` (edit the email first).
   - The project URL and publishable key are in `src/config.ts`.
2. **Stripe** (UAE account, for card payments in AED).
   - `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_… APP_URL=https://…`
   - `npx supabase functions deploy create-checkout stripe-webhook charge-invoice billing-portal ics send-reminders send-notifications`
   - In Stripe, add a webhook to `https://<project>.supabase.co/functions/v1/stripe-webhook` for these six events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_method.attached`, `payment_method.detached` and `customer.updated`.
   - Saved cards, autopay, Apple Pay, Google Pay and lesson top-ups need a few more steps: see *Card payments: saved cards, autopay and top-ups* below.
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

**Homework and resources (round 4).** Run `supabase/migrations/20261008000000_homework.sql` in the SQL editor. It adds details and attachments to homework, hand-ins with tutor feedback and marks, the resource library, and the private `classwork` storage bucket with its access rules: families and students may reach only their own child's folder, and library files only once they have been shared with them or attached to their homework. Each file may be up to 25 MB and must be a PDF, a photo or an Office document. Deleting a library resource keeps its stored file while any homework still uses it, and everyone except admins and a resource's uploader reads the library through `list_resources`, which never reveals which other students a resource is shared with. Then run `supabase/migrations/20261012010000_classwork_security.sql`: it stops tutors reading other tutors' resources from the table directly, and refuses to delete a stored file while a hand-in, homework or library resource still refers to it. Notices about new homework, hand-ins, feedback and shared resources are delivered by the existing `send-notifications` function, so no further set-up is required. Please rebuild the iPhone and Android apps with EAS so that the new photo-library and camera permissions (from `expo-image-picker`) are included. In demo mode, attached files are kept by name only and are not uploaded. Library resources use the same subject, curriculum and level pickers as a student's subjects (step 3), and the library opens on the lesson's subject when a tutor attaches a resource to homework. A tutor can set homework for any student they teach, including a student assigned to them for a subject before the first lesson. **Run order:** apply the migrations in timestamp order (`20261007000000_subjects.sql` first, then homework, calendar, payments, WhatsApp, invoice notifications and classwork security).

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

**Round 4, step 3: every subject.** The app now supports every subject, phase and curriculum, not only mathematics.

1. Run `supabase/migrations/20261007000000_subjects.sql` in the Supabase SQL editor, after the earlier migrations. **Run it before merging**, because the web app deploys automatically on merge and its lesson, overview, report and onboarding screens read the new subject tables straight away. (Only the website has a fallback.)
2. Redeploy the Edge Functions whose wording now uses the lesson's subject:
   `npx supabase functions deploy ai-assist`, `npx supabase functions deploy ics --no-verify-jwt` and `npx supabase functions deploy send-reminders`.
3. Then review each tutor's subjects, curricula and phases under *More → Tutors*. The backfill gives every existing tutor the subject Maths, so until you add their other subjects, role matching will show them as not usually teaching, say, Chemistry.

What the migration does:

- **Enrolments.** Each student now has a list of subjects (an *enrolment* per subject, with its curriculum, level, exam board, tutor and topic list). Students gain an optional phase, and their old single curriculum and syllabus are kept only for older versions of the app.
- **Backfill.** Every existing student receives one Maths enrolment that matches their current syllabus and tutor, so nothing is lost and progress history stays in place. Cambridge Additional Maths (0606) students receive Maths at the *Additional* level, so their existing Maths lessons and reports still match it.
- **New children.** When a family that is already with us adds a child, the office is notified with the child's subjects, since the family is told we will confirm a tutor within one working day. For Maths, families may choose their child's course (for example, *IGCSE Maths (Edexcel 4MA1)*). If they leave it blank, the server picks the built-in course when the curriculum, level and exam board fit exactly one, so the tutor's topic tree and the progress heatmap are ready from the first lesson.
- **Shared topic lists.** Topics are stored in shared lists for each subject, curriculum and level. A list one tutor builds is reused for every student who studies the same course, and tutors can add topics for the subjects they teach.
- **Reports per subject.** A report round creates one report per active enrolment, written by that enrolment's tutor, so a student with Chemistry and English receives two reports (and Maths IGCSE and Maths A-Level are reported separately). The family's notice names the subject.
- **Test change (please confirm).** The enquiry acknowledgement email now opens 'Thank you for contacting Elite Education' (formerly 'Thanks…'), so one line of the existing `engagement_test.sql` now checks for a subject beginning 'Thank' rather than 'Thanks'. Every other existing test is unchanged. Please confirm that you are happy with this wording change.
- **Everything else.** Lessons, services, enquiries and roles record a subject (and phase); tutors list their subjects, curricula and phases; tutor applications record phases; insights split revenue by subject.

The website forms send the new subject and phase fields. If the site goes live before the migration is run, the forms fall back automatically and add the subject and phase to the message, so no enquiry is lost.

**Google Calendar and Meet.** Tutors and the office can connect a Google Calendar. Every lesson then appears in that calendar (tutors see their own lessons; the office sees every lesson), online lessons receive a Google Meet link automatically, and the tutor's busy times in Google are kept out of the slots families can request. This reuses the Google Cloud project and OAuth client from the sign-in step above. Set it up once, in this order:

1. **Database.** Run `supabase/migrations/20261009000000_calendar.sql` in the Supabase SQL editor.
2. **Calendar API.** In the [Google Cloud Console](https://console.cloud.google.com), open the same project and enable the **Google Calendar API** under *APIs & Services → Library*.
3. **Consent screen.** Under *APIs & Services → OAuth consent screen → Data access*, add the scopes `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.freebusy`. While the app is in **Testing**, each tutor must be added as a test user, and Google expires their access after 7 days, so they would need to reconnect weekly. Publish the app and complete Google's verification for these scopes to make connections permanent.
4. **Redirect URI.** Open the same OAuth client under *APIs & Services → Credentials* and add the authorised redirect URI `https://<project-ref>.supabase.co/functions/v1/google-connect`.
5. **Secrets.** Copy the client ID and secret from that OAuth client, and create a long random value that only the scheduler knows (`openssl rand -hex 32` produces one):
   ```bash
   npx supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…
   # Required: calendar-sync refuses every call that does not carry this value.
   npx supabase secrets set CALENDAR_SYNC_SECRET=<random value>
   # If not already set: where the app lives, so people return to it after connecting.
   npx supabase secrets set APP_URL=https://eliteeducation.me/app
   # Optional: further comma-separated prefixes that may receive the result, for example a staging site.
   npx supabase secrets set CALENDAR_RETURN_URLS=http://localhost:8081
   ```
6. **Deploy.** `npx supabase functions deploy google-connect calendar-sync`
7. **Schedule** `calendar-sync` every 5 minutes with pg_cron and pg_net (enable both under *Database → Extensions*). In the SQL editor, keep the secret in Vault and send it in the `x-sync-secret` header. The anon key is only there to pass the platform's own login check; on its own it cannot start a sync.
   ```sql
   select vault.create_secret('<the same random value>', 'calendar_sync_secret');
   select cron.schedule('calendar-sync', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/calendar-sync',
       headers := jsonb_build_object(
         'Authorization', 'Bearer <anon key>',
         'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret')
       )
     )
   $$);
   ```
   Only one run works at a time: if a run is still going when the next one starts, the later one stands aside.

How it behaves:

- **Connecting.** Tutors connect from the Google Calendar card under *Me*, and Craig from the same card under *More*. Google asks for permission, then returns them to the app. Upcoming lessons for the next six months appear within a few minutes, and changes, cancellations and reassignments follow on every run.
- **Meet links.** An online lesson without a link receives one from the lesson tutor's own calendar, so the tutor is the Meet's host and can admit the student. The link is saved on the lesson, so families see it in the app as usual. If the tutor has not connected a calendar, no link is created automatically (the office calendar never hosts a Meet, because its owner is not in the lesson); add a link on the lesson as before. When a lesson moves to another tutor, or becomes in person, a link we generated is cleared and, where the new tutor is connected, replaced with one on their calendar. A link someone pasted by hand (for example Zoom) is never changed. If Google is still creating a Meet when the sync runs, the lesson is checked again on the next run rather than a second Meet being requested. Google never emails the families: every change is written with notifications switched off.
- **Busy times.** Every 5 minutes the tutor's busy times for the next 60 days are copied across, and those times disappear from the open slots families can request. Lessons we wrote ourselves are never counted as busy, including the other tutors' lessons in Craig's calendar (he is both the office and a tutor). In the app, busy times show as quiet "Busy" bands on the *Tutors* timeline and as a line in the Day and Week views.
- **If Google is unreachable.** A change waits in the queue until every calendar it belongs in can be reached, so nothing is lost. If Google refuses to renew a calendar's access for any reason (not only when access was withdrawn), that calendar's card asks for it to be reconnected, and lessons for the other calendars carry on without waiting for it. A lesson that still fails after five attempts is reported on that person's Google Calendar card. Reconnecting a calendar also removes any events for lessons cancelled or reassigned while it was disconnected.
- **Families** keep the existing read-only calendar subscription feed; they do not connect Google.
- **Disconnecting** removes upcoming lesson events from that calendar, withdraws our access at Google and deletes the stored tokens and busy times. Meet links that calendar created for upcoming lessons are cleared too, since the Meets belong to its account; links pasted by hand stay. Declining Google's permission screen while already connected changes nothing, and the card says *Your existing connection remains in place.* If Google access is withdrawn from the Google side, the app shows that the calendar needs reconnecting.
- **Privacy.** Only busy start and end times are copied from Google, never event titles, descriptions or attendees. Lesson events contain first names, the service, the tutor and the join link or, for an in-person lesson, the lesson address, never family contact or bank details. **Craig to confirm:** the address of an in-person lesson is written into the tutor's and the office's Google calendars so they can navigate there; if that is not acceptable, it can be left out. Google tokens are stored server-side only; the app can see whether a calendar is connected, but cannot read the tokens.
- **Demo.** Sarah's calendar is connected and has two busy times; Craig's is not, so he has none until he presses *Connect Google Calendar*, which then adds his Meet links and two sample busy times.

**Device checklist (Craig, with real Google accounts):** connect a tutor's calendar and the office calendar, then check that (1) a new online lesson receives a Meet link within five minutes and appears in both calendars without any email being sent; (2) a student signed in with a personal Gmail account can join the Meet straight away, or is admitted by the tutor, for a lesson whose tutor is connected; (3) for a lesson whose tutor has not connected, no Meet is created on the office calendar; (4) reassigning an online lesson to another connected tutor replaces the link with one the new tutor hosts; (5) a personal appointment in a tutor's calendar disappears from the Book screen, while other tutors' lessons in the office calendar do not block Craig's own slots.

**WhatsApp reminders.** Families and tutors who choose to can receive short WhatsApp messages: a lesson reminder the day before, a note when lesson notes are ready, a message when an invoice is sent, a reminder when an invoice is overdue, and a reminder when homework is due. Nothing is ever sent unless the person has switched WhatsApp on and entered their number under *Account*; students cannot opt in. Every WhatsApp message is delivered during the day, UAE time: lesson reminders and lesson-notes messages between 08:00 and 21:00, and invoice, overdue-invoice and homework messages between 09:00 and 20:00, so nobody is messaged at night. Lesson notes recorded after an evening lesson, or an invoice sent late, are held and delivered at the start of the next window. A message still waiting is withdrawn if its invoice is paid or voided, or its lesson is moved or cancelled, in the meantime; a moved lesson is reminded again for its new time. Only the person can switch WhatsApp on or off or change their number (the office cannot do it for them), so the recorded opt-in time stands as their consent to the wording on the card. Overdue reminders quote the balance still owed after any part payments. Messages use only the five approved templates below, and bank details are never sent (the sender refuses any message that looks like an IBAN or account number). Set it up once, in this order:

1. Create a [Twilio](https://www.twilio.com) account and upgrade it from trial.
2. Register the business number as a WhatsApp sender through Twilio's WhatsApp self sign-up (*Messaging → Senders → WhatsApp senders*). This includes verifying Elite Education in Meta Business Manager.
3. In Twilio's *Content Template Builder*, create the six templates below. For each one choose category **Utility**, language **English (UK)**, use the exact name and body shown, and enter the sample values when asked. Submit each for WhatsApp approval; approval usually takes from a few minutes to a day.
4. Once approved, copy each template's Content SID (it starts `HX`).
5. Set the secrets (your own values, never committed to the repository):
   ```bash
   npx supabase secrets set TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… TWILIO_WHATSAPP_FROM=+971… \
     TWILIO_TEMPLATE_LESSON_REMINDER=HX… TWILIO_TEMPLATE_LESSON_NOTES=HX… TWILIO_TEMPLATE_INVOICE_SENT=HX… \
     TWILIO_TEMPLATE_INVOICE_AUTOPAY=HX… TWILIO_TEMPLATE_INVOICE_OVERDUE=HX… TWILIO_TEMPLATE_HOMEWORK_DUE=HX…
   ```
6. Redeploy: `npx supabase functions deploy send-notifications send-reminders`.
7. Test it by opting in on your own phone under *Account*, then sending yourself an invoice or waiting for a lesson reminder.

| Template name | When it is sent | Variables | Body |
| --- | --- | --- | --- |
| `elite_lesson_reminder` | About a day before each lesson | 1 first name, 2 student first names, 3 tutor name (or "you"), 4 day and time, e.g. `Tue 7 Oct, 16:00` | Dear {{1}}, this is a reminder of the lesson for {{2}} with {{3}} on {{4}} (UAE time). Elite Education \| eliteeducation.me |
| `elite_lesson_notes` | When the tutor shares lesson notes | 1 first name, 2 student first names, 3 date, e.g. `7 Oct` | Dear {{1}}, the lesson notes for {{2}} from {{3}} are now ready in the Elite Education app. Elite Education \| eliteeducation.me |
| `elite_invoice_sent` | When an invoice is sent | 1 first name, 2 invoice number, 3 amount, e.g. `AED 1,050.00`, 4 due date, e.g. `15 Oct 2026` | Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app and is due by {{4}}. Elite Education \| eliteeducation.me |
| `elite_invoice_autopay` | When an invoice is sent to a family with autopay on and a saved card | 1 first name, 2 invoice number, 3 amount, 4 saved card, e.g. `Visa ending 4242` | Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app. As autopay is on, it will be paid automatically from your saved {{4}}. Elite Education \| eliteeducation.me |
| `elite_invoice_overdue` | The morning after an invoice passes its due date unpaid | as for `elite_invoice_sent`, but 3 is the balance still owed | Dear {{1}}, invoice {{2}} for {{3}} was due on {{4}} and remains unpaid. You may view and pay it in the Elite Education app. If you have already paid, please disregard this message. Elite Education \| eliteeducation.me |
| `elite_homework_due` | During the day before homework is due | 1 first name, 2 student first name, 3 due date, e.g. `Wed 8 Oct`, 4 homework title | Dear {{1}}, this is a reminder that {{2}} has homework due on {{3}}: {{4}}. Elite Education \| eliteeducation.me |

Sample values for approval: first name `Mona`, student `Omar`, tutor `Ms Sarah Khan`, invoice `INV-0042`, amount `AED 1,050.00`, dates as in the table, homework `Quadratic equations worksheet`, saved card `Visa ending 4242`.

Until Twilio is configured, WhatsApp messages are marked `skipped` and push notifications and email carry on as normal. To check the queue, look at `notification_outbox` in the Supabase table editor: `whatsapp_status` is `pending`, `sent`, `skipped` or `failed`, and the `error` column explains any failure (for example Twilio code 21211 for an invalid number, or 21610 if the person has blocked the number).

**Card payments: saved cards, autopay and top-ups.** Families can keep a card on file, let invoices pay themselves, and buy more lessons in one tap. The card itself stays with Stripe; the app only stores the brand, the last four digits and the expiry date. Set it up once, in this order:

1. **Database.** Run `supabase/migrations/20261010000000_payments.sql` in the Supabase SQL editor.
2. **Secrets.** `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_… APP_URL=https://eliteeducationuae.github.io/app`. `APP_URL` must be the app's public web address (no trailing slash), because Stripe sends parents back there after paying.
3. **Functions.** `npx supabase functions deploy create-checkout stripe-webhook charge-invoice billing-portal`, and make sure the Stripe webhook lists the six events in *Going live* above.
4. **Apple Pay and Google Pay.** In the Stripe Dashboard, go to *Settings → Payments → Payment methods* and switch on **Apple Pay** and **Google Pay**. Stripe-hosted Checkout then shows them automatically on supported phones and browsers; no domain file is needed. Only if card fields are ever embedded in the website itself, register the domain under *Settings → Payments → Payment method domains*.
5. **Customer portal ("Manage cards").** In the Stripe Dashboard, go to *Settings → Billing → Customer portal*. Allow customers to **update payment methods**, set the business name to **Elite Education**, add the privacy policy and terms of service links, and save.
6. **Autopay schedule.** In the Supabase Dashboard, go to *Integrations → Cron* (switch on the Cron and pg_net integrations if asked), create a job that calls the Supabase Edge Function `charge-invoice` with method POST and body `{}`, and run it **every 15 minutes** (`*/15 * * * *`). The schedule authenticates with the service role key (`Authorization: Bearer <service role key>`); never put that key in the app.

How it works for families:

- **Saving a card.** Whenever a parent pays an invoice or buys lessons by card, Stripe keeps the card securely for next time. Their saved card appears in the Billing tab, and *Manage cards* opens Stripe's secure page to add, replace or remove cards.
- **Autopay.** Once a card is saved, the parent can switch on autopay in the Billing tab. From then on, every invoice sent to the family is charged to the saved card within about 15 minutes. If the bank declines, or asks the parent to confirm the payment, the family and the office are each told once, the invoice stays open to pay in the app, and an admin can try again from the invoice. While autopay is waiting to charge an invoice, the family is not offered another way to pay it (they can choose *Pay now instead*, which takes that invoice out of autopay first), so an invoice is never paid twice. Late or repeated failure messages from Stripe are ignored once the invoice is paid, voided or charged again. If Stripe cannot be reached mid-charge, the invoice shows *Confirming payment*: the family is not asked to pay (no Pay button or bank details), only the office is asked to check, and the next run sends the very same request to Stripe again with the same idempotency key, which returns the original result rather than charging twice. It is resent only while the invoice still wants exactly that charge (still sent, autopay still on, nothing paid towards it since, and under 23 hours old); otherwise the app only looks the payment up in Stripe and never charges again. Only an answer about the card (a decline, or the bank asking the parent to confirm) is reported to the family as a failed payment; any other Stripe error keeps the invoice held until Stripe gives an answer. While a charge is under way or unknown, the admin's *Record a payment* and *Void invoice* ask the office to check the Stripe Dashboard first. A charge left *processing* for more than 30 minutes is checked the same way, and an admin can press *Check payment with Stripe* on the invoice at any time. Switching autopay off, or recording a bank transfer, hands invoices waiting for autopay back to the family at once. Removing the last saved card switches autopay off and tells the family once. Admins can open a family's saved cards with *Manage cards* on the family's page.
- **Buying more lessons.** Add lesson packages (name, service, number of lessons, price) in *Services and rates*. Parents tap *Buy more lessons*, pay through Checkout, and the package is added to their account straight away with a paid receipt in the Billing tab. What the parent was shown (name, lessons, price and VAT) travels with the payment, so hiding, repricing or deleting a package while someone is paying never changes or loses their purchase.
- Notifications about card payments never include bank details, full card numbers or Stripe references. No notification, email or WhatsApp message includes bank details at all: families who prefer a bank transfer find them on the invoice in the app.
- **New invoices with autopay.** A family with autopay on and a saved card is told, by email, push and WhatsApp, that the invoice will be paid automatically from their saved card (for example *Visa ending 4242*), with no request to pay. An overdue WhatsApp chase is not sent while autopay is still charging an invoice; it goes out as usual once a charge has failed or autopay is switched off.

**Testing (Stripe test mode).** Use test keys (`sk_test_…`) and a test webhook secret. Pay an invoice with card `4242 4242 4242 4242` (any future expiry, any CVC): the invoice is marked paid and the card appears in the Billing tab. Then, with *Manage cards*, add card `4000 0000 0000 0341`, make it the default and switch on autopay: this card attaches successfully but fails when charged later, so the next invoice shows *Autopay failed* and the family receives the "We could not take payment" message.

**Before families can book lessons,** each tutor sets their weekly hours under *Me → Availability & time off* (or you can do it from *More → Tutors*).

## Round 4 setup checklist

Complete these once, in this order. The function names come from the round 4 plan; each feature's section above carries the detail.

1. **Database.** Run every migration newer than `20261006000000_social_sign_in.sql` in filename order in the Supabase SQL editor, or run `npx supabase db push`.
2. **Google.** Reuse the OAuth client from *Sign in with Apple and Google*. In the Google Cloud Console, enable the **Google Calendar API**, add the `calendar.events` and `calendar.freebusy` scopes to the OAuth consent screen, and add `https://<project-ref>.supabase.co/functions/v1/google-connect` as an authorised redirect URI. Then `npx supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…`.
3. **Apple.** Follow the Apple steps under *Sign in with Apple and Google*.
4. **Stripe.** In the Stripe dashboard, enable **Apple Pay** and **Google Pay** under *Settings → Payment methods*, verify the domain `eliteeducation.me`, switch on and configure the **Customer billing portal**, and add `payment_intent.succeeded` and `payment_intent.payment_failed` to the webhook's events.
5. **Twilio.** Follow *WhatsApp reminders* above.
6. **Deploy and schedule.** Run `npx supabase functions deploy google-connect calendar-sync create-checkout stripe-webhook charge-invoice billing-portal send-notifications send-reminders`. Schedule `calendar-sync` every 5 minutes, `charge-invoice` every 15 minutes, `send-notifications` every minute and `send-reminders` hourly.
7. **Check on a real device.** Light and dark mode, Sign in with Apple and Google, and a WhatsApp opt-in on your own number.

## Checks

```bash
npm run check      # lint + typecheck + unit tests
npm run test:db    # schema, row-level security and billing functions against a local Postgres
```

## Roadmap ideas

- AI worksheets on each student's weak topics
- Microsoft Outlook calendar sync, alongside the Google Calendar sync
- Online booking of trial lessons from eliteeducation.me
- Bank-feed import for expenses
