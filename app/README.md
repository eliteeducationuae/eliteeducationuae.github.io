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

**Round 4, step 3: every subject.** The app now supports every subject, phase and curriculum, not only mathematics.

1. Run `supabase/migrations/20261007000000_subjects.sql` in the Supabase SQL editor, after the earlier migrations. **Run it before merging**, because the web app deploys automatically on merge and its lesson, overview, report and onboarding screens read the new subject tables straight away. (Only the website has a fallback.)
2. Redeploy the Edge Functions whose wording now uses the lesson's subject:
   `npx supabase functions deploy ai-assist`, `npx supabase functions deploy ics --no-verify-jwt` and `npx supabase functions deploy send-reminders`.
3. Then review each tutor's subjects, curricula and phases under *More → Tutors*. The backfill gives every existing tutor the subject Maths, so until you add their other subjects, role matching will show them as not usually teaching, say, Chemistry.

What the migration does:

- **Enrolments.** Each student now has a list of subjects (an *enrolment* per subject, with its curriculum, level, exam board, tutor and topic list). Students gain an optional phase, and their old single curriculum and syllabus are kept only for older versions of the app.
- **Backfill.** Every existing student receives one Maths enrolment that matches their current syllabus and tutor, so nothing is lost and progress history stays in place. Cambridge Additional Maths (0606) students receive Maths at the *Additional* level, so their existing Maths lessons and reports still match it.
- **New children.** When a family that is already with us adds a child, the office is notified with the child's subjects, since the family is told we will confirm a tutor within one working day.
- **Shared topic lists.** Topics are stored in shared lists for each subject, curriculum and level. A list one tutor builds is reused for every student who studies the same course, and tutors can add topics for the subjects they teach.
- **Reports per subject.** A report round creates one report per active enrolment, written by that enrolment's tutor, so a student with Chemistry and English receives two reports (and Maths IGCSE and Maths A-Level are reported separately). The family's notice names the subject.
- **Test change.** The enquiry acknowledgement email now opens 'Thank you for contacting Elite Education' (formerly 'Thanks…'), so `engagement_test.sql` now checks for a subject beginning 'Thank'.
- **Everything else.** Lessons, services, enquiries and roles record a subject (and phase); tutors list their subjects, curricula and phases; tutor applications record phases; insights split revenue by subject.

The website forms send the new subject and phase fields. If the site goes live before the migration is run, the forms fall back automatically and add the subject and phase to the message, so no enquiry is lost.

**Before families can book lessons,** each tutor sets their weekly hours under *Me → Availability & time off* (or you can do it from *More → Tutors*).

## Checks

```bash
npm run check      # lint + typecheck + unit tests
npm run test:db    # schema, row-level security and billing functions against a local Postgres
```

## Roadmap ideas

- AI worksheets on each student's weak topics
- Two-way Google Calendar sync
- Online booking of trial lessons from eliteeducation.me
- WhatsApp reminders
- Bank-feed import for expenses
