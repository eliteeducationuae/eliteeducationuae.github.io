# Elite Education — tutoring app

The Elite Education app for iPhone (plus Android and web, from the same code). It runs scheduling, billing and student progress for **admins, tutors, parents and students**. It's built to replace Teachworks.

**Launching on the App Store and Google Play:** follow the numbered checklist in [LAUNCH.md](LAUNCH.md).

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
   - Run `supabase/migrations/20261002000000_init.sql` in the SQL editor, or use `npx supabase db push` (only on a brand-new project; for the existing project, use the SQL editor, as the *Round 4 setup checklist* explains).
   - Create your login under Authentication → Users, then run `supabase/bootstrap.sql` (edit the email first).
   - The project URL and publishable key are in `src/config.ts`.
2. **Stripe** (UAE account, for card payments in AED).
   - `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_… APP_URL=https://eliteeducation.me/app`
   - `npx supabase functions deploy create-checkout stripe-webhook charge-invoice billing-portal ics send-reminders send-notifications`
   - In Stripe, add a webhook to `https://<project>.supabase.co/functions/v1/stripe-webhook` for these six events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_method.attached`, `payment_method.detached` and `customer.updated`.
   - Saved cards, autopay, Apple Pay, Google Pay and lesson top-ups need a few more steps: see *Card payments: saved cards, autopay and top-ups* below.
   - Schedule `send-reminders` to run hourly (Supabase → Integrations → Cron, or the pg_cron SQL in step 9 of the *Round 4 setup checklist*).
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
2. `npx supabase secrets set RESEND_API_KEY=re_… EMAIL_FROM="Elite Education <hello@eliteeducation.me>" APP_URL=https://eliteeducation.me/app` (the same `APP_URL` as everywhere else in this guide; see *Web app at `/app`*)
3. `npx supabase functions deploy send-notifications`, then schedule it every minute (Supabase → Integrations → Cron, or the pg_cron SQL in step 9 of the *Round 4 setup checklist*).

Until this is set up, everything still works in the app; the emails simply wait in the queue.

**Website enquiries.** The "Book a free consultation" form on eliteeducation.me posts straight into the enquiry pipeline.

**Roles, hiring, tutor invoices, reports and money (round 3).** Run `supabase/migrations/20261005000000_operations.sql` in the SQL editor. It also creates the private `applications` (CVs) and `receipts` storage buckets with their access rules.

**Homework and resources (round 4).** Homework gains details and attachments, hand-ins with tutor feedback and marks, and a shared resource library. Set it up once:

1. **Database.** In the Supabase SQL editor, run `supabase/migrations/20261008000000_homework.sql`, then `20261012010000_classwork_security.sql`, then `20261013000000_review_fixes.sql` and `20261014000000_round4_qa_fixes.sql`, keeping to timestamp order with the other round 4 files (see the *Round 4 setup checklist*). The first creates the private `classwork` storage bucket with its access rules; the last makes sure that bucket is private and limited even if one was created by hand earlier.
2. **Rebuild the iPhone and Android apps with EAS**, so that the new photo-library and camera permissions (from `expo-image-picker`) are included.

Notices about new homework, hand-ins, feedback and shared resources are delivered by the existing `send-notifications` function, so nothing else is needed.

How it behaves:

- **Who can see files.** Families and students may reach only their own child's folder, and library files only once they have been shared with them or attached to their homework. Each file may be up to 25 MB and must be a PDF, a photo or an Office document.
- **Who can set homework.** A tutor can set homework for any student they teach, including a student assigned to them for a subject before the first lesson. Homework set from a lesson must belong to that lesson and its tutor.
- **Hand-ins.** A hand-in may attach only files from the student's own folder.
- **The library.** Resources use the same subject, curriculum and level pickers as a student's subjects (step 3), and the library opens on the lesson's subject when a tutor attaches a resource to homework. Everyone except admins and a resource's uploader reads the library through `list_resources`, which never reveals which other students a resource is shared with. Tutors cannot read other tutors' private resources.
- **Deleting.** Deleting a library resource keeps its stored file while any homework still uses it, and a stored file cannot be deleted while a hand-in, homework or library resource still refers to it.
- **Demo mode.** Attached files are kept by name only and are not uploaded.

**AI drafting (optional).** Report drafts, parent updates and the insights summary use Claude through the `ai-assist` Edge Function. Without it, tutors still get a template draft.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-…`
3. `npx supabase functions deploy ai-assist`

The function reads data as the signed-in person, so the AI only sees what that person can already see. It uses server-side fallbacks: if the main model declines a request, the API retries it on a recommended fallback model. Bank details are never sent.

**Web app at `/app`.** `.github/workflows/deploy.yml` publishes the website and the web app on every push to `main`. One-off setup: in GitHub, go to repo **Settings → Pages → Source** and choose **GitHub Actions**. Then:

- Set `APP_URL` to `https://eliteeducation.me/app` so email links open the web app. `APP_URL` is one value shared by email links, Stripe returns and Google Calendar returns; set it once, to the app's public web address with no trailing slash: `https://eliteeducation.me/app`. (If the `eliteeducation.me` domain is ever not connected to GitHub Pages under *Settings → Pages → Custom domain*, use `https://eliteeducationuae.github.io/app` in every place instead.)
- Add `https://eliteeducation.me/app/**` under Supabase → Authentication → URL configuration → Redirect URLs. If the app is also reached at `https://eliteeducationuae.github.io/app`, add `https://eliteeducationuae.github.io/app/` and `https://eliteeducationuae.github.io/app/**` as well.

**Sign in with Apple and Google.** Families and tutors can choose "Continue with Apple" or "Continue with Google" instead of a password. Set it up once, in this order:

