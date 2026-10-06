# Elite Education — launch checklist (App Store and Google Play)

This is the step-by-step route from today to the Elite Education app being live on the App Store and Google Play, well before **1 January**. Tick each box as you go. Everything technical in the repository is already prepared; what remains are the accounts, settings and decisions that only you can make.

Items marked **[Legal review]** need sign-off from your lawyer, and items marked **[Accountant review]** need sign-off from your accountant, before launch.

Nothing in this document is a secret. Never paste a service-role key, Stripe secret key, Apple key or Google service-account file into this repository or into the app. Values shown in angle brackets, such as `<ASC_APP_ID>`, are placeholders for you to fill in **in the place named**, never here.

## Timeline

| Target date | Milestone |
|---|---|
| 15 October | Apple Developer (organisation) enrolment submitted; Google Play Console organisation account created; Expo account ready |
| 31 October | First production-profile builds on EAS; production Supabase checks complete (section 3) |
| **14 November** | **TestFlight build in the hands of tutors**; Google Play internal testing live |
| 24 November | Store listings, screenshots, privacy answers and reviewer account complete |
| **1 December** | **Submitted for App Store review and Google Play production review** |
| 2 to 31 December | Buffer for review questions, fixes and resubmission; go-live on a quiet weekday |
| 1 January (latest) | Families using the store apps |

Apple review usually takes one to three days, and Google Play review for a new organisation account can take up to a week or more. A first submission is often returned once with questions, so the December buffer matters.

---

## 1. Accounts

