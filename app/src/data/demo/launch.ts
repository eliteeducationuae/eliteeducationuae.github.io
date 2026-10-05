import { LAST_ADMIN_MESSAGE, last4 } from '@/domain/data-rights';
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

import { cw } from './classwork';
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
  { version: '20261020000000', name: 'launch' },
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
  db.messages = db.messages.filter((m) => m.familyId !== familyId);
  db.requests = db.requests.filter((r) => r.familyId !== familyId);
  for (const reads of Object.values(db.reads)) delete reads[familyId];

  // Logins for the parent and the children go.
  db.profiles = db.profiles.filter((p) => p.role === 'admin' || (p.familyId !== familyId && !(p.studentId && studentIds.has(p.studentId))));

  const invoices = db.invoices.filter((i) => i.familyId === familyId);
  return {
    role: 'parent',
    familyAnonymised: true,
    studentsAnonymised: studentIds.size,
    futureLessonsCancelled: cancelled,
    upcomingLessonsNeedingTutor: 0,
    invoicesRetained: invoices.length,
    paymentsRetained: invoices.reduce((n, i) => n + i.payments.length, 0),
  };
}

/** Removes a tutor's personal data. Invoices and lesson history are kept for tax and pay records. */
function anonymiseTutor(db: DemoDB, tutorId: string, now: Date): DeletionSummary {
  const tutor = db.tutors.find((t) => t.id === tutorId);
  if (!tutor) throw new Error('Tutor not found');
  tutor.fullName = 'Former tutor';
  tutor.email = placeholderEmail('tutor', tutorId);
  delete tutor.phone;
  tutor.deletedAt = tutor.deletedAt ?? now.toISOString();
  db.availability = db.availability.filter((a) => a.tutorId !== tutorId);
  db.paymentDetails = db.paymentDetails.filter((p) => p.tutorId !== tutorId);
  db.busyBlocks = (db.busyBlocks ?? []).filter((b) => b.tutorId !== tutorId);
  // Bids keep only their outcome: pending ones are withdrawn so they cannot be awarded, and the tutor's own words go.
  for (const b of db.bids) {
    if (b.tutorId !== tutorId) continue;
    if (b.status === 'pending') b.status = 'withdrawn';
    b.pitch = 'Withdrawn: account closed';
    delete b.availability;
  }
  const profileIds = new Set(db.profiles.filter((p) => p.tutorId === tutorId && p.role === 'tutor').map((p) => p.id));
  db.calendarConnections = (db.calendarConnections ?? []).filter((c) => !profileIds.has(c.profileId));
  db.profiles = db.profiles.filter((p) => !profileIds.has(p.id));
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

/** Deletes one login (a student, or an administrator who is not the last one). */
function removeProfile(db: DemoDB, profile: Profile): DeletionSummary {
  if (profile.role === 'admin' && db.profiles.filter((p) => p.role === 'admin').length <= 1) throw new Error(LAST_ADMIN_MESSAGE);
  db.profiles = db.profiles.filter((p) => p.id !== profile.id);
  db.calendarConnections = (db.calendarConnections ?? []).filter((c) => c.profileId !== profile.id);
  // Messages they wrote stay in the family's conversation without their name, as on the server.
  const former = profile.role === 'student' ? 'Former student' : profile.role === 'admin' ? 'Elite Education' : 'Former parent';
  for (const m of db.messages) {
    if (m.senderId !== profile.id) continue;
    delete m.senderId;
    m.senderName = former;
  }
  delete db.reads[profile.id];
  return { role: profile.role, familyAnonymised: false, studentsAnonymised: 0, futureLessonsCancelled: 0, upcomingLessonsNeedingTutor: 0, invoicesRetained: 0, paymentsRetained: 0 };
}

function deleteForProfile(db: DemoDB, profile: Profile, now: Date): DeletionSummary {
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
  const summary = deleteForProfile(db, me, now);
  requestsOf(db).push({
    id: newId('del'),
    createdAt: now.toISOString(),
    status: 'completed',
    // Like begin_account_deletion: the request names the login, and its label loses the name once completed.
    targetKind: 'profile',
    familyId: me.role === 'parent' ? me.familyId : undefined,
    tutorId: me.role === 'tutor' ? me.tutorId : undefined,
    role: me.role,
    label: closedLabel('profile', me.role),
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