1. **Database.** Run `supabase/migrations/20261006000000_social_sign_in.sql` in the Supabase SQL editor.
2. **Redirect URLs.** In Supabase → Authentication → URL configuration → Redirect URLs, add all four of these:
   - `https://eliteeducation.me/app/`
   - `https://eliteeducation.me/app/**`
   - `eliteeducation://auth-callback`
   - `http://localhost:8081/**`

   If the app is also reached at `https://eliteeducationuae.github.io/app`, add `https://eliteeducationuae.github.io/app/` and `https://eliteeducationuae.github.io/app/**` too, so that sign-in never falls back to the Site URL.
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
   # If not already set: where the app lives, so people return to it after connecting (one value for the whole project).
   npx supabase secrets set APP_URL=https://eliteeducation.me/app
   # Optional: further comma-separated prefixes that may receive the result, for example a staging site.
   npx supabase secrets set CALENDAR_RETURN_URLS=http://localhost:8081
   ```
6. **Deploy.** `npx supabase functions deploy google-connect calendar-sync`
7. **Schedule** `calendar-sync` every 5 minutes with pg_cron and pg_net (enable both under *Database → Extensions*). In the SQL editor, keep the secret in Vault and send it in the `x-sync-secret` header. The anon key is only there to pass the platform's own login check; on its own it cannot start a sync. Use the **legacy anon key** (a long `eyJ…` token from *Project Settings → API Keys → Legacy API keys*), not the `sb_publishable_…` key in `src/config.ts`: the function gateway does not accept an `sb_publishable_` key, so every scheduled run would be refused.
   ```sql
   select vault.create_secret('<the same random value>', 'calendar_sync_secret');
   select cron.schedule('calendar-sync', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/calendar-sync',
       headers := jsonb_build_object(
         'Authorization', 'Bearer <legacy anon key, eyJ… (Project Settings → API Keys → Legacy API keys)>',
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

**WhatsApp reminders.** Families and tutors who choose to can receive short WhatsApp messages: a lesson reminder the day before, a note when lesson notes are ready, a message when an invoice is sent, a reminder when an invoice is overdue, and a reminder when homework is due. Nothing is ever sent unless the person has switched WhatsApp on and entered their number under *Account*; students cannot opt in. Every WhatsApp message is delivered during the day, UAE time: lesson reminders and lesson-notes messages between 08:00 and 21:00, and invoice, overdue-invoice and homework messages between 09:00 and 20:00, so nobody is messaged at night. Lesson notes recorded after an evening lesson, or an invoice sent late, are held and delivered at the start of the next window. A message still waiting is withdrawn if its invoice is paid or voided, or its lesson is moved or cancelled, in the meantime; a moved lesson is reminded again for its new time. Only the person can switch WhatsApp on or off or change their number (the office cannot do it for them), so the recorded opt-in time stands as their consent to the wording on the card. Overdue reminders quote the balance still owed after any part payments. Messages use only the six approved templates below, and bank details are never sent (the sender refuses any message that looks like an IBAN or account number). Set it up once, in this order:

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
2. **Secrets.** `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_… APP_URL=https://eliteeducation.me/app`. `APP_URL` must be the app's public web address (no trailing slash), because Stripe sends parents back there after paying. It is the same single value used for email links and Google Calendar; if it is already set, leave it.
3. **Functions.** `npx supabase functions deploy create-checkout stripe-webhook charge-invoice billing-portal`, and make sure the Stripe webhook lists the six events in *Going live* above.
4. **Apple Pay and Google Pay.** In the Stripe Dashboard, go to *Settings → Payments → Payment methods* and switch on **Apple Pay** and **Google Pay**. Stripe-hosted Checkout then shows them automatically on supported phones and browsers; no domain file is needed. Only if card fields are ever embedded in the website itself, register the domain under *Settings → Payments → Payment method domains*.
5. **Customer portal ("Manage cards").** In the Stripe Dashboard, go to *Settings → Billing → Customer portal*. Allow customers to **update payment methods**, set the business name to **Elite Education**, add the privacy policy and terms of service links, and save.
6. **Autopay schedule.** Schedule `charge-invoice` every 15 minutes with pg_cron and pg_net (enable both under *Database → Extensions*), keeping the key in Vault as for `calendar-sync`. The function only accepts the **legacy `service_role` key** (a long `eyJ…` token from *Project Settings → API Keys → Legacy API keys*); a newer `sb_secret_…` key will not match, and every run would be refused. Never put this key in the app or the repository.
   ```sql
   select vault.create_secret('<legacy service_role key, eyJ…>', 'service_role_key');
   select cron.schedule('charge-invoice', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/charge-invoice',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
       ),
       body := '{}'::jsonb
     )
   $$);
   ```

How it works for families:

- **Saving a card.** Whenever a parent pays an invoice or buys lessons by card, Stripe keeps the card securely for next time. Their saved card appears in the Billing tab, and *Manage cards* opens Stripe's secure page to add, replace or remove cards.
- **Autopay.** Once a card is saved, the parent can switch on autopay in the Billing tab. From then on, every invoice sent to the family is charged to the saved card within about 15 minutes. If the bank declines, or asks the parent to confirm the payment, the family and the office are each told once, the invoice stays open to pay in the app, and an admin can try again from the invoice. While autopay is waiting to charge an invoice, the family is not offered another way to pay it (they can choose *Pay now instead*, which takes that invoice out of autopay first), so an invoice is never paid twice. Late or repeated failure messages from Stripe are ignored once the invoice is paid, voided or charged again. If Stripe cannot be reached mid-charge, the invoice shows *Confirming payment*: the family is not asked to pay (no Pay button or bank details), only the office is asked to check, and the next run sends the very same request to Stripe again with the same idempotency key, which returns the original result rather than charging twice. It is resent only while the invoice still wants exactly that charge (still sent, autopay still on, nothing paid towards it since, and under 23 hours old); otherwise the app only looks the payment up in Stripe and never charges again. Only an answer about the card (a decline, or the bank asking the parent to confirm) is reported to the family as a failed payment; any other Stripe error keeps the invoice held until Stripe gives an answer. While a charge is under way or unknown, the admin's *Record a payment* and *Void invoice* ask the office to check the Stripe Dashboard first. A charge left *processing* for more than 30 minutes is checked the same way, and an admin can press *Check payment with Stripe* on the invoice at any time. Switching autopay off, or recording a bank transfer, hands invoices waiting for autopay back to the family at once. Removing the last saved card switches autopay off and tells the family once. Admins can open a family's saved cards with *Manage cards* on the family's page.
- **Buying more lessons.** Add lesson packages (name, service, number of lessons, price) in *Services and rates*. Parents tap *Buy more lessons*, pay through Checkout, and the package is added to their account straight away with a paid receipt in the Billing tab. What the parent was shown (name, lessons, price and VAT) travels with the payment, so hiding, repricing or deleting a package while someone is paying never changes or loses their purchase.
- Notifications about card payments never include bank details, full card numbers or Stripe references. No notification, email or WhatsApp message includes bank details at all: families who prefer a bank transfer find them on the invoice in the app.
- **New invoices with autopay.** A family with autopay on and a saved card is told, by email, push and WhatsApp, that the invoice will be paid automatically from their saved card (for example *Visa ending 4242*), with no request to pay. An overdue WhatsApp chase is not sent while autopay is still charging an invoice; it goes out as usual once a charge has failed or autopay is switched off.

**Testing (Stripe test mode).** Use test keys (`sk_test_…`) and a test webhook secret. Pay an invoice with card `4242 4242 4242 4242` (any future expiry, any CVC): the invoice is marked paid and the card appears in the Billing tab. Then, with *Manage cards*, add card `4000 0000 0000 0341`, make it the default and switch on autopay: this card attaches successfully but fails when charged later, so the next invoice shows *Autopay failed* and the family receives the "We could not take payment" message.

**Before families can book lessons,** each tutor sets their weekly hours under *Me → Availability & time off* (or you can do it from *More → Tutors*).

**Spam and abuse protection (round 5).** The two public forms on eliteeducation.me (*Request a consultation* and *Apply to tutor with us*) and the app's own enquiry and application forms are protected against automated and repeated submissions, without ever turning a genuine family away. Set it up once, in this order:

1. **Database.** Run `supabase/migrations/20261109000000_spam.sql` in the Supabase SQL editor, after the earlier migrations. If the website goes live first, the forms fall back automatically to the older form of each request, so no enquiry or application is lost in the meantime.
2. **Optional security check (Cloudflare Turnstile).** The protections below work without it; turn it on only if spam still gets through.
   1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **Turnstile → Add widget**. Name it *Elite Education website*, add the hostnames `eliteeducation.me`, `www.eliteeducation.me` and, if the site is also reached there, `eliteeducationuae.github.io`, and choose the **Managed** mode.
   2. Copy the **site key** into `data-turnstile-sitekey=""` on the `<html>` line at the top of `index.html` (the comment above it marks the place), and publish the website. The site key is public; the **secret key** must never go into the website or the repository.
   3. Store the secret key in Supabase and deploy the checking function. It is called by visitors who are not signed in, so it is deployed without the login check:
      ```bash
      npx supabase secrets set TURNSTILE_SECRET_KEY=…
      # Optional: accept passes only from these hostnames.
      npx supabase secrets set TURNSTILE_ALLOWED_HOSTNAMES=eliteeducation.me,www.eliteeducation.me
      npx supabase functions deploy verify-captcha --no-verify-jwt
      ```
   4. In the app, open **Settings** and switch on **Security check on website forms**. From then on, any submission from someone who is not signed in and has no valid check is still received, but is kept under *Possible spam* for you to review rather than being announced to the team. Leave the setting off until steps 1 to 3 are complete.

   The check is required of everyone who is not signed in, whatever the request says about where it came from, because a program posting directly to the database could otherwise simply claim to be the app. Signed-in families, tutors and the office are never asked. The check appears only on the website: the app's own public forms (*Book a consultation* and *Teach with us* used without an account) do not show it, so while the setting is on, anything sent through them is kept under *Possible spam* for review rather than announced. If the check cannot load (for example, a browser extension blocks it) or Cloudflare cannot be reached, the form is still sent and kept for review, so a family is never blocked. **Testing:** Cloudflare publishes test keys that always pass (site key `1x00000000000000000000AA` with secret key `1x0000000000000000000000000000000AA`) and that always fail (site key `2x00000000000000000000AB` with secret key `2x0000000000000000000000000000000AA`). Use them on a copy of the site or briefly with the setting off, send yourself an enquiry, and then put the real keys back.
3. **Sign-ups and sign-ins in Supabase Auth** (parents may create their own accounts in the app):
   - Under *Authentication → Rate Limits*, review the limits for sign-ups and sign-ins, emails sent, one-time codes and verifications, and token refreshes. Keep them conservative: a family signs up once and signs in occasionally, so a few sign-ups per hour from one connection and a modest number of emails per hour are ample for a tutoring business. Raise a limit only if genuine families report being turned away.
   - Under *Authentication → Sign In / Providers → Email*, keep **Confirm email** switched on, so an account cannot be used until its owner has confirmed the address.
   - Under *Authentication → Attack Protection*, switch on **leaked password protection** if your Supabase plan includes it; it refuses passwords that are known to have appeared in data breaches.
   - **Leave CAPTCHA protection in *Authentication → Attack Protection* switched off.** Turning it on makes Supabase require a security-check token on every sign-up and sign-in, which the app does not yet send, so families and tutors would be locked out. It can be switched on once the app has been updated to send the check.

How it works:

- **Hidden fields (honeypots).** Each form contains a field that people never see. Automated programs tend to fill it in; when they do, they are shown the usual thank-you message, but nothing is sent.
- **Time to submit.** Each form notes how long it took to complete. Anything sent within three seconds is kept as possible spam.
- **Limits per email address and per connection.** Enquiries: 3 an hour or 6 a day from one email address, and 5 an hour or 20 a day from one internet connection. Tutor applications: 2 an hour or 3 a day from one email address, and 3 an hour or 10 a day from one connection. Beyond that, the visitor sees a polite message: *Thank you. We have received several messages from you in a short time, so we have paused further submissions for now. We will be in touch shortly; if your enquiry is urgent, please email hello@eliteeducation.me.* These limits replace the earlier check that refused a sixth enquiry in a day with *We already have your enquiry*. Connection addresses are not stored in readable form: only a fingerprint made with a random, private salt (created by the migration) is kept, and it is deleted after 30 days. **Please confirm** on the live project which address headers Supabase passes to the database (in the SQL editor, a request's `request.headers`): the fingerprint uses `cf-connecting-ip`, then `x-real-ip`, and only as a last resort the first `x-forwarded-for` entry, which a visitor can set themselves and so could use to slip past the per-connection limit.
- **Duplicates.** If the same email address sends a similar message within 24 hours, it is added to the existing enquiry rather than creating a second one, and the family sees the usual thank-you. A repeat only ever fills in blanks: an earlier message is never overwritten (a different new message is added underneath as a dated *Re-sent* paragraph), and an applicant's CV or experience statement is never replaced, since anyone who knows the email address could send the form. For the same reason a repeat never writes a telephone number into the contact details: a new number is recorded in the notes (*Telephone number given in a repeat submission on …*) for the office to confirm before use. A repeat that itself looks automated is never merged; it is kept separately under *Possible spam*. The admin home shows *received N times* beside a new enquiry that has been sent more than once, so a family following up stands out.
- **Signed-in families.** A parent who is signed in is never flagged, so a consultation request sent with one tap from the pre-filled onboarding form always reaches the team.
- **Links.** A message with three or more links, or a link in a name, is kept as possible spam.
- **Possible spam.** Flagged submissions are never rejected. They are kept under the *Possible spam* button beneath the tabs on *Enquiries* and *Hiring*, send no notification to the team and no thank-you email, and are left out of the conversion statistics. So that nothing genuine sits unseen, the admin home shows a quiet line (*N enquiries held as possible spam to review*) and the *Enquiries* and *Hiring* rows under *More* mention them, without adding to the *Needs attention* count. Open one and choose **Not spam**, then **Send acknowledgement** or **Move without email** (or **Cancel**) to move it into the normal pipeline, or **Mark as spam** to file away anything that slipped through. *Mark as spam* is offered on a genuine item only while it is still new, so an enrolled family or a hired tutor cannot be filed away by mistake. Search results mark such items *Possible spam*, and an enquiry's *Next steps* appear only once it has been marked as not spam. A signed-in family can see its own enquiries through the database, including their spam status; nothing more sensitive is stored there, so this is accepted rather than hidden.

## Round 4 setup checklist

**Urgent: the web app deploys on merge and reads the new tables straight away. Run `20261008000000_homework.sql` through `20261014000000_round4_qa_fixes.sql` in the SQL editor now, before anything else.** Until they run, family lists, the parent home, admin billing, homework, the resource library and the Account screen's calendar and WhatsApp cards fail for every role.

Complete these once, in this order. Each feature's section above carries the detail.

1. **Database.** In the Supabase SQL editor, run each migration newer than `20261007000000_subjects.sql`, one file at a time in filename order: `20261008000000_homework.sql`, `20261009000000_calendar.sql`, `20261010000000_payments.sql`, `20261011000000_whatsapp.sql`, `20261012000000_invoice_notifications.sql`, `20261012010000_classwork_security.sql`, `20261013000000_review_fixes.sql` and `20261014000000_round4_qa_fixes.sql`. The last one corrects the links in office notifications, writes lesson dates on invoices as '17 Aug 2026', keeps the `classwork` bucket private, and lets the Stripe webhook alert the office if a card payment is taken but cannot be recorded (for example because the invoice was deleted meanwhile), so it can be reconciled by hand. Do not use `npx supabase db push`: the earlier migrations were applied in the SQL editor, so the project has no migration history and `db push` would try to run `20261002000000_init.sql` again and fail. (If you ever want to switch to `db push`, first mark the applied files with `npx supabase migration repair --status applied <version>` for each one.)
2. **App address.** Set `APP_URL` once to `https://eliteeducation.me/app` (see *Web app at `/app`*). Email links, Stripe returns and Google Calendar returns all use this one value.
3. **Google.** Reuse the OAuth client from *Sign in with Apple and Google*. In the Google Cloud Console, enable the **Google Calendar API**, add the `calendar.events` and `calendar.freebusy` scopes to the OAuth consent screen, and add `https://<project-ref>.supabase.co/functions/v1/google-connect` as an authorised redirect URI. Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CALENDAR_SYNC_SECRET` (a long random value), and schedule `calendar-sync` with the Vault and `x-sync-secret` snippet under *Google Calendar*. Without `CALENDAR_SYNC_SECRET`, `calendar-sync` refuses every call.
4. **Apple.** Follow the Apple steps under *Sign in with Apple and Google*.
5. **Stripe.** In the Stripe Dashboard, switch on **Apple Pay** and **Google Pay** under *Settings → Payments → Payment methods* (hosted Checkout needs no domain registration), switch on and configure the **Customer portal**, and make sure the webhook lists all six events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_method.attached`, `payment_method.detached` and `customer.updated`. Without `payment_method.detached`, removing the last card never switches autopay off; without `customer.updated`, a change of default card is not shown.
6. **Twilio.** Follow *WhatsApp reminders* above.
7. **Deploy.** Run `npx supabase functions deploy google-connect calendar-sync create-checkout stripe-webhook charge-invoice billing-portal send-notifications send-reminders ai-assist ics`. `ics`, `stripe-webhook` and `google-connect` must accept calls without a Supabase login; `supabase/config.toml` already sets `verify_jwt = false` for them, so deploy from this folder (or deploy those three separately with `--no-verify-jwt`).
8. **Schedule.** `calendar-sync` every 5 minutes (Vault snippet under *Google Calendar*), `charge-invoice` every 15 minutes (Vault snippet under *Card payments*, legacy `service_role` key), `send-notifications` every minute and `send-reminders` hourly (both with the pg_cron snippet in step 9). Every snippet that sends `Bearer <legacy anon key…>` needs the legacy `eyJ…` anon key: an `sb_publishable_` key is not accepted by the function gateway, so every scheduled run would be refused without any visible error. If any of these four are already scheduled from the dashboard, remove those schedules first.
9. **Schedule and lock `send-notifications` and `send-reminders`.** Without a secret they accept any caller holding the public anon key, who could run them early and repeatedly (the work is safe to repeat, but should not be). Store a random value in Vault and schedule both functions with the `x-cron-secret` header as below, then set the same value with `npx supabase secrets set CRON_SECRET=<random value>` (`openssl rand -hex 32` produces one). Once `CRON_SECRET` is set, calls without the header are refused, so schedule with the header first. `calendar-sync` is locked the same way by `CALENDAR_SYNC_SECRET` and its `x-sync-secret` header (step 3); without that secret it refuses every call, so calendar sync does nothing until it is set.
   ```sql
   select vault.create_secret('<the same random value>', 'cron_secret');
   select cron.schedule('send-notifications', '* * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-notifications',
       headers := jsonb_build_object(
         'Authorization', 'Bearer <legacy anon key, eyJ… (Project Settings → API Keys → Legacy API keys)>',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       )
     )
   $$);
   select cron.schedule('send-reminders', '0 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object(
         'Authorization', 'Bearer <legacy anon key, eyJ… (Project Settings → API Keys → Legacy API keys)>',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       )
     )
   $$);
   ```
10. **WhatsApp opt-outs.** A family who replies STOP on WhatsApp is not yet switched off automatically. Until an inbound handler is added, the office should switch WhatsApp off for them by asking them to do so under *Account*, or by clearing `whatsapp_opt_in` for that profile in the table editor.
11. **Check on a real device.** Light and dark mode, Sign in with Apple and Google, a WhatsApp opt-in on your own number, and tapping a push notification (it should open the screen it refers to). Also print an invoice PDF on iPhone: iOS has neither Calibri nor Carlito, so the PDF body text may fall back to Helvetica; confirm that this is acceptable.

## Round 5 setup checklist

Round 5 adds View as, per-student rates, family contacts, the audit log, UAE tax documents and accountant access, admissions advisory, tutor vetting, launch readiness, spam protection, and session plans with handover packs. Complete these once, in this order, after the *Round 4 setup checklist*. Each feature's section below carries the detail.

1. **Database.** In the Supabase SQL editor, run each file below once, one at a time, in this order, skipping any already applied:
   1. `20261013000000_review_fixes.sql`
   2. `20261014000000_round4_qa_fixes.sql`
   3. `20261101000000_viewas.sql`
   4. `20261102000000_rates.sql`
   5. `20261103000000_contacts.sql`
   6. `20261104000000_audit.sql`
   7. `20261105000000_tax.sql`
   8. `20261106000000_admissions.sql`
   9. `20261107000000_vetting.sql`
   10. `20261108000000_launch.sql`
   11. `20261109000000_spam.sql`
   12. `20261110000000_handover.sql`
   13. `20261111000000_round5_merge.sql`
   14. `20261112000000_round5_followups.sql`
   <!-- r6 fix migrations -->

   Later fix migrations, named `20261113…_*_fix.sql`, are listed at the end of this list; run them last, in filename order. This is the one list of migrations to run for round 5: the sections below refer back to it rather than repeating it.

   The merge migration joins the features together: it restores the round 4 follow-up's notification links and readable charge dates where round 5 files had redefined those functions, keeps the office's enquiry notes away from families, stops a family contact's address becoming an accountant login, extends account deletion and *Download my data* to every round 5 record, lets View as read the round 5 screens, audits credit notes, refunds, accountant access, admissions cases and tutor documents, and records every migration in the ledger. The follow-ups migration makes the admissions timeline read *Advisory update sent: October 2026* when a monthly update is sent. As with round 4, do not use `npx supabase db push` unless the migration history has first been repaired (see step 1 of the *Round 4 setup checklist*).
2. **Check the database version.** Sign in as an administrator and open *Admin → More → System health*. The database version should read `20261112000000 round5_followups`, and the ledger should list 26 migrations.
3. **View as.** In the SQL editor, `select rolconfig from pg_roles where rolname = 'authenticator';` should include `pgrst.db_pre_request=public.view_as_guard` (see *View as* below).
4. **Deploy the Edge Functions.** Run `npx supabase functions deploy view-as refund-payment invite-accountant delete-account health-check backup-export ai-assist billing-portal charge-invoice create-checkout google-connect calendar-sync stripe-webhook send-notifications send-reminders` and `npx supabase functions deploy ics --no-verify-jwt`. Every function a signed-in person can call to change something now refuses a View as session, and the scheduled ones report to *System health*. Run this from the `app/` folder so that `supabase/config.toml` keeps `stripe-webhook`, `google-connect` and `verify-captcha` open without a login.
5. **Secrets.** Set `HEALTH_ALERT_EMAIL` (System health alerts), and make sure `APP_URL`, `RESEND_API_KEY` and `EMAIL_FROM` are set (the accountant's invitation and the health alerts use them). `ANTHROPIC_API_KEY` is optional: without it the admissions *AI draft* button uses the built-in template letter.
6. **Stripe.** Add `refund.created`, `refund.updated`, `refund.failed` and `charge.refund.updated` to the webhook's events (see *UAE tax invoices* below).
7. **Schedules.** Add `health-check` every 15 minutes and `backup-export` nightly (see *Launch functions: deploy and schedule*). `send-reminders` now also queues admissions reminders and police clearance alerts, so it needs no new schedule.
8. **Tax details.** Enter the legal name, TRN, registered address and VAT quarter under *More → Business settings*, then invite the accountant from *More → Accountant access*.
9. **Tutor checks.** Ask tutors to upload their police clearance under *Account → My checks and documents*, verify them under *More → Tutor checks*, and only then switch enforcement on.
10. **Spam protection.** In Supabase, review *Authentication → Rate Limits*, keep **Confirm email** on and leave Auth CAPTCHA off (see *Spam and abuse protection* above). Turnstile on the website is optional: add the site key to `index.html`, set `TURNSTILE_SECRET_KEY`, run `npx supabase functions deploy verify-captcha --no-verify-jwt`, then switch on *Security check on website forms* in Settings.
11. **Point-in-time recovery** on the Pro plan, and the store submission steps in `LAUNCH.md`.
12. **Check on a real device.** View a test parent as an administrator and try to send a message (it should be refused); set a custom rate and record a lesson; add a second family contact; issue a credit note; publish an admissions update; upload a police clearance as a tutor; reassign a lesson and open the handover pack; and finally close a test family's account and confirm its invoices remain under *Admin → Billing*.

**Decisions for Craig.** Only the family's main contact (or its last remaining sign-in contact) closes the whole family when they delete their own account, including every other contact's login. Any other contact who can sign in (a second parent, a PA, a driver) closes only their own sign-in: their contact is removed from the family and their login is anonymised, while the family, its children and other logins stay (`20261113001400_contactdel_fix.sql`). The office can still close the whole family from *Deletion requests*. Admissions letters greet a family by first name when no title is recorded; a preferred-salutation field on the contact would let each family choose.

## View as (read only)

The office can see the app exactly as a particular parent, student or tutor sees it, in order to answer a question or check what a family has been sent. A view is strictly read only: nothing can be added, changed, sent, paid for or deleted while it is open, and the app shows *Viewing only — changes are disabled.* if anything is attempted. Only admins can start a view, and an admin cannot view another admin.

**How it works.** The `view-as` Edge Function, called with the admin's own login, creates a one-time sign-in for the person through the Supabase auth admin API (`generateLink`; no email is sent), exchanges it for a session on the server, and binds that session to a row in `view_as_sessions` before the tokens are returned to the admin's app. The auth admin API and the service-role key are used only inside the Edge Function and never appear in the app. Every database request made with a view's session then passes through `public.view_as_guard`, which PostgREST runs before each request: it allows reads and a short list of read-only functions, makes the whole request read-only, and refuses everything else. Storage uploads and deletions are refused by restrictive storage policies (as are file reads once the view has ended), and the AI, card payment, billing portal and Google Calendar functions refuse view sessions (if that check cannot run, they reply *This is not available right now. Please try again shortly.* rather than going ahead).

**Limits and records.**

- Each view lasts at most 60 minutes. After that, or once the admin returns to their own account, the view's session is refused entirely and the app shows *This view has ended. Please return to your own account.*
- Every start and end of a view is recorded, with the admin, the person and the time, in `view_as_audit`. Only admins can read it, and nobody can change it.
- Because a view signs in as the person, their *last signed in* time in Supabase updates when they are viewed.
- Starting a view invalidates any sign-in or password-reset link the person has been sent but not yet used; they can simply request a new one.
- Ending a view deletes its auth session (and refresh tokens) on the server, and a view's session cannot be refreshed once the view has ended or expired.
- The person's email address, phone number and password cannot change, and no second factor or new Google or Apple sign-in can be added to their account, while a view of it is active. If a view expired without being ended (for example the app was closed), this protection lasts 65 minutes longer, until the view's last access token has run out. That allowance assumes Supabase's default one-hour JWT expiry; if the project's JWT expiry is raised, raise the interval in `public.view_as_protects` to match.
- Some auth-only changes are not covered: while a view is active, its session could still change the person's `user_metadata` through the auth API. The app never does this and nothing in the app relies on `user_metadata` for access.
- A person who has never been given a login cannot be viewed (*This person does not have a login yet.*).

**Deploying.**

1. Migration `20261101000000_viewas.sql`. Run it in the Supabase SQL editor as part of the *Round 5 setup checklist*, step 1. The migration also sets `pgrst.db_pre_request = 'public.view_as_guard'` on the `authenticator` role and reloads PostgREST. If the project already uses a different `db_pre_request` function, combine the two into one function before deploying, as PostgREST supports only one.
2. Run `npx supabase functions deploy view-as`. It keeps the default JWT check, so no `config.toml` change is needed.
3. Redeploy the functions that now refuse view sessions: `npx supabase functions deploy ai-assist billing-portal charge-invoice create-checkout google-connect delete-account refund-payment invite-accountant`. The read-only RPCs a viewed person needs are listed in `public.view_as_read_rpcs()`; any other RPC, and every write to a table, is refused while viewing.

**Checking that it works.**

1. In the SQL editor, `select rolconfig from pg_roles where rolname = 'authenticator';` should include `pgrst.db_pre_request=public.view_as_guard`.
2. Sign in as an admin and view a test parent. Their lessons, invoices and messages should appear as they would for the parent.
3. Try to send a message, book a lesson or upload a file: each should be refused with *Viewing only — changes are disabled.*
4. Return to your own account, and confirm that `view_as_audit` shows a `start` and an `end` row for the view and that `view_as_sessions` shows an `ended_at` time and a `revoked_at` time. If `revoked_at` is empty, the database could not delete the session from `auth.sessions` in this project; the view is still refused, and the person stays protected for 65 minutes after the view.
5. On an iPhone or the iOS simulator, view a tutor, open *Record lesson* and a parent's *Book a lesson*: the compact Noir strip with its gold rule and *Exit* should appear at the top of each sheet, and tapping save should show the *Viewing only* note inside the sheet.

## Per-student rates

Tutor pay and family prices may be the same for every student or set individually. Migration: `supabase/migrations/20261102000000_rates.sql`. Run it in the Supabase SQL editor as part of the *Round 5 setup checklist*, step 1.

- **Defaults.** Unless an override is set, a tutor is paid their usual hourly rate (set on the tutor) and a family is charged the price of the lesson's service.
- **Custom overrides.** An admin may set, for one student's subject (an enrolment), a custom hourly pay for that subject's tutor and a custom hourly price for the family. Either may be cleared at any time to return to the default. Tutor pay can only be set once the subject has a tutor. A custom family price is charged per hour, so a 90-minute lesson at AED 600 an hour is charged AED 900. Package credits are still used first, because a package is lessons the family has already paid for.
- **Who can see what.** Admins see everything. A tutor sees only the custom pay for subjects they teach, and never sees family prices. A parent sees their own family's custom prices, and never sees tutor pay. Students see neither.
- **Group lessons.** Each family pays its own price for its own child. The tutor is paid the highest effective rate among the students in the lesson.
- **Cover tutors.** Custom pay belongs to the student, the subject and the tutor together. A tutor covering a lesson is paid their own usual rate, and changing a subject's tutor removes the previous tutor's custom pay.
- **Snapshots.** Each charge records the price used when it was created, and submitted, approved and paid tutor invoices keep the rates they were submitted with. Changing a rate therefore affects only lessons charged afterwards and tutor invoices still in draft, which are rebuilt with the current rates.
- **Awarding a role.** When a role for a named student is awarded, the student's enrolment in that subject (created if it does not yet exist) is given the chosen tutor, and the role's pay becomes that tutor's custom pay for the subject.

Please note that each tutor's usual hourly rate, held on `public.tutors`, remains readable by any signed-in user. This predates per-student rates and is flagged for a later tightening.

## Audit log

Every change to the records that matter is written to a permanent audit log (`public.audit_events`, created by `20261104000000_audit.sql`). Each entry records when the change was made, who made it (their name and role at the time, or *System* for automated jobs and payment webhooks), what was added, changed or removed, and the family, student, tutor and related records it belongs to. For an update, only the fields that changed are stored, with their previous and new values.

**What is recorded.** Lessons, lesson notes, charges, invoices, payments, packages, tutor invoices, enrolments, students, families, tutors, settings, services and homework, together with status changes to student reports and the award of tutoring opportunities. Custom per-subject tutor pay and family prices, and family contacts, are recorded too once those tables exist. Routine housekeeping, such as reminder timestamps, invoice numbering and the progress of automatic card payments, is not recorded; the payment itself and the invoice being marked paid are.

**Reading it.** Each entry is a plain sentence, with a short line naming the record it is about when the sentence does not (for example *Omar · Chemistry · Thu 8 Oct* for a lesson, or *Al Mansoori family · INV-1001* for a payment). These labels are saved with the entry, so they still read correctly after a lesson is moved or deleted. On a family's, student's or tutor's screen, entries about another record (a lesson, an invoice) open that record. The Activity log can be filtered by person (searchable, grouped into staff, tutors, families and students, or *The system* for automatic changes), by type and by date.

**What is never recorded.** Bank details and IBANs, SWIFT codes and account numbers, tokens, secrets and passwords, and payment-provider references (Stripe payment, session and customer ids are hidden wherever they appear, including a payment's visible reference). A change to any of these is still logged, so it is clear that, for example, the bank details were changed and by whom, but the values themselves appear only as *[redacted]*. Card data is never held by Elite Education at all, and tutors' private lesson notes, private student notes, tutor payment details, sign-in profiles and calendar connections are not audited.

**Who can see it.** Administrators only, in the *History* section of each record and under *Admin → More → Activity log*. Tutors, parents and students cannot read the log, and the reading functions (`list_audit_events`, `audit_actors`) refuse anyone who is not an administrator.

**Immutability.** Entries are written automatically by a database trigger and cannot be added, edited or deleted by anyone through the app or the API, including administrators and the service role. Database triggers also block updates, deletions and truncation by the table owner.

**Retention.** The log is kept indefinitely by default; there is no automatic expiry. To export it, run `copy (select * from public.audit_events order by at) to stdout with csv header` in the Supabase SQL editor (or `\copy` from `psql` to save a file), or use *Export to CSV* in the Table editor. Should a purge ever be legally required, a database owner must carry it out deliberately, outside the app, in the SQL editor: `alter table public.audit_events disable trigger audit_events_no_change;`, then the specific `delete`, then `alter table public.audit_events enable trigger audit_events_no_change;`. Record the reason for the purge separately.

**Account deletion.** When a person is removed, the log keeps only their id and name for the deletion itself, not their contact details. Earlier entries about them are left intact until erasure: after the account deletion process anonymises the records, it must call `select public.audit_erase(p_family_ids, p_student_ids, p_tutor_ids, p_profile_ids);` (service role or database owner only). This keeps every entry, with its dates, amounts and statuses, but replaces names, contact details and free text in those entries with *[erased]* and removes the erased people's names as actors (shown as *A former user*). It is the only change the log ever accepts.

**Adding tables.** A later migration adds a table to the log with `select public.audit_attach('public.<table>');`. The entry is filed under the row's `family_id`, `student_id`, `tutor_id` and `enrolment_id` columns when it has them (an `enrolment_id` also files it under that subject's student and tutor), and any column whose name suggests bank details, tokens or secrets is redacted automatically. Keep the rules in the migration's header comment and `AUDIT_RULES` in `src/domain/audit.ts` in step.

## Round 5: UAE tax invoices, credit notes, refunds and accountant access

Every invoice the app issues is a UAE tax invoice. It carries the business's legal name, Tax Registration Number (TRN) and registered address, the customer's details (with their TRN where they are registered for VAT) and the date of supply. These details are copied onto the invoice when it is issued, so a later change to the settings or to a family's details never alters an invoice that has already been sent. Complete these steps once, in this order.

1. **Database.** Migration `supabase/migrations/20261105000000_tax.sql`. Run it in the Supabase SQL editor as part of the *Round 5 setup checklist*, step 1. Invoices issued before this migration take the business and family details as they stand when it runs.
2. **Business settings.** In *More → Business settings*, enter the legal name, the 15-digit TRN and the registered address exactly as they appear on the Federal Tax Authority (FTA) certificate, and choose the VAT quarter start month shown on that certificate (January, February or March). Set VAT to 5%.
3. **Families.** Where a family pays through a company, or is otherwise registered for VAT, add the company's name (*Billed to*), TRN and billing address to the family's billing details; the company's name then appears as the customer on its tax invoices. Tutors never see these details.
4. **Edge Functions.** Run `npx supabase functions deploy refund-payment invite-accountant`, and deploy `stripe-webhook`, `create-checkout` and `charge-invoice` again, as they now allow for credit notes and refunds. Both new functions are for signed-in admins, so they keep the default JWT check.
5. **Stripe.** Add `refund.created`, `refund.updated`, `refund.failed` and `charge.refund.updated` to the webhook's events. A refund made in the Stripe Dashboard is recorded in the app automatically, and the office is asked whether a credit note is needed.
6. **APP_URL.** If it is not set already, run `npx supabase secrets set APP_URL=https://<your app address>`. The accountant's invitation links back to the app's sign-in screen.
7. **Accountant.** Invite your accountant from *More → Accountant access*. They receive an email invitation; once they accept it, they can sign in. If they are asked for a password they do not have, they should use *Forgot password* on the sign-in screen. The accountant can read invoices, payments, credit notes, refunds, lesson packages, expenses (with receipts), tutor invoices and families. They cannot change anything, and they never see pupil records, lessons, notes, homework or messages (invoice lines do name the pupil taught).

**How corrections work now.** An issued invoice cannot be edited, returned to draft or deleted, and invoice and credit note numbers run in sequence without gaps. To correct an invoice, issue a credit note against it: choose the lines and amounts to credit and give a reason. Choose to release the lessons when they should be invoiced again (for example, when the wrong rate was charged); leave this off for a goodwill reduction. Cancelling a sent or paid invoice issues a closing credit note for whatever has not already been credited and, as before, releases its lessons to be invoiced again. A cancelled invoice cannot be reopened. One limit to know: if a line has already had a goodwill reduction and a later credit note (or cancelling the invoice) credits the rest of that line and releases its lesson, the lesson is invoiced again at its full price while the earlier reduction still counts as a credit to the family. Where that is not wanted, credit the whole line in a single note with *Invoice these lessons again* switched on.

**Refunds.** A card payment taken through Stripe is refunded from the invoice in the app; a bank transfer or cash refund is recorded there once it has been made. When a family has paid an invoice in full, a refund needs a credit note for the same amount, unless it only returns an overpayment. Each refund request is sent once, even if the button is pressed twice or the connection drops. Notifications about refunds never include bank details.

**Record keeping.** Tax invoices and credit notes must be kept for at least five years. The database refuses to delete an invoice or a credit note. Any account deletion or data export work must keep a family's invoices, credit notes, payments and refunds, and must never delete them with the account.

## Admissions advisory

Guidance for families applying to schools, boarding schools and UK or US universities. The office opens a case for a student and can name a tutor as its adviser; a tutor who teaches the student but does not advise sees nothing of the case. Each case holds a shortlist of schools or universities, key dates and deadlines (which can be linked to a preparation course or lesson), tasks for the family or the adviser, private documents, advisory updates and a timeline the family can follow. Advisers write monthly or ad hoc updates (with optional AI drafting), submit them for review, and the office approves and publishes them to the family. Admissions fees are invoiced to the family from the case and follow the usual invoice notices and autopay.

**Setup**

1. Run `supabase/migrations/20261106000000_admissions.sql`. It creates the tables and the private `admissions` storage bucket with its access rules.
2. Redeploy the functions that changed: `npx supabase functions deploy ai-assist send-reminders` and `npx supabase functions deploy ics --no-verify-jwt`.
3. Nothing else to schedule: reminders run with the existing hourly `send-reminders` schedule.

**Good to know**

- Key-date reminders go 14, 7, 1 and 0 days before, and task reminders 3 days before and on the day, to the family and to the adviser (or the office when no adviser is named), between 08:00 and 21:00 UAE time. They are sent by push and email; there is no WhatsApp template for admissions yet.
- Documents are private to the family, the adviser and admins. The adviser can keep a document from the family; anything the family uploads is always visible to them. Notifications never include the file itself, the text of an advisory update or bank details.
- Open key dates appear in each person's calendar feed (`ics`): parents for their children, students for themselves, advisers for their cases and admins for every case.

## Tutor vetting and onboarding

Every tutor must hold a police clearance certificate, verified by Elite Education, before they teach. Tutors upload their certificate and other documents (passport or ID, qualifications) under *Account → My checks and documents*; an administrator verifies or rejects each one in *More → Tutor checks* and records the expiry date. A certificate is valid on its expiry date and expired the day after.

**Setting it up.**

1. Migration `20261107000000_vetting.sql`. Run it in the Supabase SQL editor as part of the *Round 5 setup checklist*, step 1. It creates the private `vetting` storage bucket (PDFs and photos, 10 MB per file); tutors can read only their own folder and administrators can read everything. No other role can read the files.
2. Redeploy `send-reminders` (`npx supabase functions deploy send-reminders`). Its hourly run now also queues police clearance expiry alerts 60, 30 and 7 days before a certificate expires and on the expiry date itself, for the tutor and for the office; `send-notifications` delivers them. A certificate verified late sends a single alert rather than several, and an older certificate that has been replaced sends none. Alerts never include bank details or file names.

**Switching on enforcement.** Enforcement is off when the migration is first run, so that existing tutors are not blocked while they upload their certificates; until then the app warns but blocks nothing. Once your current tutors' certificates have been verified, switch it on in *More → Tutor checks*. From then on, a tutor without a verified, unexpired police clearance cannot be:

- assigned new lessons (including by reassigning a lesson or approving a booking request);
- given new students (enrolments); or
- awarded roles for which they have expressed interest.

Their existing lessons are not blocked: they can still be rescheduled, completed or cancelled, and the app shows a warning. Where there is good reason (for example, a renewal has been applied for and the receipt has been seen), an administrator can record an override for up to 90 days. Every override requires a reason of at least ten characters, records who granted it and when it ends, and is reported to all administrators. Overrides can be revoked at any time.

**Tutor handbook.** Edit the handbook in *More → Tutor handbook*. Each time you publish, a new version is created and every tutor is asked to read and acknowledge it; the *Tutor handbook* screen lists each tutor's acknowledged version, and *More → Tutor checks* shows it per tutor. The migration installs version 1, the default Elite Education Tutor Handbook.

**Onboarding checklist.** Marking a tutor application as *Hired*, with the tutor's record linked, starts their onboarding. The checklist shows, for every tutor, their police clearance status, documents awaiting review, bank details, availability, calendar connection, WhatsApp opt-in and handbook acknowledgement.

## Checks

```bash
npm run check      # lint + typecheck + unit tests
npm run test:db    # schema, row-level security and billing functions against a local Postgres
```

Both run automatically in GitHub Actions on every push and pull request (see *Continuous integration* below), so a red cross on a commit means one of them failed.

## Continuous integration

`.github/workflows/ci.yml` (*Checks*) runs on every push and every pull request, on every branch, and can be started by hand from *Actions → Checks → Run workflow*. A newer push to the same branch cancels the run still in progress. It has two jobs:

- **App (lint, types, unit tests)** installs the packages with `npm ci` and runs `npm run check`: ESLint, the TypeScript compiler and the Jest unit tests.
- **Database (migrations, row-level security, server functions)** runs `bash supabase/tests/run.sh` (the same as `npm run test:db`): it starts a throwaway PostgreSQL server, applies every migration in order to a fresh database for each test file, and runs the SQL tests in `supabase/tests`. PostgreSQL comes with the GitHub runner; the job installs it only if it is missing.

`deploy.yml` still runs `npm run check` before it publishes from `main`, so a broken commit is never deployed.

**Reading a failure.** Open the red cross next to the commit (or the *Checks* tab of the pull request), then the failed job and the failed step:

- *Lint, typecheck and unit tests*: the log shows the ESLint rule and file, the TypeScript error with its file and line, or the Jest test name with *Expected* and *Received*. Run `npm run check` locally to reproduce.
- *Database tests*: the last lines show the SQL test file, the failing statement and the message (for example `ERROR: permission denied` or a failed `assert`). Run `npm run test:db` locally; it needs PostgreSQL installed (`PG_BIN` can point at its `bin` folder, and `PG_TEST_PORT` changes the port).

**Requiring the checks on main.** In GitHub, go to *Settings → Branches → Add branch protection rule* (or *Rules → Rulesets*), target `main`, tick *Require status checks to pass before merging*, and choose both **App (lint, types, unit tests)** and **Database (migrations, row-level security, server functions)**. The checks appear in the list once they have run at least once.

**Later improvement.** The Edge Functions are written for Deno and are not yet type-checked in CI. A third job could install Deno (`denoland/setup-deno`) and run `deno check supabase/functions/*/index.ts`.

## Database migrations

- **Never edit a migration that has been applied** anywhere (production, or a teammate's database). Fix forward with a new migration.
- Name each new file `<next timestamp>_<name>.sql` in `supabase/migrations`, with a timestamp later than every existing file (for example `20261112000000_waiting_list.sql`). Files run in name order.
- **End every new migration** with a line that records it, so the app can show which version is live:
  ```sql
  select public.record_migration('20261112000000', 'waiting_list');
  ```
- Add a matching SQL test, `supabase/tests/<name>_test.sql`, and add `<name>` to the list of tests in `supabase/tests/run.sh`. CI then checks it on every push.
- Apply to production by pasting the file into the SQL editor, or with `npx supabase db push` (it applies only the migrations that are new) only once the migration history has been repaired (see *Round 4 setup checklist*, step 1).
- Check the result in the app: *Admin → More → System health → Database version*. In production it also reads `supabase_migrations.schema_migrations` (the list kept by `supabase db push`), so every applied migration is listed even if it was applied before `record_migration` existed.

## Backups and restore

Three layers protect the data:

1. **Point-in-time recovery (PITR).** On the Supabase Pro plan, enable the PITR add-on (*Database → Backups → Point in time*). It lets you restore the whole database to any second in the retention window. Without PITR, the Pro plan keeps **daily backups** for 7 days. This is the only backup that includes tutor bank details and Google Calendar tokens.
2. **Nightly JSON export.** The `backup-export` Edge Function runs daily at 02:10 UAE time. It writes one JSON file per business table (families, students, lessons, notes, homework and hand-ins, messages, enquiries, lesson requests, availability, invoices, charges, payments, packages, billing settings, tutors, tutor invoices, applications, opportunities, expenses, reports, resources and settings) plus a `manifest.json` with row counts and the database version into the private **`backups`** storage bucket, in a folder named after the date (`2026-11-14/invoices.json`). Folders older than **35 days** are deleted automatically. Bank details, calendar tokens, OAuth states, autopay requests and push tokens are **intentionally excluded**, as are logins (auth users) and uploaded files. The JSON copy is therefore partial: it is for checking and restoring single tables or rows, and **PITR or the daily backups are the full restore path**.
3. **Your own copy.** From time to time, download a day's folder and keep it somewhere safe and encrypted.

**Restore the whole database to a point in time.** Supabase Dashboard → *Database → Backups → Point in time* → choose the date and time just before the problem → *Restore*. The project is unavailable for a few minutes while it restores, and everything after that moment is lost, so first pause the cron jobs and note what changed since.

**Download a day's backup.** Dashboard → *Storage → backups* → open the date folder → download each file. With the CLI: `npx supabase storage cp -r ss:///backups/2026-11-14 ./backup-2026-11-14 --experimental --linked`.

**Restore a single table from JSON** (for example after a mistaken bulk edit to `lessons`). Always restore into a scratch schema first, compare, then copy back only the rows you need:

```bash
# 1. Load the JSON into a scratch table (needs the database connection string from Dashboard → Connect).
psql "$DATABASE_URL" -c "create schema if not exists restore; drop table if exists restore.lessons_raw; create table restore.lessons_raw (doc jsonb);"
jq -c '.[]' backup-2026-11-14/lessons.json | psql "$DATABASE_URL" -c "\copy restore.lessons_raw (doc) from stdin"
```

```sql
-- 2. Turn it back into rows with the live table's columns, and compare.
create table restore.lessons as
  select r.* from restore.lessons_raw, jsonb_populate_record(null::public.lessons, doc) r;
select count(*) from restore.lessons;
select id from restore.lessons except select id from public.lessons;   -- rows that were deleted

-- 3. Copy back only what is needed, then tidy up.
insert into public.lessons select * from restore.lessons
  where id in (select id from restore.lessons except select id from public.lessons);
drop schema restore cascade;
```

Each table file is a plain JSON array of rows. The `profiles` file holds only the columns needed to reconnect logins (no tokens), so restore it into the scratch schema and copy across the columns you need.

**Test a restore every quarter:** download one day's folder, restore one table into the scratch schema as above, check the row count matches `manifest.json`, and drop the schema. Note the date in the office log.

## Error reporting and System health

- **App errors.** Crashes and unexpected errors in the app are sent to the database through `log_app_error` and stored in `app_errors`. Personal details (email addresses, phone numbers, long numbers such as card or IBAN digits, and tokens) are removed before the report leaves the device and again in the database, and reports are rate-limited (per person and per error) so a fault in a loop cannot flood the table. Expected problems, such as no internet connection, are not reported. Reports older than 90 days are deleted.
- **Server errors.** Every Edge Function is wrapped in `withMonitoring` (`supabase/functions/_shared/monitoring.ts`): failures are recorded in `function_errors`, and the scheduled functions record each run in `function_runs`.
- **System health** (*Admin → More → System health*) shows each check with its status, the recent errors and the database version. It flags:
  - emails, push or WhatsApp notifications waiting more than **10 minutes**, or failed in the last 24 hours;
  - the Google Calendar queue stuck for more than **30 minutes**;
  - `charge-invoice` (autopay) not having run for **30 minutes**;
  - Stripe webhook failures in the last 24 hours (card payments may not have been recorded);
  - WhatsApp failures;
  - a nightly backup older than **26 hours**;
  - server and app errors in the last 24 hours.
- **Alerts.** The `health-check` function runs every 15 minutes and emails `HEALTH_ALERT_EMAIL` (or every administrator if it is not set) when a problem starts, again every 6 hours while it continues, and once when everything is clear. Alerts hold counts only, never personal details.

**Adding Sentry later (optional).** Create a React Native project at sentry.io, store its DSN as an EAS environment variable (`EXPO_PUBLIC_SENTRY_DSN`, under expo.dev → your project → *Environment variables*), run `npx expo install @sentry/react-native`, add its config plugin to `app.json`, initialise it with the DSN, and register it as an extra destination with `registerErrorSink` in `src/lib/error-reporting.ts`. That is the one place to change; every existing report then reaches both the database and Sentry.

## Account deletion and data export

Families, students and tutors can download their data and close their account themselves, as Apple's guideline 5.1.1(v) and the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021) expect.

- **Download my data** (*Account → Your data and privacy*): a JSON file with everything held about the person (and, for a parent, their family and children), and a readable PDF summary. A tutor's bank details appear only as the bank name and the last four digits of the IBAN.
- **Delete my account** (*Account → Your data and privacy → Delete my account*): explains what happens, offers the download first, and asks for typed confirmation. The `delete-account` Edge Function then closes the account at once.
- **What is removed and what is kept:**
  - *Family contact who is not the main contact* (a second parent, PA, driver or other contact with a login): closing their own account closes only their sign-in, as if the main contact had removed them from the family's contacts; the family, its children and the other logins are untouched. The screen tells them: *This closes your own sign-in only. The family's account and records stay with the main contact.* A request the office records for such a login still closes the whole family.
  - *Parent (family), meaning the main contact or the family's last sign-in contact:* the whole family is closed with every login in it. Names, contact details, addresses, notes, homework, hand-ins, ratings, reports, messages' author names, saved card summary, WhatsApp consent, push tokens, queued emails and stored files are removed; upcoming lessons are cancelled (children are removed from group lessons). **Invoices, credit notes, charges, payments and packages are kept**, anonymised, because tax law requires them; the family surname stays as the bill-to name on retained invoices.
  - *Student login:* closed with their family, as above. The office can also close a single child from the family.
  - *Tutor:* name, contact details, availability, time off, bank details and calendar links are removed. **Lessons and tutor invoices are kept** for pay and tax records. Upcoming lessons are not cancelled; they are counted so the office can give them to another tutor.
  - *Administrator:* the only administrator cannot be removed until another is appointed.
  - *Accountant:* their login and invitation are removed; the books they read are untouched.
  - *Round 5 records* (`20261111000000_round5_merge.sql`): closing a family also removes its other contacts (the main contact keeps only the anonymised details), its billing name, address and TRN (tax invoices and credit notes keep their own copy), admissions cases with their letters and stored documents, handover packs and lesson plans about the children, and its entries in the spam log. Closing a tutor removes their vetting documents and stored certificates. In every case the audit log keeps that each change happened but blanks names, contact details and free text (`audit_erase`). **Credit notes and refunds are kept** with the invoices and payments.
- **Office side:** *Admin → More → Deletion requests* records requests received by email or phone, carries them out with the same function, shows failures to retry, and keeps a record of each completed deletion without personal details.
- **Retention:** retained invoices and payment records are kept for the period UAE tax law requires (the privacy policy currently says five years). **For legal and accountant review:** confirm the retention period, whether the bill-to surname must stay on tax invoices, and the wording in the app and the privacy policy.

## Launch functions: deploy and schedule

```bash
npx supabase functions deploy delete-account health-check backup-export
npx supabase secrets set HEALTH_ALERT_EMAIL=<the address that should receive alerts>
# Already set for send-notifications, and used by health-check for its emails: RESEND_API_KEY, EMAIL_FROM, APP_URL
```

`delete-account` needs no schedule and no extra secret. `health-check` and `backup-export` accept only the service role key, so schedule them the same way as `charge-invoice`: in the Supabase Dashboard under *Integrations → Cron* (switch on Cron and pg_net if asked), create a job that calls the Edge Function with method POST, body `{}` and `Authorization: Bearer <legacy service_role key, eyJ…>`, or in the SQL editor with the key kept in Vault:

```sql
-- Reuses the 'service_role_key' Vault secret created for charge-invoice (the legacy service_role key, eyJ…, from Project Settings → API Keys → Legacy API keys). Run the next line only if you have not already done so.
select vault.create_secret('<legacy service_role key, eyJ…>', 'service_role_key');

select cron.schedule('health-check', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
$$);

-- 22:10 UTC is 02:10 in the UAE.
select cron.schedule('backup-export', '10 22 * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/backup-export',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
$$);
```

Check the jobs with `select jobname, schedule, active from cron.job;` and their recent runs with `select * from cron.job_run_details order by start_time desc limit 20;`. After the first night, *System health* should show the backup as recent.

## Roadmap ideas

- AI worksheets on each student's weak topics
- Microsoft Outlook calendar sync, alongside the Google Calendar sync
- Online booking of trial lessons from eliteeducation.me
- Bank-feed import for expenses

## Session plans and handover packs

Tutors can write a plan for each upcoming lesson (objectives, topics, resources and homework they intend to set) and choose whether the family sees it. When a lesson moves to another tutor (cover), a subject is given to a new tutor, or a role for a known student is awarded, the app creates a handover (migration `20261110000000_handover.sql`): the new tutor is sent a pack with the student's goals, recent lesson notes, open homework, focus topics, plans and resources, and the previous tutor is asked to write a short handover note. Moving a covered lesson back to the regular tutor withdraws an unread cover pack. Packs and notifications never include bank details. Administrators see every pack under *More → Handover packs*; tutors see the packs they send or receive. Nothing needs configuring.

## Family contacts

Each family can have several contacts (migration `20261103000000_contacts.sql`, table `family_contacts`): a mother, a father, a guardian, a PA, the family office or a driver. Families manage their own contacts in the app, and the office manages them from the family's page. Every change goes through `save_family_contact` and `remove_family_contact`; when a parent makes a change, the office is told.

**What each setting controls**

- **Receives invoices**: new invoices, autopay notices, failed payments, lessons bought and other billing notices.
- **Receives reports**: published progress reports.
- **Receives lesson notes**: lesson notes, homework, homework feedback and shared resources.
- **General notices** (such as lesson request decisions) go to every contact who can sign in and to the main contact.
- **Can sign in**: the contact may create a login with their own email address, and then sees the family's lessons, progress and messages. A new sign-in contact without a login is sent an invitation email. Each family must keep at least one contact who can sign in; only the office can remove the last one.
- **WhatsApp**: a contact without a login (a driver or PA, say, even if they are not the main contact) receives WhatsApp messages (lesson reminders, which are their own kind of notice, and the kinds of notice ticked for them) only when "receives WhatsApp" is ticked, which the family or office should do only with that person's agreement, and their mobile number includes its country code (for example +971 50 123 4567). Messages go to the contact's number at the time of sending, so a corrected number is used even for messages already queued. A contact with a login manages their own WhatsApp consent under Account; their contact record simply mirrors it. The "Who receives what" summary has a WhatsApp line, marking contacts with a login "(own settings)".
- **Email of a contact with a login**: this is the address they sign in with, so it is read-only in the editor and the server refuses to change it. To use a different address, switch off their sign-in and save first.

A contact with a login receives notices by push and by email to that login; a contact without one receives email only. Nobody is sent the same notice twice. A contact who cannot sign in (a PA or the family office, for example) is sent an email-only version of each notice (`contact_email_body`): it keeps the amounts, invoice numbers and due dates, drops the instructions to use the app and the "Open in the app" button, refers to "the family's saved card" rather than "your saved card", and ends by explaining that they are receiving it as a contact of the family and can ask the family for sign-in access or reply to the office. The "Who receives what" summary marks these contacts "(email only)". **Craig to consider:** a Stripe payment link for these emails would let a PA pay without signing in; it is not included yet. Invitation emails name who gave access ("Fatima Al Mansoori has given you access…", or "The Elite Education office…") so they are not mistaken for phishing.

**The main contact.** Every family has exactly one main contact, who must have an email address. The one exception is a family with no email address on file when the migration ran: it starts with no contacts, and the first contact added becomes its main contact, so it needs an email address (the contact editor switches "Main contact" on and explains this). `families.parent_name`, `families.email` and `families.phone` are kept as a mirror of the main contact, so invoices, Stripe, message threads and older versions of the app continue to work unchanged. Editing those fields updates the main contact, and choosing a different main contact updates them.

**Apple private-relay addresses.** A parent who signs in with Apple and hides their email arrives with an address ending `@privaterelay.appleid.com`, and is first given an empty prospect family. The office adds that relay address to the right family as a contact who can sign in: the login moves to that family, the empty prospect family is archived (never deleted), and both the login's owner and the office are told. Only the office can move an existing login between families; if a parent asks to give sign-in access to an address that already has a login elsewhere, nothing is saved, the office is told (a "Contact sign-in to review" notice) and will follow up, and the parent sees one neutral message ("We could not give sign-in access to that email address. The office has been told and will be in touch…"). For discretion, a parent is never told whether an address belongs to another client family or has an account; only the office sees the specific reason. A typing mistake can therefore never bring someone else into the family.

**One family per login email.** A sign-in email address belongs to one family only. The same address may appear in another family as a contact who does not sign in (for example a PA who works for two families).

**Removing access.** Removing a contact who has a login, or switching off their sign-in, removes that login from the family straight away.

Bank details never appear in any notification, email or WhatsApp message; they remain on the invoice in the app.
