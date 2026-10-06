import type { AdmissionsCase } from '@/domain/admissions';
import { closesOwnLoginOnly, LAST_ADMIN_MESSAGE, last4 } from '@/domain/data-rights';
import { worstStatus } from '@/domain/system-health';
import type {
  AppErrorInput,
  AppErrorRow,
  DataExport,
  DeletionRequest,
  DeletionSummary,
  FunctionErrorRow,
  HealthCheck,
  HealthJob,
  MigrationRecord,
  Profile,
  SystemHealth,
} from '@/domain/types';

import { adm, removeAdmissionsForStudents } from './admissions';
import { eraseAudit } from './audit';
import { cw } from './classwork';
import { allContacts, listFamilyContacts, syncPrimaryFromFamily } from './contacts';
import { enr, newId, q, requireAdmin, type DemoDB } from './db';
import { eq } from './engagement';
import { ops } from './operations';

/**
 * Demo versions of the launch-readiness functions: log_app_error, system_health, export_my_data, the
 * delete-account Edge Function and the admin deletion request functions. Demo databases saved before this
 * feature lack the new lists, so every one is created on first use.
 */

/** Most app errors the demo keeps (the newest are kept). */
export const APP_ERROR_CAP = 200;

/** Every migration the app ships with, oldest first. */
export const KNOWN_MIGRATIONS: MigrationRecord[] = [
  { version: '20261002000000', name: 'init' },
  { version: '20261003000000', name: 'auto_link_logins' },
  { version: '20261004000000', name: 'engagement' },
  { version: '20261005000000', name: 'operations' },
  { version: '20261006000000', name: 'social_sign_in' },
  { version: '20261007000000', name: 'subjects' },
  { version: '20261008000000', name: 'homework' },
  { version: '20261009000000', name: 'calendar' },
  { version: '20261010000000', name: 'payments' },
  { version: '20261011000000', name: 'whatsapp' },
  { version: '20261012000000', name: 'invoice_notifications' },
  { version: '20261012010000', name: 'classwork_security' },
  { version: '20261013000000', name: 'review_fixes' },
  { version: '20261014000000', name: 'round4_qa_fixes' },
  { version: '20261101000000', name: 'viewas' },
  { version: '20261102000000', name: 'rates' },
  { version: '20261103000000', name: 'contacts' },
  { version: '20261104000000', name: 'audit' },
  { version: '20261105000000', name: 'tax' },
  { version: '20261106000000', name: 'admissions' },
  { version: '20261107000000', name: 'vetting' },
  { version: '20261108000000', name: 'launch' },
  { version: '20261109000000', name: 'spam' },
  { version: '20261110000000', name: 'handover' },
  { version: '20261111000000', name: 'round5_merge' },
  { version: '20261112000000', name: 'round5_followups' },
  { version: '20261113000800', name: 'launch_fix' },
  { version: '20261113001100', name: 'copy_fix' },
  { version: '20261113001200', name: 'tutorpay_fix' },
  { version: '20261113001300', name: 'handoverac_fix' },
  { version: '20261113001400', name: 'contactdel_fix' },
  { version: '20261113001500', name: 'secminor_fix' },
  { version: '20261113001600', name: 'deletion_fix' },
  { version: '20261113001700', name: 'creditnote_fix' },
  { version: '20261114000100', name: 'qa_award' },
];

const appErrorsOf = (db: DemoDB) => (db.appErrors ??= []);
const functionErrorsOf = (db: DemoDB) => (db.functionErrors ??= []);
const requestsOf = (db: DemoDB) => (db.deletionRequests ??= []);

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Error reporting and system health
// ---------------------------------------------------------------------------

/** Mirrors log_app_error: anyone may record an error; only the newest APP_ERROR_CAP are kept in the demo. */
export function logAppError(db: DemoDB, viewer: Profile | null, e: AppErrorInput, now = new Date()): boolean {
  const list = appErrorsOf(db);
  list.push({
    id: newId('err'),
    createdAt: now.toISOString(),
    profileId: viewer?.id,
    role: viewer?.role,
    platform: e.platform,
    appVersion: e.appVersion,
    route: e.route?.slice(0, 200),
    source: e.source,
    message: e.message.slice(0, 2000) || 'Unknown error',
    stack: e.stack?.slice(0, 8000),
    fingerprint: e.fingerprint,
  });
  if (list.length > APP_ERROR_CAP) list.splice(0, list.length - APP_ERROR_CAP);
  return true;
}