- [ ] **1.1 D-U-N-S number.** Apple requires one to enrol as an organisation. Check whether the business already has one at [Apple's D-U-N-S lookup](https://developer.apple.com/enroll/duns-lookup/); if not, request it there (free; allow up to two weeks). The legal entity name and address must match the trade licence exactly.
- [ ] **1.2 Apple Developer Program, as an organisation.** Enrol at [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) in the **business's legal name** (not as an individual), so that the App Store shows *Elite Education* (or the legal entity) as the seller. You will need the D-U-N-S number, a website on the business domain (eliteeducation.me), and the authority to bind the company. The annual fee is USD 99. **Allow one to two weeks** for verification, including a possible phone call from Apple. **[Legal review]** confirm which legal entity enrols and is shown as the seller.
- [ ] **1.3 App Store Connect agreements.** After enrolment, accept the *Free Apps* agreement in App Store Connect → *Business*. (The app does not sell digital content through Apple: lessons are a real-world service paid by card through Stripe, which Apple's guideline 3.1.3(e) permits outside in-app purchase.) No paid-apps tax forms are needed unless you later sell through Apple.
- [ ] **1.4 Google Play Console, as an organisation.** Create an account at [play.google.com/console](https://play.google.com/console/signup) choosing **Organisation**, with the D-U-N-S number and business details (one-off fee USD 25). Identity verification can take several days. Organisation accounts are **not** subject to the rule that new personal accounts must run a closed test with 12 testers for 14 days before production.
- [ ] **1.5 Expo account.** Create an organisation (for example `elite-education`) at [expo.dev](https://expo.dev) and invite anyone else who will build. EAS Build's free tier is sufficient to start; the Production plan gives faster builds if you need them.
- [ ] **1.6 Shared mailbox.** Make sure `hello@eliteeducation.me` is monitored: it is the support and privacy contact on the website, in the store listings and in the app.

## 2. EAS setup (builds, updates and submission)

Run these from the `app/` folder on any computer with Node 22. No Mac is required.

- [ ] **2.1 Sign in.** `npx eas-cli@latest login`
- [ ] **2.2 Link the project.** `npx eas-cli@latest init` — this creates the EAS project and writes `extra.eas.projectId` (and the `owner`) into `app.json`. Commit that change. Do not type a project id by hand.
- [ ] **2.3 Configure over-the-air updates.** `npx eas-cli@latest update:configure` — this writes `updates.url` into `app.json` (the `runtimeVersion` policy and the `channel` for each build profile in `eas.json` are already set). Commit the change.
- [ ] **2.4 Credentials.** `npx eas-cli@latest credentials` — let EAS create and store the iOS distribution certificate, provisioning profile and push notification key (APNs), and the Android upload keystore. EAS keeps them; you never need to download them. Keep your Apple ID two-factor device to hand.
- [ ] **2.5 Push notifications.** Confirm the APNs key appears under *Credentials → iOS* on expo.dev. For Android, upload a Firebase Cloud Messaging V1 service-account key under *Credentials → Android → FCM V1* (create the Firebase project in the Google account that owns the Play Console).
- [ ] **2.6 Preview build for your own devices.** `npx eas-cli@latest build --profile preview --platform all` — produces an internal iOS build (register your iPhone when prompted with `npx eas-cli@latest device:create`) and an Android APK you can install directly. Check sign-in, a lesson, a payment in Stripe test mode, homework photos and notifications.
- [ ] **2.7 Production builds.** `npx eas-cli@latest build --profile production --platform all` — store-signed builds. Build numbers are kept by EAS (see section 12) and increase automatically.
- [ ] **2.8 Submit to the stores.** `npx eas-cli@latest submit --profile production --platform ios` and `--platform android`.
  - **iOS:** the first time, EAS asks for your Apple ID and offers to create an App Store Connect API key; accept. It then needs the App Store Connect app id (`<ASC_APP_ID>`, the numeric *Apple ID* shown under App Store Connect → your app → *App Information*) and your Apple Team ID (`<APPLE_TEAM_ID>`, under developer.apple.com → *Membership details*). You may either answer the prompts each time or add them to `eas.json` under `submit.production.ios` as `"ascAppId"` and `"appleTeamId"` — they are identifiers, not secrets, but add them only once you have the real values.
  - **Android:** create a Google Cloud service account with access to the Play Console (Play Console → *Users and permissions* → invite the service account's email with *Release* permissions) and download its JSON key. **Do not commit it.** Upload it to EAS instead (`npx eas-cli@latest credentials` → Android → *Google Service Account*), or keep it outside the repository and point `submit.production.android.serviceAccountKeyPath` at it. Google requires the **very first** Android upload to be made by hand: download the `.aab` from the EAS build page and upload it to *Internal testing* in the Play Console, then use `eas submit` from then on. Submissions go to the **internal** track (set in `eas.json`); you promote them in the Play Console.

## 3. Supabase production checks

Complete these on the production project before the first TestFlight build reaches tutors. Each item is described in full in `README.md`.

- [ ] **3.1 Migrations.** Every file in `supabase/migrations` is applied, in filename order, ending with `20261111000000_round5_merge.sql`, `20261112000000_round5_followups.sql` and the round 6 fix migrations, then `20261113001700_creditnote_fix.sql` and the security audit migrations `20261114000200_sec_db.sql` and `20261114000600_sec_db_families.sql` (README, *Round 5 setup checklist*; use the SQL editor, or `npx supabase db push` only after repairing the migration history). In the app, *Admin → More → System health → Database version* shows `20261114000600` and lists every migration (36).
- [ ] **3.2 Sign in with Apple** is configured in Supabase → Authentication → Providers (Services ID, key, team id and bundle id `me.eliteeducation.app`). **Sign in with Google** is configured with the iOS, Android and web client ids. Test both on a real device. Apple requires Sign in with Apple because Google sign-in is offered; it is already built in.
- [ ] **3.3 Secrets set** (`npx supabase secrets list` shows names only): `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET` (live webhook), `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `HEALTH_ALERT_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDAR_SYNC_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, the six WhatsApp templates (`TWILIO_TEMPLATE_LESSON_REMINDER`, `TWILIO_TEMPLATE_LESSON_NOTES`, `TWILIO_TEMPLATE_HOMEWORK_DUE`, `TWILIO_TEMPLATE_INVOICE_SENT`, `TWILIO_TEMPLATE_INVOICE_OVERDUE`, `TWILIO_TEMPLATE_INVOICE_AUTOPAY`), `CRON_SECRET` (and the same value in Vault for the scheduled calls) and, if used, `ANTHROPIC_API_KEY` and `TURNSTILE_SECRET_KEY`. Optional: `TURNSTILE_ALLOWED_HOSTNAMES` and `CALENDAR_RETURN_URLS`.
- [ ] **3.4 Functions deployed:** `npx supabase functions deploy` (all functions, including `view-as`, `refund-payment`, `invite-accountant`, `delete-account`, `health-check` and `backup-export`; `ics` and, if Turnstile is used, `verify-captcha` with `--no-verify-jwt`).
- [ ] **3.5 Schedules running** (Supabase → *Integrations → Cron*, or the SQL in `README.md`; health-check and backup-export need the legacy service_role key (eyJ…), as for charge-invoice):
  - [ ] `send-notifications` every minute
  - [ ] `send-reminders` hourly
  - [ ] `calendar-sync` every 5 minutes
  - [ ] `charge-invoice` every 15 minutes
  - [ ] `health-check` every 15 minutes (`*/15 * * * *`)
  - [ ] `backup-export` daily at 02:10 UAE (`10 22 * * *`, UTC)
- [ ] **3.6 Point-in-time recovery.** Upgrade to the Pro plan and enable the PITR add-on (Database → Backups), or at minimum confirm daily backups are listed. Test a restore once (README, *Backups and restore*).
- [ ] **3.7 Stripe live mode.** Live webhook with the six events in README *Going live*; Apple Pay domain `eliteeducation.me` verified; customer billing portal configured.
- [ ] **3.8 Authentication emails** use the sign-up code template and come from `hello@eliteeducation.me` (custom SMTP through Resend), so codes do not land in spam.
- [ ] **3.9 System health is green** for 48 hours before submission, and a test alert has reached `HEALTH_ALERT_EMAIL`.
- [ ] **3.10 Secure email change stays on** (Supabase → Authentication → Providers → Email → *Secure email change*), so an email change must be confirmed from both the old and the new address. With *View as*, it is one of the guards that stop an email change being completed on a viewed account; never turn it off.

## 4. App Store Connect listing

Create the app in App Store Connect → *Apps → +* with platform iOS, name **Elite Education**, primary language **English (U.K.)**, bundle id **me.eliteeducation.app** and SKU `elite-education-ios`.

- [ ] **4.1 Name:** Elite Education
- [ ] **4.2 Subtitle** (30 characters maximum): **Private tuition in the UAE** (26)
- [ ] **4.3 Promotional text** (170 maximum; can be changed without a new build):
  > Lessons, homework, progress and invoices for Elite Education families and tutors, in one discreet place. Excellence. Discretion. Results.
- [ ] **4.4 Description:**
  > Elite Education provides discreet, personalised private tuition across the UAE, in every subject, phase and curriculum, from primary through to university entrance. This app brings every part of your child's tuition together in one place.
  >
  > For families
  > • See upcoming lessons at a glance, and request, reschedule or cancel with the cancellation policy shown clearly before you confirm.
  > • Read your tutor's summary after every lesson, together with the topics covered and homework set.
  > • Follow your child's progress in each subject over time, and download progress reports.
  > • Receive invoices in AED and pay securely by card, Apple Pay or Google Pay, with the option of paying automatically.
  > • Message the Elite Education team and your child's tutor, and choose how you are reminded: email, notification or WhatsApp.
  >
  > For students
  > • See your timetable, hand in homework with a photograph or a file, and read your tutor's feedback.
  >
  > For tutors
  > • Record a lesson in a single pass: attendance, topics, ratings, a summary for the family and homework.
  > • Manage your availability, keep your Google Calendar in step, and submit your invoices.
  >
  > Your privacy matters to us. We never sell your data or use it for advertising, and you may download or delete your account at any time from within the app.
  >
  > The app is for families, students and tutors of Elite Education. To arrange a free consultation, please visit eliteeducation.me.
  >
  > Excellence. Discretion. Results.
- [ ] **4.5 Keywords** (100 characters maximum, comma separated, no spaces needed):
  `tutor,tuition,IB,IGCSE,A-Level,GCSE,homework,lessons,Dubai,Abu Dhabi,UAE,maths,revision,progress` (96)
- [ ] **4.6 Category:** Education (primary). Secondary: none, or Productivity.
- [ ] **4.7 Age rating:** complete the questionnaire honestly. The app has no violence, mature themes, gambling or unrestricted web access; it does include **messaging between users** (families, tutors and the office), which Apple asks about. The expected result is **4+** (or 9+ under Apple's updated age ratings). Do **not** enrol in the *Kids* category: the app is used by parents and tutors, and the Kids category forbids sign-in flows of this kind.
- [ ] **4.8 Copyright:** `2026 Elite Education` **[Legal review]** confirm the legal entity name to show.
- [ ] **4.9 URLs:**
  - Support URL: https://eliteeducation.me/support/
  - Marketing URL: https://eliteeducation.me
  - Privacy policy URL: https://eliteeducation.me/privacy/
  - Terms of use (EULA): https://eliteeducation.me/terms/ (enter under *App Information → License Agreement → Custom*, or keep Apple's standard EULA) **[Legal review]**
- [ ] **4.10 Pricing and availability:** Free. Availability: United Arab Emirates (add other countries where you teach families, for example the United Kingdom for families who relocate).
- [ ] **4.11 Content rights:** the app does not show third-party content.

## 5. App Privacy ("nutrition label")

App Store Connect → your app → *App Privacy*. These answers match the privacy manifest in `app.json` (`ios.privacyManifests`) and the privacy policy. **[Legal review]** confirm against the final privacy policy.

- [ ] **5.1 Do you or your third-party partners collect data from this app?** Yes.
- [ ] **5.2 Tracking:** No data is used to track people. No tracking domains. No advertising.
- [ ] **5.3 Data types collected.** For **every** type below: *Linked to the user's identity:* **Yes**. *Used for tracking:* **No**. *Purpose:* **App functionality** only.

| Apple category | Data type | What it is in Elite Education |
|---|---|---|
| Contact info | Name | Parent, student and tutor names |
| Contact info | Email address | Sign-in and notifications |
| Contact info | Phone number | Optional, for WhatsApp reminders and the office |
| Identifiers | User ID | The account identifier |
| Purchases | Purchase history | Lesson invoices and payments (cards are handled by Stripe; the app never sees card numbers) |
| User content | Photos or videos | Homework and classwork photographs |
| User content | Other user content | Messages, homework hand-ins, lesson notes |
| Diagnostics | Crash data | The in-house error log (`app_errors`), with personal details removed |
| Diagnostics | Other diagnostic data | The same error log: screen, app version and platform |

- [ ] **5.4 Not collected:** location, contacts, health, financial information (card numbers stay with Stripe), browsing history, search history, audio, advertising data, sensitive information. **[Legal review]** tutors' police clearance and vetting documents are collected through the office's onboarding, not through the public app listing; confirm whether they should be declared as *Sensitive info* if tutors upload them in the app.

## 6. Screenshots and artwork

Use **demo data only** (`EXPO_PUBLIC_DEMO=1`), never real families, students or tutors. Show the light theme, with the Noir and Champagne branding.

- [ ] **6.1 iPhone 6.9-inch** (1320 × 2868 portrait) — required; or 6.7-inch (1290 × 2796). Apple scales these down for smaller iPhones.
- [ ] **6.2 iPad 13-inch** (2064 × 2752 portrait) — required, because the app supports iPad (`supportsTablet: true`).
- [ ] **6.3 Google Play phone screenshots:** at least two, minimum 1080 × 1920 portrait (up to eight).
- [ ] **6.4 Google Play feature graphic:** 1024 × 500 PNG or JPEG, Noir background, white logo, no small text.
- [ ] **6.5 Google Play app icon:** 512 × 512 PNG (from `assets/images/icon.png`).
- [ ] **6.6 Suggested screenshots (three to six):**
  1. Parent home: upcoming lessons and the latest lesson summary — caption *Every lesson, at a glance.*
  2. Child progress heatmap — *Progress you can see, subject by subject.*
  3. Lesson summary and homework — *A considered summary after every lesson.*
  4. Invoice with Apple Pay — *Invoices in AED, paid securely.*
  5. Tutor's lesson record — *Tutors record a lesson in a single pass.*
  6. Calendar week view — *Scheduling, beautifully organised.*

  Captions in Georgia, body in Calibri, Noir and Champagne only; logo white on dark, black on light, never recoloured.

## 7. App Review information (Apple)

- [ ] **7.1 Reviewer account.** In **production**, create a dedicated parent account (for example `appreview@eliteeducation.me`) with a password sign-in or a mailbox you can read, linked to a sample family with one sample child, a few past lessons with notes, one upcoming lesson, homework and a paid and an unpaid invoice. Use invented names. Keep it for every future review and exclude it from reports.
- [ ] **7.2 Review notes** (App Store Connect → *App Review Information*):
  > Elite Education is a private tutoring company in the UAE. This app is for our families, students and tutors. Families pay for real-world tutoring lessons by card through Stripe (guideline 3.1.3(e)); no digital content is sold.
  >
  > Sign in with the demo account: <reviewer email> / <reviewer password>. The account belongs to a sample family with sample data.
  >
  > Sign in with Apple and Sign in with Google are both offered on the sign-in screen.
  >
  > Account deletion: Account → Your data and privacy → Delete my account. Personal details are removed; invoices are kept in anonymised form because UAE tax law requires us to retain them.
  >
  > Notifications and WhatsApp reminders are opt-in.
- [ ] **7.3 Account deletion (guideline 5.1.1(v)).** Confirm on the TestFlight build that *Account → Your data and privacy → Delete my account* closes the account without needing to contact the office, and that *Download my data* works. **[Legal review]** the wording of what is kept and why.
- [ ] **7.4 Sign in with Apple (guideline 4.8).** Required because Google sign-in is offered; already implemented. Check that "Hide my email" addresses still receive notifications (Apple's private relay requires your sending domain to be registered under *Certificates, Identifiers & Profiles → Services → Sign in with Apple for Email Communication*; add `eliteeducation.me` and the Resend sending address).
- [ ] **7.5 Export compliance.** The app uses only standard HTTPS encryption, so `ITSAppUsesNonExemptEncryption` is already `false` in `app.json`; App Store Connect will not ask each time.

## 8. TestFlight for tutors

- [ ] **8.1 Internal testing** (up to 100 people with App Store Connect roles; no review): add yourself and the office team, and install every new build here first.
- [ ] **8.2 External testing for tutors** (up to 10,000 testers): create a group *Tutors*, add their email addresses or share a public link, and write the *What to test* notes. The **first build sent to external testers needs Beta App Review** (usually a day); later builds of the same version usually do not.
- [ ] **8.3 Tutor briefing.** Send tutors a short note: install TestFlight, accept the invitation, sign in with the email the office holds for them, and report anything unclear to `hello@eliteeducation.me`. TestFlight builds expire after 90 days.
- [ ] **8.4 Feedback loop.** Fix issues, publish small fixes as over-the-air updates on the `production` channel where possible (section 13), and new builds where native changes are needed.

## 9. Google Play listing

- [ ] **9.1 App name:** Elite Education. **Default language:** English (United Kingdom).
- [ ] **9.2 Short description** (80 characters maximum): **Lessons, homework, progress and invoices for Elite Education families.** (70)
- [ ] **9.3 Full description:** reuse the App Store description in 4.4 (4,000 characters maximum).
- [ ] **9.4 Category:** Education. **Contact details:** `hello@eliteeducation.me`, website https://eliteeducation.me, privacy policy https://eliteeducation.me/privacy/.
- [ ] **9.5 Data safety form.** Declare the same data as section 5: name, email address, phone number, user ID, purchase history, photos, other user-generated content (messages, homework), crash logs and diagnostics. For each: *collected*, *not shared* with third parties for their own purposes (service providers processing on our behalf do not count as sharing), *not optional* except phone number and photos, *processed for app functionality and account management*. Data is **encrypted in transit**, and users **can request deletion** (in the app, and by email). **[Legal review]**
- [ ] **9.6 Target audience and content.** The app is used by parents, tutors and their students, some of whom are under 18. Choose the target age groups honestly (for example 13–15, 16–17 and 18+ if students sign in themselves). If you include under-13s, the app falls under Google's **Families Policy** (no ads, which we meet; teacher-approved programme optional) — accounts for younger children are created by their parents. **[Legal review]** decide which age groups to declare.
- [ ] **9.7 Content rating:** complete the IARC questionnaire (Education; users can communicate with each other; no violence or mature content).
- [ ] **9.8 App access:** provide the same reviewer account as 7.1, with the note that all features are behind sign-in.
- [ ] **9.9 Ads:** No ads. **Government app:** No. **Financial features:** none (payments are for tutoring services via Stripe). **Health:** none.
- [ ] **9.10 Testing tracks:** *Internal testing* first (office and tutors, up to 100), then *Closed testing* for a few trusted families if you wish, then *Production*. As an organisation account, there is no mandatory 12-tester, 14-day closed test.
- [ ] **9.11 Production release:** promote the tested build from internal to production with a staged rollout (for example 20%, then 100%).

## 10. Website pages (already live with the site)

- [ ] **10.1** https://eliteeducation.me/privacy/ — privacy policy. **Currently marked "Draft for legal review — not yet in force".** **[Legal review]** confirm every point listed in the comment at the top of `privacy/index.html`, then remove the draft notice.
- [ ] **10.2** https://eliteeducation.me/terms/ — terms of service. Same draft notice. **[Legal review]**, plus **[Accountant review]** for the invoices, VAT and retention paragraphs.
- [ ] **10.3** https://eliteeducation.me/support/ — support page with contact details, response times and how to delete your account or download your data.

## 11. Legal and accountant sign-off

- [ ] **11.1 [Legal review]** Privacy policy against UAE PDPL (Federal Decree-Law No. 45 of 2021), including children's data, parental consent, cross-border transfers and the processor list. **Before the policy goes live, confirm the two retention promises in section 10:** enquiries that do not lead to lessons deleted after 24 months, and unsuccessful tutor applications after 12 months. The app does not yet delete these automatically, so either the office clears them by hand each quarter (Admin → Enquiries and Applications), an automatic clear-out is added before launch, or the wording is changed.
- [ ] **11.2 [Legal review]** Terms of service, including tutors' status as independent contractors, liability and governing law (UAE, Dubai courts).
- [ ] **11.3 [Accountant review]** Retention period for invoices, credit notes and payment records under UAE VAT law (the app keeps them, anonymised, when an account is closed; the policy currently says five years), and whether the bill-to surname must be retained on tax invoices.
- [ ] **11.4 [Legal review]** The data processing terms of Supabase, Stripe, Resend, Twilio, Google, Apple, Expo and Anthropic are accepted under the business account.
- [ ] **11.5 [Legal review]** Safeguarding wording and the vetting process described to families.

## 12. Version and build numbering

- **Version** (`version` in `app.json`, shown in the stores) is **1.0.0** for launch. Raise it for each store release that families will notice: `1.0.1` for fixes, `1.1.0` for new features.
- **Build numbers** (`ios.buildNumber`, `android.versionCode`) are kept by **EAS on its servers** (`appVersionSource: "remote"` in `eas.json`), and the production profile increases them automatically on every build. The values `1` in `app.json` are only the starting point; you never need to edit them. To see or set them: `npx eas-cli@latest build:version:get` and `build:version:set`.
- **Runtime version** follows the app version (`runtimeVersion.policy: "appVersion"`), so an over-the-air update only reaches builds of the same version. Whenever a change needs a new native build (a new native package, a permission, an icon), raise `version` so that old builds do not receive an incompatible update.

## 13. Over-the-air updates

JavaScript-only changes (screens, wording, fixes) can reach installed apps without store review, through EAS Update. Each build profile listens to its own channel: `development`, `preview` and `production`.

- Publish a fix to everyone on the current version: `npx eas-cli@latest update --channel production --message "Fix the invoice total on iPad"`
- Try it first on your own preview build: `npx eas-cli@latest update --channel preview --message "…"`
- The app checks for an update each time it starts and applies it on the next launch (`checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`, so start-up is never delayed).
- Apple permits updates that fix bugs or adjust content; anything that changes what the app is for must go through review.
- The web app at eliteeducation.me/app updates automatically when `main` is deployed.

## 14. Go-live day runbook

Choose a quiet weekday morning (UAE time), not a Friday, and not the day before a public holiday.

- [ ] 1. Morning: *Admin → More → System health* is green; the latest nightly backup is under 26 hours old.
- [ ] 2. Database migrations are applied and *Database version* shows the newest one.
- [ ] 3. In App Store Connect, release the approved version (choose *Manually release this version* when submitting, so you control the moment).
- [ ] 4. In the Play Console, start the production rollout at 20%.
- [ ] 5. Install from the public App Store and Google Play on your own phones; sign in as yourself and as the reviewer family; open a lesson, an invoice and messages.
- [ ] 6. Send families the welcome email (formal, brief, with store links and the sign-in steps). Tutors already have TestFlight; ask them to install the store version.
- [ ] 7. Watch *System health*, the Stripe dashboard and the `hello@` mailbox through the day.
- [ ] 8. After 48 calm hours, move the Google Play rollout to 100%.

## 15. Rollback plan

- **A JavaScript bug after an over-the-air update:** republish the previous update to the channel with `npx eas-cli@latest update:republish --channel production` (choose the last good update), or `npx eas-cli@latest update:rollback`. Installed apps pick it up on their next start.
- **A bug in a store build:** in App Store Connect, if the version is still in *Pending Developer Release*, do not release it. If it is live, fix it with an over-the-air update where possible; otherwise submit a new build and request an **expedited review** (developer.apple.com/contact/app-store/?topic=expedite). In the Play Console, **halt the staged rollout**, then promote a fixed build.
- **A database problem:** stop the cause first (pause the relevant cron job), then restore using point-in-time recovery, or restore a single table from the nightly JSON backup into a scratch schema and copy back only the affected rows (README, *Backups and restore*).
- **Card payments misbehaving:** pause the `charge-invoice` schedule; families can still pay invoices by hand; refund from the Stripe dashboard if needed.
- **Fallback for everyone:** the web app at https://eliteeducation.me/app keeps working throughout, and can be redeployed from any earlier commit with *Actions → Deploy site and web app → Run workflow*.