export function appErrors(db: DemoDB, viewer: Profile, limit = 50): AppErrorRow[] {
  requireAdmin(viewer);
  return [...appErrorsOf(db)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export function functionErrors(db: DemoDB, viewer: Profile, limit = 50): FunctionErrorRow[] {
  requireAdmin(viewer);
  return [...functionErrorsOf(db)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Mirrors system_health: the same eight checks, worked out from the demo database. */
export function systemHealth(db: DemoDB, viewer: Profile, now = new Date()): SystemHealth {
  requireAdmin(viewer);
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const recentAppErrors = appErrorsOf(db).filter((e) => e.createdAt >= dayAgo).length;
  const recentServerErrors = functionErrorsOf(db).filter((e) => e.createdAt >= dayAgo).length;
  const queued = (db.outbox ?? []).length;
  const optedIn = db.profiles.filter((p) => p.whatsappOptIn).length;
  const calendarErrors = (db.calendarConnections ?? []).filter((c) => c.status === 'error').length;
  const calendarLinks = (db.calendarConnections ?? []).length;
  const autopayFailed = db.invoices.filter((i) => i.autopayStatus === 'failed').length;
  const autopayUnknown = db.invoices.filter((i) => i.autopayStatus === 'unknown').length;

  const checks: HealthCheck[] = [
    {
      key: 'notifications',
      label: 'Emails and push notifications',
      status: 'ok',
      detail: queued
        ? `${plural(queued, 'office notification')} recorded in the demo; in production they are sent within a minute.`
        : 'No notifications are waiting to be sent.',
      count: queued,
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp messages',
      status: 'ok',
      detail: optedIn
        ? `${plural(optedIn, 'person has', 'people have')} asked for WhatsApp reminders. The demo does not send messages.`
        : 'Nobody has asked for WhatsApp reminders yet.',
      count: optedIn,
    },
    {
      key: 'calendar',
      label: 'Google Calendar sync',
      status: calendarErrors ? 'warning' : 'ok',
      detail: calendarErrors
        ? `${plural(calendarErrors, 'calendar link needs', 'calendar links need')} to be reconnected.`
        : calendarLinks
          ? `${plural(calendarLinks, 'calendar is', 'calendars are')} connected and up to date.`
          : 'No Google calendars are connected yet.',
      count: calendarErrors,
    },
    {
      key: 'autopay',
      label: 'Automatic card payments',
      status: autopayFailed || autopayUnknown ? 'warning' : 'ok',
      detail:
        autopayFailed || autopayUnknown
          ? `${plural(autopayFailed + autopayUnknown, 'automatic payment needs', 'automatic payments need')} checking.`
          : 'Every automatic payment has completed.',
      count: autopayFailed + autopayUnknown,
    },
    { key: 'stripe', label: 'Stripe payments', status: 'ok', detail: 'Card payments are simulated in the demo, so there is nothing to check.', count: 0 },
    {
      key: 'server-errors',
      label: 'Server errors',
      status: recentServerErrors ? 'warning' : 'ok',
      detail: recentServerErrors
        ? `${plural(recentServerErrors, 'server error was', 'server errors were')} recorded in the last 24 hours.`
        : 'No server errors in the last 24 hours.',
      count: recentServerErrors,
    },
    {
      key: 'app-errors',
      label: 'App errors',
      status: recentAppErrors ? 'warning' : 'ok',
      detail: recentAppErrors
        ? `${plural(recentAppErrors, 'app error was', 'app errors were')} reported in the last 24 hours.`
        : 'No app errors have been reported in the last 24 hours.',
      count: recentAppErrors,
    },
    {
      key: 'backups',
      label: 'Nightly backups',
      status: 'ok',
      detail: 'The demo keeps its data on this device. In production, daily backups are checked here.',
      count: 0,
    },
  ];
  const jobs: HealthJob[] = [
    { name: 'send-notifications', lastStartedAt: minutesAgo(now, 1), lastSucceededAt: minutesAgo(now, 1) },
    { name: 'send-reminders', lastStartedAt: minutesAgo(now, 12), lastSucceededAt: minutesAgo(now, 12) },
    { name: 'calendar-sync', lastStartedAt: minutesAgo(now, 9), lastSucceededAt: minutesAgo(now, 9) },
    { name: 'charge-invoice', lastStartedAt: minutesAgo(now, 55), lastSucceededAt: minutesAgo(now, 55) },
    { name: 'purge-app-errors', lastStartedAt: minutesAgo(now, 60 * 7), lastSucceededAt: minutesAgo(now, 60 * 7) },
  ];
  const migrations = KNOWN_MIGRATIONS.map((m, i) => ({ ...m, appliedAt: minutesAgo(now, (KNOWN_MIGRATIONS.length - i) * 60 * 24) }));
  const latest = migrations[migrations.length - 1];
  return {
    checkedAt: now.toISOString(),
    status: worstStatus(checks.map((c) => c.status)),
    checks,
    jobs,
    database: { latest: latest.version, latestName: latest.name, count: migrations.length, migrations },
  };
}

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

/** Mirrors export_my_data: the signed-in person's own records, never other families' or private tutor notes. */
export function exportMyData(db: DemoDB, viewer: Profile, now = new Date()): DataExport {
  const me = db.profiles.find((p) => p.id === viewer.id) ?? viewer;
  const account = {
    id: me.id,
    role: me.role,
    fullName: me.fullName,
    email: me.email,
    phone: me.phone ?? null,
    whatsappOptIn: !!me.whatsappOptIn,
    whatsappNumber: me.whatsappNumber ?? null,
  };
  const empty = {
    students: [] as unknown[],
    enrolments: [] as unknown[],
    lessons: [] as unknown[],
    lessonNotes: [] as unknown[],
    homework: [] as unknown[],
    homeworkSubmissions: [] as unknown[],
    reports: [] as unknown[],
    invoices: [] as unknown[],
    payments: [] as unknown[],
    packages: [] as unknown[],
    messages: [] as unknown[],
    lessonRequests: [] as unknown[],
    availability: [] as unknown[],
    tutorInvoices: [] as unknown[],
    // Round 5 (as the round 5 merge's export_my_data).
    familyContacts: [] as unknown[],
    creditNotes: [] as unknown[],
    refunds: [] as unknown[],
    admissions: [] as unknown[],
    tutorDocuments: [] as unknown[],
    handbookAcknowledgements: [] as unknown[],
    // The rest of the round 5 records (as 20261113000800_launch_fix's export_my_data).
    agreedPrices: [] as unknown[],
    lessonPlans: [] as unknown[],
    tutorPay: [] as unknown[],
    handovers: [] as unknown[],
    vettingOverrides: [] as unknown[],
    accountantInvitation: null as unknown,
  };
  const base: DataExport = {
    format: 'elite-education-export/1',
    exportedAt: now.toISOString(),
    account,
    family: null,
    tutor: null,
    paymentDetails: null,
    ...empty,
  };
  const allLessons = q.lessons(db, viewer, '0000', '9999');

  if (viewer.role === 'parent' || viewer.role === 'student') {
    const students = q.students(db, viewer);
    const invoices = viewer.role === 'parent' ? q.invoices(db, viewer) : [];
    const family = viewer.role === 'parent' ? (db.families.find((f) => f.id === viewer.familyId) ?? null) : null;
    const sids = new Set(students.map((st) => st.id));
    const lessonStart = new Map(db.lessons.map((l) => [l.id, l.start]));
    // Seeded on first use, as the Admissions screens do.
    const ad = adm.store(db);
    return {
      ...base,
      family: family
        ? {
            id: family.id,
            name: family.name,
            parentName: family.parentName,
            email: family.email,
            phone: family.phone ?? null,
            status: family.status ?? 'active',
            autopay: !!family.autopay,
            savedCard: family.savedCard ? { brand: family.savedCard.brand, last4: family.savedCard.last4 } : null,
          }
        : null,
      students,
      enrolments: enr.enrolments(db, viewer),
      lessons: allLessons,
      lessonNotes: q.notes(db, viewer),
      homework: q.homework(db, viewer),
      homeworkSubmissions: cw.submissions(db, viewer),
      reports: ops.reports(db, viewer),
      invoices,
      payments: invoices.flatMap((i) => i.payments),
      packages: viewer.role === 'parent' ? q.packages(db, viewer) : [],
      messages: viewer.familyId ? eq.messages(db, viewer, viewer.familyId) : db.messages.filter((m) => m.senderId === viewer.id),
      lessonRequests: viewer.role === 'parent' ? eq.requests(db, viewer) : [],
      familyContacts: viewer.role === 'parent' && viewer.familyId ? allContacts(db).filter((c) => c.familyId === viewer.familyId) : [],
      creditNotes: viewer.role === 'parent' ? (db.creditNotes ?? []).filter((n) => n.familyId === viewer.familyId) : [],
      refunds: viewer.role === 'parent' ? (db.refunds ?? []).filter((r) => r.familyId === viewer.familyId).map(({ requestKey: _key, ...r }) => r) : [],
      // Admissions advisory as the family sees it: shortlist, key dates, tasks, updates, shared documents and timeline.
      admissions: ad.cases
        .filter((c) => sids.has(c.studentId))
        .map((c) => ({
          studentId: c.studentId,
          kind: c.kind,
          title: c.title,
          entryYear: c.entryYear ?? null,
          status: c.status,
          summary: c.summary ?? null,
          shortlist: ad.targets
            .filter((t) => t.caseId === c.id)
            .map((t) => ({ institution: t.institution, country: t.country ?? null, programme: t.programme ?? null, entryYear: t.entryYear ?? null, status: t.status, decisionDate: t.decisionDate ?? null })),
          keyDates: ad.dates.filter((d) => d.caseId === c.id).map((d) => ({ title: d.title, kind: d.kind, dueOn: d.dueOn, time: d.time ?? null, done: d.done })),
          tasks: ad.tasks.filter((k) => k.caseId === c.id).map((k) => ({ title: k.title, details: k.details ?? null, dueOn: k.dueOn ?? null, owner: k.owner, doneAt: k.doneAt ?? null })),
          updates: ad.updates
            .filter((u) => u.caseId === c.id && u.status === 'published')
            .map((u) => ({ title: u.title, period: u.period ?? null, body: u.body, publishedAt: u.publishedAt ?? null })),
          documents: ad.documents
            .filter((d) => d.caseId === c.id && (d.familyVisible || d.uploadedBy === viewer.id))
            .map((d) => ({ name: d.name, category: d.category, addedAt: d.createdAt })),
          timeline: ad.events.filter((e) => e.caseId === c.id && e.familyVisible).map((e) => ({ at: e.at, title: e.title, detail: e.detail ?? null })),
        })),
      agreedPrices:
        viewer.role === 'parent'
          ? db.enrolments
              .filter((e) => sids.has(e.studentId) && e.familyPrice !== undefined)
              .map((e) => ({ studentId: e.studentId, subject: e.subject, hourlyPrice: e.familyPrice }))
          : [],
      // Plans shared with the family, with homework planned for everyone or for its own children.
      lessonPlans: (db.lessonPlans ?? [])
        .filter((p) => p.sharedWithFamily && db.lessons.some((l) => l.id === p.lessonId && l.studentIds.some((id) => sids.has(id))))
        .map((p) => ({
          lessonId: p.lessonId,
          lessonStart: lessonStart.get(p.lessonId) ?? null,
          objectives: p.objectives,
          homework: p.homework.filter((h) => !h.studentId || sids.has(h.studentId)),
          updatedAt: p.updatedAt,
        })),
    };
  }

  if (viewer.tutorId) {
    const tutor = db.tutors.find((t) => t.id === viewer.tutorId) ?? null;
    const details = db.paymentDetails.find((p) => p.tutorId === viewer.tutorId);
    return {
      ...base,
      tutor: tutor as unknown as Record<string, unknown> | null,
      lessons: allLessons.filter((l) => l.tutorId === viewer.tutorId),
      availability: db.availability.filter((a) => a.tutorId === viewer.tutorId),
      tutorInvoices: db.tutorInvoices.filter((i) => i.tutorId === viewer.tutorId),
      // Bank details never leave the server in full: the account number is reduced to its last four digits.
      paymentDetails: details ? { accountName: details.accountName, bankName: details.bankName, ibanLast4: last4(details.iban) } : null,
      messages: db.messages.filter((m) => m.senderId === viewer.id),
      tutorDocuments: (db.tutorDocuments ?? [])
        .filter((d) => d.tutorId === viewer.tutorId)
        .map((d) => ({ type: d.type, title: d.title, fileName: d.fileName, issueDate: d.issueDate, expiryDate: d.expiryDate, status: d.status })),
      handbookAcknowledgements: (db.handbookAcks ?? []).filter((a) => a.tutorId === viewer.tutorId),
      lessonPlans: (db.lessonPlans ?? [])
        .filter((p) => db.lessons.some((l) => l.id === p.lessonId && l.tutorId === viewer.tutorId))
        .map((p) => ({
          lessonId: p.lessonId,
          lessonStart: db.lessons.find((l) => l.id === p.lessonId)?.start ?? null,
          objectives: p.objectives,
          homework: p.homework,
          sharedWithFamily: p.sharedWithFamily,
          updatedAt: p.updatedAt,
        })),
      tutorPay: db.enrolments
        .filter((e) => e.tutorId === viewer.tutorId && e.tutorPay !== undefined)
        .map((e) => ({ subject: e.subject, studentId: e.studentId, hourlyPay: e.tutorPay })),
      handovers: (db.handovers ?? [])
        .filter((h) => h.toTutorId === viewer.tutorId || h.fromTutorId === viewer.tutorId)
        .map((h) => ({
          createdAt: h.createdAt,
          reason: h.reason,
          studentName: h.studentName ?? null,
          subject: h.subject ?? null,
          direction: h.toTutorId === viewer.tutorId ? 'received' : 'written',
          note: h.note ?? null,
        })),
      vettingOverrides: (db.vettingOverrides ?? [])
        .filter((o) => o.tutorId === viewer.tutorId)
        .map((o) => ({ reason: o.reason, createdAt: o.createdAt, expiresAt: o.expiresAt, revokedAt: o.revokedAt ?? null })),
    };
  }
  if (viewer.role === 'accountant') {
    const invite = (db.accountantInvites ?? []).find((i) => i.email === me.email.toLowerCase());
    return {
      ...base,
      accountantInvitation: invite ? { fullName: invite.fullName ?? null, email: invite.email, invitedAt: invite.invitedAt, acceptedAt: invite.acceptedAt ?? null } : null,
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Account deletion (mirrors the delete-account Edge Function)
// ---------------------------------------------------------------------------

const placeholderEmail = (kind: string, id: string) => `deleted-${kind}-${id}@deleted.eliteeducation.me`;

function isFuture(start: string, now: Date) {
  return start > now.toISOString();
}

/** Removes a family's personal data. Invoices, payments and charges are kept for the period UAE law requires. */
function anonymiseFamily(db: DemoDB, familyId: string, now: Date): DeletionSummary {
  const family = db.families.find((f) => f.id === familyId);
  if (!family) throw new Error('Family not found');
  const studentIds = new Set(db.students.filter((s) => s.familyId === familyId).map((s) => s.id));

  // As on the server, the surname stays as the bill-to name on the invoices that are kept.
  family.parentName = family.name;
  family.email = placeholderEmail('family', familyId);
  delete family.phone;
  family.status = 'archived';
  family.autopay = false;
  delete family.savedCard;
  family.deletedAt = family.deletedAt ?? now.toISOString();

  for (const s of db.students) {
    if (!studentIds.has(s.id)) continue;
    s.fullName = 'Former student';
    for (const k of ['school', 'yearGroup', 'currentGrade', 'targetGrade', 'examDate', 'notes', 'phase'] as const) delete s[k];
    s.deletedAt = s.deletedAt ?? now.toISOString();
  }

  let cancelled = 0;
  for (const l of db.lessons) {
    if (l.status !== 'scheduled' || !isFuture(l.start, now) || !l.studentIds.some((id) => studentIds.has(id))) continue;
    const others = l.studentIds.filter((id) => !studentIds.has(id));
    if (others.length) {
      // A group lesson goes ahead for the other students.
      l.studentIds = others;
    } else {
      l.status = 'cancelled';
      l.cancelledAt = now.toISOString();
      l.cancelReason = 'Account closed';
    }
    cancelled += 1;
  }

  const homeworkIds = new Set(db.homework.filter((h) => studentIds.has(h.studentId)).map((h) => h.id));
  db.homework = db.homework.filter((h) => !homeworkIds.has(h.id));
  db.submissions = db.submissions.filter((s) => !homeworkIds.has(s.homeworkId) && !studentIds.has(s.studentId));
  const soleLessons = new Set(db.lessons.filter((l) => l.studentIds.length && l.studentIds.every((id) => studentIds.has(id))).map((l) => l.id));
  db.notes = db.notes.filter((n) => !soleLessons.has(n.lessonId));
  // Lessons keep their date, tutor and status for invoicing; the address, meeting link and the children's attendance go.
  const touched = new Set<string>();
  for (const l of db.lessons) {
    if (!l.studentIds.some((id) => studentIds.has(id))) continue;
    touched.add(l.id);
    delete l.address;
    delete l.meetingUrl;
  }
  for (const n of db.notes) {
    if (!touched.has(n.lessonId)) continue;
    for (const id of studentIds) delete n.attendance[id];
  }
  for (const o of db.opportunities) {
    if (!o.studentId || !studentIds.has(o.studentId)) continue;
    delete o.studentId;
    delete o.description;
    delete o.location;
    // Titles often name the child, so they are replaced with a neutral one.
    o.title = `${o.subject || 'Tuition'} opportunity (closed)`;
    if (o.status === 'open') o.status = 'closed';
  }
  // Round 5 records (as the round 5 merge's anonymise_* wrappers): admissions cases, handover packs, lesson plans for
  // the children's own lessons (and homework planned for them elsewhere), other contacts and billing details.
  removeAdmissionsForStudents(db, studentIds);
  db.handovers = (db.handovers ?? []).filter((h) => !studentIds.has(h.studentId));
  db.lessonPlans = (db.lessonPlans ?? [])
    .filter((p) => !soleLessons.has(p.lessonId))
    .map((p) => ({ ...p, homework: p.homework.filter((h) => !h.studentId || !studentIds.has(h.studentId)) }));
  syncPrimaryFromFamily(db, family);
  db.familyContacts = allContacts(db)
    .filter((c) => c.familyId !== familyId || c.isPrimary)
    .map((c) =>
      c.familyId === familyId
        ? { ...c, phone: undefined, canLogIn: false, receivesInvoices: false, receivesReports: false, receivesLessonNotes: false, receivesWhatsApp: false, emergencyContact: false }
        : c,
    );
  delete family.billingName;
  delete family.billingAddress;
  delete family.trn;
  db.messages = db.messages.filter((m) => m.familyId !== familyId);
  db.requests = db.requests.filter((r) => r.familyId !== familyId);
  for (const reads of Object.values(db.reads)) delete reads[familyId];

  // Logins for the parent and the children go.
  const closing = db.profiles.filter((p) => p.role !== 'admin' && (p.familyId === familyId || (!!p.studentId && studentIds.has(p.studentId))));
  for (const p of closing) forgetActorName(db, p, () => false);
  db.profiles = db.profiles.filter((p) => !closing.includes(p));
  // The audit log keeps that each change happened, without the family's names, contact details or free text.
  eraseAudit(db, { familyIds: [familyId], studentIds: [...studentIds], profileIds: closing.map((p) => p.id) });

  // Invoices, credit notes, payments and refunds are kept for the period UAE law requires.
  const invoices = db.invoices.filter((i) => i.familyId === familyId);
  return {
    role: 'parent',
    familyAnonymised: true,
    studentsAnonymised: studentIds.size,
    futureLessonsCancelled: cancelled,
    upcomingLessonsNeedingTutor: 0,
    invoicesRetained: invoices.length,
    paymentsRetained: invoices.reduce((n, i) => n + i.payments.length, 0),
    creditNotesRetained: (db.creditNotes ?? []).filter((n) => n.familyId === familyId).length,
    refundsRetained: (db.refunds ?? []).filter((r) => r.familyId === familyId).length,
  };
}

/** Removes a tutor's personal data. Invoices and lesson history are kept for tax and pay records. */
function anonymiseTutor(db: DemoDB, tutorId: string, now: Date): DeletionSummary {
  const tutor = db.tutors.find((t) => t.id === tutorId);
  if (!tutor) throw new Error('Tutor not found');
  // Tasks the adviser ticked off and updates they wrote keep only that they happened (as 20261113000800_launch_fix).
  forgetTutorName(db, tutorId, tutor.fullName);
  tutor.fullName = 'Former tutor';
  tutor.email = placeholderEmail('tutor', tutorId);
  delete tutor.phone;
  tutor.deletedAt = tutor.deletedAt ?? now.toISOString();
  db.availability = db.availability.filter((a) => a.tutorId !== tutorId);
  db.paymentDetails = db.paymentDetails.filter((p) => p.tutorId !== tutorId);
  db.busyBlocks = (db.busyBlocks ?? []).filter((b) => b.tutorId !== tutorId);
  // Round 5: vetting documents go; override reasons are replaced (as the round 5 merge's anonymise_tutor).
  db.tutorDocuments = (db.tutorDocuments ?? []).filter((d) => d.tutorId !== tutorId);
  for (const o of db.vettingOverrides ?? []) if (o.tutorId === tutorId) o.reason = 'Removed: account closed';
  // Bids keep only their outcome: pending ones are withdrawn so they cannot be awarded, and the tutor's own words go.
  for (const b of db.bids) {
    if (b.tutorId !== tutorId) continue;
    if (b.status === 'pending') b.status = 'withdrawn';
    b.pitch = 'Withdrawn: account closed';
    delete b.availability;
  }
  const profileIds = new Set(db.profiles.filter((p) => p.tutorId === tutorId && p.role === 'tutor').map((p) => p.id));
  for (const p of db.profiles) if (profileIds.has(p.id)) forgetActorName(db, p, (c) => c.adviserTutorId === tutorId);
  db.calendarConnections = (db.calendarConnections ?? []).filter((c) => !profileIds.has(c.profileId));
  db.profiles = db.profiles.filter((p) => !profileIds.has(p.id));
  eraseAudit(db, { tutorIds: [tutorId], profileIds: [...profileIds] });
  const upcoming = db.lessons.filter((l) => l.tutorId === tutorId && l.status === 'scheduled' && isFuture(l.start, now)).length;
  return {
    role: 'tutor',
    familyAnonymised: false,
    studentsAnonymised: 0,
    futureLessonsCancelled: 0,
    upcomingLessonsNeedingTutor: upcoming,
    invoicesRetained: db.tutorInvoices.filter((i) => i.tutorId === tutorId).length,
    paymentsRetained: db.tutorInvoices.filter((i) => i.tutorId === tutorId && i.status === 'paid').length,
  };
}

/** How a closed login is named beside what they did (as anonymise_profile_data). */
function formerName(role: string): string {
  switch (role) {
    case 'tutor':
      return 'Former tutor';
    case 'student':
      return 'Former student';
    case 'admin':
      return 'Elite Education';
    case 'accountant':
      return 'Former accountant';
    default:
      return 'Former parent';
  }
}

/**
 * Names written beside a closed login's actions (as anonymise_profile_data in 20261113000800_launch_fix): documents
 * they added, updates they wrote and tasks they ticked off in the cases they could act on, and an administrator's
 * vetting reviews and overrides. The demo keeps names rather than ids for some of these, so they are matched by name.
 */
function forgetActorName(db: DemoDB, profile: Profile, inScope: (c: AdmissionsCase) => boolean) {
  const former = formerName(profile.role);
  const name = profile.fullName;
  const ad = db.admissions;
  if (ad) {
    const cases = new Set(ad.cases.filter((c) => inScope(c) || (!!profile.familyId && c.familyId === profile.familyId)).map((c) => c.id));
    for (const d of ad.documents) if (d.uploadedBy === profile.id) d.uploadedByName = former;
    // The server matches updates by author_id, so every update they wrote; tasks by who completed them (done_by) or, for
    // older tasks, by name within the cases they could act on (an administrator's being every case).
    for (const u of ad.updates) if (u.authorName === name) u.authorName = former;
    for (const k of ad.tasks) if ((profile.role === 'admin' || cases.has(k.caseId)) && k.doneByName === name) k.doneByName = former;
  }
  if (profile.role === 'admin') {
    for (const d of db.tutorDocuments ?? []) if (d.verifiedByName === name) d.verifiedByName = former;
    for (const o of db.vettingOverrides ?? []) {
      if (o.createdByName === name) o.createdByName = former;
      if (o.revokedByName === name) o.revokedByName = former;
    }
  }
}

/** A closed tutor's name leaves the tasks and updates of the cases they advised, with or without a login. */
function forgetTutorName(db: DemoDB, tutorId: string, name: string) {
  for (const c of db.admissions?.cases ?? []) {
    if (c.adviserTutorId !== tutorId) continue;
    for (const k of db.admissions!.tasks) if (k.caseId === c.id && k.doneByName === name) k.doneByName = 'Former tutor';
    for (const u of db.admissions!.updates) if (u.caseId === c.id && u.authorName === name) u.authorName = 'Former tutor';
  }
}

/** Deletes one login (a student, or an administrator who is not the last one). */
function removeProfile(db: DemoDB, profile: Profile): DeletionSummary {
  if (profile.role === 'admin' && db.profiles.filter((p) => p.role === 'admin').length <= 1) throw new Error(LAST_ADMIN_MESSAGE);
  forgetActorName(db, profile, (c) => profile.role === 'admin' || (!!profile.studentId && c.studentId === profile.studentId));
  db.profiles = db.profiles.filter((p) => p.id !== profile.id);
  eraseAudit(db, { profileIds: [profile.id] });
  // Tax: an accountant's invitation goes with their login.
  if (profile.role === 'accountant') db.accountantInvites = (db.accountantInvites ?? []).filter((i) => i.email !== profile.email.toLowerCase());
  db.calendarConnections = (db.calendarConnections ?? []).filter((c) => c.profileId !== profile.id);
  // Messages they wrote stay in the family's conversation without their name, as on the server.
  const former =
    profile.role === 'student' ? 'Former student' : profile.role === 'admin' ? 'Elite Education' : profile.role === 'accountant' ? 'Former accountant' : 'Former parent';
  for (const m of db.messages) {
    if (m.senderId !== profile.id) continue;
    delete m.senderId;
    m.senderName = former;
  }
  // Handbook versions they published (as 20261113001600_deletion_fix; updates and tasks are renamed by forgetActorName).
  for (const h of db.handbookVersions ?? []) if (h.publishedByName === profile.fullName) h.publishedByName = former;
  delete db.reads[profile.id];
  return { role: profile.role, familyAnonymised: false, studentsAnonymised: 0, futureLessonsCancelled: 0, upcomingLessonsNeedingTutor: 0, invoicesRetained: 0, paymentsRetained: 0 };
}

/**
 * Mirrors account_closes_own_login_only: a family contact who is not the main contact, closing their own account, leaves
 * the family (as remove_family_contact does) and only their login is removed. The family, its children, its other
 * contacts and logins stay.
 */
function closesOwnLogin(db: DemoDB, profile: Profile): boolean {
  if (profile.role !== 'parent' || !profile.familyId) return false;
  return closesOwnLoginOnly(listFamilyContacts(db, profile, profile.familyId), profile.id);
}

function removeContactLogin(db: DemoDB, profile: Profile): DeletionSummary {
  db.familyContacts = allContacts(db).filter((c) => !(c.familyId === profile.familyId && c.profileId === profile.id));
  return { ...removeProfile(db, profile), loginOnly: true };
}

function deleteForProfile(db: DemoDB, profile: Profile, now: Date, self = false): DeletionSummary {
  if (self && closesOwnLogin(db, profile)) return removeContactLogin(db, profile);
  if (profile.role === 'parent' && profile.familyId) return anonymiseFamily(db, profile.familyId, now);
  if (profile.role === 'tutor' && profile.tutorId) return anonymiseTutor(db, profile.tutorId, now);
  return removeProfile(db, profile);
}

/** Mirrors deletion_closed_label on the server: how a closed account is described once its details are gone. */
function closedLabel(kind: DeletionRequest['targetKind'], role: string | undefined): string {
  if (kind === 'family') return 'Family (closed)';
  if (kind === 'tutor') return 'Tutor (closed)';
  switch (role) {
    case 'parent':
      return 'Parent account (closed)';
    case 'student':
      return 'Student login (closed)';
    case 'tutor':
      return 'Tutor (closed)';
    case 'admin':
      return 'Administrator (closed)';
    default:
      return 'Account (closed)';
  }
}

/** Mirrors the labels admin_record_deletion_request and begin_account_deletion give a waiting request. */
function profileLabel(db: DemoDB, profile: Profile): string {
  switch (profile.role) {
    case 'parent': {
      const family = db.families.find((f) => f.id === profile.familyId);
      return `Parent account (${family?.name ?? profile.fullName} family)`;
    }
    case 'student':
      return `Student login (${profile.fullName})`;
    case 'tutor':
      return `Tutor (${profile.fullName})`;
    default:
      return `Administrator (${profile.fullName})`;
  }
}

/** The signed-in person deletes their own account. Records a completed request so the office can see what happened. */
export function deleteMyAccount(db: DemoDB, viewer: Profile, now = new Date()): DeletionSummary {
  const me = db.profiles.find((p) => p.id === viewer.id);
  if (!me) throw new Error('Your account could not be found.');
  const familyId = me.familyId;
  const summary = deleteForProfile(db, me, now, true);
  requestsOf(db).push({
    id: newId('del'),
    createdAt: now.toISOString(),
    status: 'completed',
    // Like begin_account_deletion: the request names the login, and its label loses the name once completed.
    targetKind: 'profile',
    familyId: me.role === 'parent' && !summary.loginOnly ? familyId : undefined,
    tutorId: me.role === 'tutor' ? me.tutorId : undefined,
    role: me.role,
    label: summary.loginOnly ? 'Family contact login (closed)' : closedLabel('profile', me.role),
    reason: 'Deleted from the app',
    completedAt: now.toISOString(),
    summary,
  });
  return summary;
}

export function deletionRequests(db: DemoDB, viewer: Profile): DeletionRequest[] {
  requireAdmin(viewer);
  return [...requestsOf(db)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Mirrors admin_record_deletion_request: exactly one of a login, a family or a tutor. */
export function recordDeletionRequest(
  db: DemoDB,
  viewer: Profile,
  target: { profileId?: string; familyId?: string; tutorId?: string; reason?: string },
  now = new Date(),
): string {
  requireAdmin(viewer);
  const chosen = [target.profileId, target.familyId, target.tutorId].filter(Boolean).length;
  if (chosen !== 1) throw new Error('Please choose one family, tutor or login.');
  let request: DeletionRequest;
  const base = { id: newId('del'), createdAt: now.toISOString(), status: 'pending' as const, reason: target.reason?.trim() || undefined, summary: {} };
  if (target.familyId) {
    const family = db.families.find((f) => f.id === target.familyId);
    if (!family) throw new Error('Family not found');
    request = { ...base, targetKind: 'family', familyId: family.id, role: 'parent', label: `Family (${family.name} family)` };
  } else if (target.tutorId) {
    const tutor = db.tutors.find((t) => t.id === target.tutorId);
    if (!tutor) throw new Error('Tutor not found');
    request = { ...base, targetKind: 'tutor', tutorId: tutor.id, role: 'tutor', label: `Tutor (${tutor.fullName})` };
  } else {
    const profile = db.profiles.find((p) => p.id === target.profileId);
    if (!profile) throw new Error('Login not found');
    request = { ...base, targetKind: 'profile', profileId: profile.id, role: profile.role, label: profileLabel(db, profile) };
  }
  const open = requestsOf(db).find(
    (r) =>
      (r.status === 'pending' || r.status === 'processing') &&
      r.targetKind === request.targetKind &&
      (r.familyId ?? r.tutorId ?? r.profileId) === (request.familyId ?? request.tutorId ?? request.profileId),
  );
  if (open) throw new Error('There is already an open deletion request for this account.');
  requestsOf(db).push(request);
  return request.id;
}

export function cancelDeletionRequest(db: DemoDB, viewer: Profile, id: string) {
  requireAdmin(viewer);
  const r = requestsOf(db).find((x) => x.id === id);
  if (!r) throw new Error('Deletion request not found');
  if (r.status !== 'pending') throw new Error('Only a pending request can be cancelled.');
  r.status = 'cancelled';
}

/** Mirrors delete-account called by an admin with { requestId }. */
export function processDeletionRequest(db: DemoDB, viewer: Profile, id: string, now = new Date()): DeletionSummary {
  requireAdmin(viewer);
  const r = requestsOf(db).find((x) => x.id === id);
  if (!r) throw new Error('Deletion request not found');
  if (r.status !== 'pending' && r.status !== 'failed') throw new Error('This request has already been dealt with.');
  try {
    let summary: DeletionSummary;
    if (r.targetKind === 'family' && r.familyId) summary = anonymiseFamily(db, r.familyId, now);
    else if (r.targetKind === 'tutor' && r.tutorId) summary = anonymiseTutor(db, r.tutorId, now);
    else {
      const profile = db.profiles.find((p) => p.id === r.profileId);
      if (!profile) throw new Error('Login not found');
      summary = deleteForProfile(db, profile, now);
    }
    r.status = 'completed';
    r.completedAt = now.toISOString();
    r.summary = summary;
    r.label = closedLabel(r.targetKind, r.role);
    delete r.error;
    return summary;
  } catch (err) {
    r.status = 'failed';
    r.error = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
