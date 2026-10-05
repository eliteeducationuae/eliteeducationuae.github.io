import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  friendlySocialError,
  NATIVE_AUTH_PATH,
  parseAuthCallback,
  redirectErrorNotice,
  webRedirectTo,
  type SocialProviderName,
} from '@/lib/social-auth';
import { brandTutorColor } from '@/lib/tutor-colors';
import { lessonHomeworkWarning, normaliseLink } from '@/domain/homework';
import { connectResultNotice } from '@/domain/calendar-connection';
import type { CancellationOutcome } from '@/domain/scheduling';
import type {
  Enrolment,
  Topic,
  TopicList,
  Expense,
  Opportunity,
  OpportunityBid,
  PaymentDetails,
  ReportCycle,
  StudentReport,
  TutorApplication,
  TutorInvoice,
  Announcement,
  Availability,
  BusyBlock,
  CalendarConnection,
  Charge,
  Closure,
  Enquiry,
  LessonRequest,
  Message,
  Thread,
  TutorAbsence,
  Family,
  Homework,
  HomeworkSubmission,
  Invoice,
  Lesson,
  LessonNote,
  LessonPackage,
  Profile,
  Resource,
  Service,
  Settings,
  Student,
  Tutor,
  TopicRating,
  PackageOffer,
  // Launch readiness
  AppErrorRow,
  DataExport,
  DeletionRequest,
  DeletionSummary,
  FunctionErrorRow,
  SystemHealth,
} from '@/domain/types';

import { APPLE_NATIVE, appleNativeSignIn } from './apple-native';
import { AuthNotice, NOT_LINKED } from './messages';
import { addChildSubjects } from './rpc-mapping';
import { PartialSaveError, type AutopayChargeResult, type DataSource, type HomeworkInput, type SocialProvider, type SocialSignInResult } from './source';

/**
 * The page address when the web app first loaded, captured before the Supabase client reads (and tidies)
 * it, so a failed Apple or Google redirect can still be explained on the sign-in screen.
 */
const initialUrl = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : '';

/** Remembers which provider a web redirect was for, so its error can be named after the page reloads. */
const PENDING_PROVIDER_KEY = 'elite.auth.pendingProvider';

type Row = Record<string, any>;

/** Unwrap a Supabase response, throwing its error. Rows are mapped by hand, so the result is loosely typed. */
function check<T = any>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

const toProfile = (r: Row): Profile => ({
  id: r.id,
  role: r.role,
  fullName: r.full_name,
  email: r.email,
  phone: r.phone ?? undefined,
  tutorId: r.tutor_id ?? undefined,
  familyId: r.family_id ?? undefined,
  studentId: r.student_id ?? undefined,
  icsToken: r.ics_token ?? undefined,
  whatsappOptIn: r.whatsapp_opt_in ?? false,
  whatsappNumber: r.whatsapp_number ?? undefined,
});

const toSettings = (r: Row): Settings => ({
  businessName: r.business_name,
  currency: 'AED',
  vatRate: Number(r.vat_rate),
  cancellationHours: r.cancellation_hours,
  lateCancelFee: Number(r.late_cancel_fee),
  noShowFee: Number(r.no_show_fee),
  payTutorForLateCancel: r.pay_tutor_for_late_cancel,
  invoiceDueDays: r.invoice_due_days,
  nextInvoiceNumber: r.next_invoice_number,
  bankDetails: r.bank_details ?? undefined,
  notifyEmail: r.notify_email ?? undefined,
  emailLessonNotes: r.email_lesson_notes ?? true,
  emailInvoices: r.email_invoices ?? true,
  emailMessages: r.email_messages ?? true,
  bookingNoticeHours: r.booking_notice_hours ?? 24,
});

const fromSettings = (s: Partial<Settings>): Row =>
  strip({
    business_name: s.businessName,
    vat_rate: s.vatRate,
    cancellation_hours: s.cancellationHours,
    late_cancel_fee: s.lateCancelFee,
    no_show_fee: s.noShowFee,
    pay_tutor_for_late_cancel: s.payTutorForLateCancel,
    invoice_due_days: s.invoiceDueDays,
    bank_details: s.bankDetails,
    notify_email: s.notifyEmail,
    email_lesson_notes: s.emailLessonNotes,
    email_invoices: s.emailInvoices,
    email_messages: s.emailMessages,
    booking_notice_hours: s.bookingNoticeHours,
  });

const toTutor = (r: Row): Tutor => ({
  id: r.id,
  fullName: r.full_name,
  email: r.email,
  phone: r.phone ?? undefined,
  hourlyPay: Number(r.hourly_pay),
  subjects: r.subjects ?? [],
  curricula: r.curricula ?? [],
  phases: r.phases ?? [],
  // Tutors created before the rebrand keep their old bright colours in the database; draw them in the brand palette.
  color: brandTutorColor(r.color, r.id),
});

const toFamily = (r: Row): Family => ({
  id: r.id,
  name: r.name,
  parentName: r.parent_name,
  email: r.email,
  phone: r.phone ?? undefined,
  status: r.status ?? 'active',
  createdAt: r.created_at ?? undefined,
  ...toBilling(r.family_billing),
});

/**
 * The embedded family_billing row (one-to-one, so PostgREST may give an object, a one-element array or null).
 * RLS only returns it to admins and the family itself; everyone else gets no card or autopay fields at all.
 */
function toBilling(embedded: unknown): Pick<Family, 'autopay' | 'savedCard'> {
  const b = (Array.isArray(embedded) ? embedded[0] : embedded) as Row | null | undefined;
  if (!b) return {};
  return {
    autopay: b.autopay ?? false,
    savedCard: b.card_last4 ? { brand: b.card_brand ?? 'Card', last4: b.card_last4, expires: b.card_expires ?? undefined } : undefined,
  };
}

const toOffer = (r: Row): PackageOffer => ({
  id: r.id,
  name: r.name,
  serviceId: r.service_id ?? undefined,
  lessons: r.lessons,
  price: Number(r.price),
  active: r.active,
  sort: r.sort ?? 0,
});

const toEnquiry = (r: Row): Enquiry => ({
  id: r.id,
  createdAt: r.created_at,
  status: r.status,
  source: r.source,
  parentName: r.parent_name,
  email: r.email ?? undefined,
  phone: r.phone ?? undefined,
  studentName: r.student_name ?? undefined,
  curriculum: r.curriculum ?? undefined,
  subject: r.subject ?? undefined,
  phase: r.phase ?? undefined,
  yearGroup: r.year_group ?? undefined,
  message: r.message ?? undefined,
  preferredTimes: r.preferred_times ?? undefined,
  familyId: r.family_id ?? undefined,
  studentId: r.student_id ?? undefined,
  trialLessonId: r.trial_lesson_id ?? undefined,
  nextActionAt: r.next_action_at ?? undefined,
  notes: r.notes ?? undefined,
  lostReason: r.lost_reason ?? undefined,
});

const toRequest = (r: Row): LessonRequest => ({
  id: r.id,
  createdAt: r.created_at,
  familyId: r.family_id,
  studentId: r.student_id,
  kind: r.kind,
  lessonId: r.lesson_id ?? undefined,
  tutorId: r.tutor_id,
  serviceId: r.service_id,
  subject: r.subject ?? undefined,
  start: new Date(r.start_at).toISOString(),
  end: new Date(r.end_at).toISOString(),
  note: r.note ?? undefined,
  status: r.status,
  response: r.response ?? undefined,
  decidedAt: r.decided_at ?? undefined,
});

const hhmm = (t: string) => t.slice(0, 5);

const toOpportunity = (r: Row): Opportunity => ({
  id: r.id,
  createdAt: r.created_at,
  title: r.title,
  description: r.description ?? undefined,
  curriculum: r.curriculum ?? undefined,
  syllabusId: r.syllabus_id ?? undefined,
  subject: r.subject ?? undefined,
  phase: r.phase ?? undefined,
  studentId: r.student_id ?? undefined,
  enquiryId: r.enquiry_id ?? undefined,
  schedule: r.schedule ?? undefined,
  location: r.location ?? undefined,
  payRate: Number(r.pay_rate),
  closesOn: r.closes_on ?? undefined,
  status: r.status,
  visibility: r.visibility,
  invitedTutorIds: r.invited_tutor_ids ?? [],
  awardedTutorId: r.awarded_tutor_id ?? undefined,
  awardedAt: r.awarded_at ?? undefined,
});

const toTutorInvoice = (r: Row): TutorInvoice => ({
  id: r.id,
  createdAt: r.created_at,
  tutorId: r.tutor_id,
  number: r.number,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  status: r.status,
  items: (r.items ?? []).map((i: Row) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), lessonId: i.lessonId ?? undefined })),
  notes: r.notes ?? undefined,
  adminComment: r.admin_comment ?? undefined,
  submittedAt: r.submitted_at ?? undefined,
  approvedAt: r.approved_at ?? undefined,
  paidAt: r.paid_at ?? undefined,
  paymentReference: r.payment_reference ?? undefined,
});

const toReport = (r: Row): StudentReport => ({
  id: r.id,
  cycleId: r.cycle_id,
  studentId: r.student_id,
  tutorId: r.tutor_id,
  subject: r.subject ?? undefined,
  enrolmentId: r.enrolment_id ?? undefined,
  attainment: r.attainment ?? undefined,
  effort: r.effort ?? undefined,
  progress: r.progress ?? undefined,
  strengths: r.strengths ?? undefined,
  nextSteps: r.next_steps ?? undefined,
  comment: r.comment ?? undefined,
  status: r.status,
  aiAssisted: r.ai_assisted,
  updatedAt: r.updated_at,
  submittedAt: r.submitted_at ?? undefined,
  publishedAt: r.published_at ?? undefined,
});

const toStudent = (r: Row): Student => ({
  id: r.id,
  familyId: r.family_id,
  fullName: r.full_name,
  curriculum: r.curriculum ?? undefined,
  syllabusId: r.syllabus_id ?? undefined,
  phase: r.phase ?? undefined,
  school: r.school ?? undefined,
  yearGroup: r.year_group ?? undefined,
  currentGrade: r.current_grade ?? undefined,
  targetGrade: r.target_grade ?? undefined,
  examDate: r.exam_date ?? undefined,
  notes: r.student_notes?.notes ?? undefined,
});

const toService = (r: Row): Service => ({
  id: r.id,
  name: r.name,
  durationMin: r.duration_min,
  rate: Number(r.rate),
  subject: r.subject ?? undefined,
  phase: r.phase ?? undefined,
});

const toEnrolment = (r: Row): Enrolment => ({
  id: r.id,
  studentId: r.student_id,
  subject: r.subject,
  curriculum: r.curriculum ?? undefined,
  level: r.level ?? undefined,
  examBoard: r.exam_board ?? undefined,
  tutorId: r.tutor_id ?? undefined,
  syllabusId: r.syllabus_id ?? undefined,
  topicListId: r.topic_list_id ?? undefined,
  active: r.active,
  createdAt: r.created_at ?? undefined,
});

const toTopicList = (r: Row): TopicList => ({
  id: r.id,
  subject: r.subject,
  curriculum: r.curriculum ?? undefined,
  level: r.level ?? undefined,
  name: r.name,
  createdAt: r.created_at ?? undefined,
});

const toTopic = (r: Row): Topic => ({
  id: r.id,
  listId: r.list_id,
  unit: r.unit ?? undefined,
  name: r.name,
  sort: r.sort ?? 0,
  createdAt: r.created_at ?? undefined,
});

const toLesson = (r: Row): Lesson => ({
  id: r.id,
  tutorId: r.tutor_id,
  studentIds: r.student_ids,
  serviceId: r.service_id,
  subject: r.subject ?? undefined,
  start: new Date(r.start_at).toISOString(),
  end: new Date(r.end_at).toISOString(),
  location: r.location,
  meetingUrl: r.meeting_url ?? undefined,
  address: r.address ?? undefined,
  status: r.status,
  seriesId: r.series_id ?? undefined,
  cancelledAt: r.cancelled_at ?? undefined,
  cancelReason: r.cancel_reason ?? undefined,
});

const toNote = (r: Row): LessonNote => ({
  lessonId: r.lesson_id,
  summary: r.summary,
  topicIds: r.topic_ids ?? [],
  attendance: r.attendance ?? {},
  createdAt: r.created_at,
  privateNote: r.lesson_private_notes?.private_note ?? undefined,
});

const toHomework = (r: Row): Homework => ({
  id: r.id,
  studentId: r.student_id,
  lessonId: r.lesson_id ?? undefined,
  title: r.title,
  dueDate: r.due_date,
  done: r.done,
  details: r.details ?? undefined,
  attachments: r.attachments ?? [],
  tutorId: r.tutor_id ?? undefined,
  createdAt: r.created_at ?? undefined,
});

export const toSubmission = (r: Row): HomeworkSubmission => ({
  id: r.id,
  homeworkId: r.homework_id,
  studentId: r.student_id,
  submittedBy: r.submitted_by ?? undefined,
  submittedByName: r.submitted_by_name ?? undefined,
  note: r.note ?? undefined,
  files: r.files ?? [],
  submittedAt: r.submitted_at,
  feedback: r.feedback ?? undefined,
  mark: r.mark ?? undefined,
  feedbackAt: r.feedback_at ?? undefined,
  feedbackBy: r.feedback_by ?? undefined,
  feedbackByName: r.feedback_by_name ?? undefined,
});

export const toResource = (r: Row): Resource => ({
  id: r.id,
  title: r.title,
  description: r.description ?? undefined,
  subject: r.subject ?? undefined,
  curriculum: r.curriculum ?? undefined,
  level: r.level ?? undefined,
  kind: r.kind,
  path: r.path ?? undefined,
  url: r.url ?? undefined,
  fileName: r.file_name ?? undefined,
  mimeType: r.mime_type ?? undefined,
  tags: r.tags ?? [],
  uploadedBy: r.uploaded_by ?? undefined,
  uploadedByName: r.uploaded_by_name ?? undefined,
  visibility: r.visibility,
  studentIds: r.student_ids ?? [],
  createdAt: r.created_at,
});

/** Arguments for the save_homework RPC. */
export const saveHomeworkArgs = (input: HomeworkInput) => ({
  p_id: input.id ?? null,
  p_student_id: input.studentId,
  p_title: input.title,
  p_details: input.details ?? null,
  p_due_date: input.dueDate,
  p_attachments: input.attachments,
  p_lesson_id: input.lessonId ?? null,
});

/** An RPC may return its row directly or as a one-row set. */
const firstRow = (data: unknown): Row => (Array.isArray(data) ? data[0] : data) as Row;

const toRating = (r: Row): TopicRating => ({
  id: r.id,
  studentId: r.student_id,
  topicId: r.topic_id,
  lessonId: r.lesson_id ?? undefined,
  rating: r.rating,
  ratedAt: r.rated_at,
});

const toPackage = (r: Row): LessonPackage => ({
  id: r.id,
  familyId: r.family_id,
  name: r.name,
  serviceId: r.service_id ?? undefined,
  lessonsTotal: r.lessons_total,
  lessonsUsed: r.lessons_used,
  price: Number(r.price),
  purchasedAt: r.purchased_at,
  expiresAt: r.expires_at ?? undefined,
});

const toCharge = (r: Row): Charge => ({
  id: r.id,
  lessonId: r.lesson_id,
  studentId: r.student_id,
  familyId: r.family_id,
  description: r.description,
  amount: Number(r.amount),
  status: r.status,
  invoiceId: r.invoice_id ?? undefined,
  packageId: r.package_id ?? undefined,
  date: r.date,
});

const toInvoice = (r: Row): Invoice => ({
  id: r.id,
  number: r.number,
  familyId: r.family_id,
  issueDate: r.issue_date,
  dueDate: r.due_date,
  status: r.status,
  items: r.items ?? [],
  vatRate: Number(r.vat_rate),
  notes: r.notes ?? undefined,
  autopayStatus: r.autopay_status ?? undefined,
  autopayError: r.autopay_error ?? undefined,
  payments: (r.payments ?? []).map((p: Row) => ({
    id: p.id,
    invoiceId: p.invoice_id,
    amount: Number(p.amount),
    method: p.method,
    paidAt: p.paid_at,
    reference: p.reference ?? undefined,
  })),
});

/** Rows per request when reading topics; at or below the server's response cap. */
const TOPIC_PAGE = 1000;

function strip(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

// Google Calendar
const toBusyBlock = (r: Row): BusyBlock => ({
  id: r.id,
  tutorId: r.tutor_id,
  start: new Date(r.start_at).toISOString(),
  end: new Date(r.end_at).toISOString(),
  source: 'google',
});

const toCalendarConnection = (r: Row): CalendarConnection => ({
  profileId: r.profile_id,
  provider: 'google',
  googleEmail: r.google_email ?? undefined,
  calendarId: r.calendar_id,
  status: r.status,
  lastSyncedAt: r.last_synced_at ?? undefined,
  lastError: r.last_error ?? undefined,
});

/** Only these columns are granted to the app; the tokens are not, so select('*') would fail. */
const CALENDAR_CONNECTION_COLUMNS = 'profile_id, provider, google_email, calendar_id, status, last_synced_at, last_error';

/** The current page without any calendar=… result left by a previous connection attempt. */
function calendarReturnTo(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('calendar');
  url.searchParams.delete('reason');
  return url.toString();
}

/**
 * Unwrap an Edge Function response. Functions reply to failures with a non-2xx status and JSON {error}; show that
 * message (e.g. "No saved card yet. …") rather than the client's generic "non-2xx status code".
 */
async function invokeResult<T>(result: { data: unknown; error: unknown }): Promise<T> {
  const error = result.error as { message?: string; context?: { json?: () => Promise<unknown> } } | null;
  if (!error) return result.data as T;
  let message = error.message || 'Something went wrong. Please try again.';
  try {
    const body = (await error.context?.json?.()) as { error?: unknown } | undefined;
    if (body && typeof body.error === 'string' && body.error) message = body.error;
  } catch {
    // Not JSON (e.g. the function could not be reached); keep the client's message.
  }
  throw new Error(message);
}

// Launch readiness: error reporting, system health and account deletion

const toAppError = (r: Row): AppErrorRow => ({
  id: r.id,
  createdAt: r.created_at,
  profileId: r.profile_id ?? undefined,
  role: r.role ?? undefined,
  platform: r.platform ?? 'unknown',
  appVersion: r.app_version ?? undefined,
  route: r.route ?? undefined,
  source: r.source ?? 'manual',
  message: r.message ?? '',
  stack: r.stack ?? undefined,
  fingerprint: r.fingerprint ?? undefined,
});

const toFunctionError = (r: Row): FunctionErrorRow => ({
  id: r.id,
  createdAt: r.created_at,
  functionName: r.function_name,
  message: r.message ?? '',
  status: r.status ?? undefined,
  context: r.context ?? undefined,
});

const toDeletionSummary = (r: Row | null | undefined): DeletionSummary => {
  const s = r ?? {};
  const n = (v: unknown) => (v == null ? undefined : Number(v));
  return {
    role: s.role ?? undefined,
    familyAnonymised: s.familyAnonymised ?? undefined,
    studentsAnonymised: n(s.studentsAnonymised),
    futureLessonsCancelled: n(s.futureLessonsCancelled),
    upcomingLessonsNeedingTutor: n(s.upcomingLessonsNeedingTutor),
    invoicesRetained: n(s.invoicesRetained),
    paymentsRetained: n(s.paymentsRetained),
  };
};

const toDeletionRequest = (r: Row): DeletionRequest => ({
  id: r.id,
  createdAt: r.created_at,
  status: r.status,
  targetKind: r.target_kind,
  profileId: r.profile_id ?? undefined,
  familyId: r.family_id ?? undefined,
  tutorId: r.tutor_id ?? undefined,
  role: r.role ?? undefined,
  label: r.label ?? '',
  reason: r.reason ?? undefined,
  completedAt: r.completed_at ?? undefined,
  summary: toDeletionSummary(r.summary),
  error: r.error ?? undefined,
});

/** system_health() returns camelCase JSON already; fill gaps so the screen never meets undefined lists. */
const toSystemHealth = (r: Row | null): SystemHealth => ({
  checkedAt: r?.checkedAt ?? new Date().toISOString(),
  status: r?.status ?? 'ok',
  checks: (r?.checks ?? []).map((c: Row) => ({ key: c.key, label: c.label, status: c.status, detail: c.detail ?? '', count: c.count ?? undefined })),
  jobs: (r?.jobs ?? []).map((j: Row) => ({
    name: j.name,
    lastStartedAt: j.lastStartedAt ?? undefined,
    lastSucceededAt: j.lastSucceededAt ?? undefined,
    lastFailedAt: j.lastFailedAt ?? undefined,
    lastError: j.lastError ?? undefined,
  })),
  database: {
    latest: r?.database?.latest ?? '',
    latestName: r?.database?.latestName ?? '',
    count: Number(r?.database?.count ?? 0),
    migrations: (r?.database?.migrations ?? []).map((m: Row) => ({ version: m.version, name: m.name ?? '', appliedAt: m.appliedAt ?? undefined })),
  },
});

export function createSupabaseSource(url: string, anonKey: string): DataSource {
  const client: SupabaseClient = createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  });

  async function loadProfile(): Promise<Profile | null> {
    const { data } = await client.auth.getUser();
    if (!data.user) return null;
    const row = check(await client.from('profiles').select('*').eq('id', data.user.id).maybeSingle());
    return row ? toProfile(row) : null;
  }

  /** On the web, the error from an Apple or Google redirect is reported once, then forgotten. */
  let callbackChecked = Platform.OS !== 'web';

  async function takeCallbackNotice(): Promise<string | null> {
    if (callbackChecked) return null;
    callbackChecked = true;
    const pending = await AsyncStorage.getItem(PENDING_PROVIDER_KEY).catch(() => null);
    if (pending) await AsyncStorage.removeItem(PENDING_PROVIDER_KEY).catch(() => undefined);
    const { error, errorCode } = parseAuthCallback(initialUrl);
    if (!error && !errorCode) return null;
    try {
      // Tidy the error out of the address bar so a refresh does not repeat it.
      window.history.replaceState(window.history.state, '', window.location.pathname);
    } catch {
      // Not fatal.
    }
    const provider = pending === 'apple' || pending === 'google' ? pending : null;
    return redirectErrorNotice(provider, error, errorCode);
  }

  /** Finish a native browser sign-in from the URL the browser returned to. */
  async function completeFromCallback(provider: SocialProviderName, url: string): Promise<'done' | 'cancelled'> {
    const parsed = parseAuthCallback(url);
    if (parsed.error) {
      const message = friendlySocialError(provider, parsed.error);
      if (message === 'Sign-in was cancelled.') return 'cancelled';
      throw new Error(message);
    }
    if (parsed.code) {
      check(await client.auth.exchangeCodeForSession(parsed.code));
    } else if (parsed.accessToken && parsed.refreshToken) {
      check(await client.auth.setSession({ access_token: parsed.accessToken, refresh_token: parsed.refreshToken }));
    } else {
      throw new Error(friendlySocialError(provider, 'missing session'));
    }
    return 'done';
  }

  async function startProviderSignIn(provider: SocialProvider): Promise<SocialSignInResult | 'done'> {
    // (1) Web: hand the whole page to the provider; restoreSession picks the session up on return.
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(PENDING_PROVIDER_KEY, provider).catch(() => undefined);
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: webRedirectTo(window.location.origin, process.env.EXPO_BASE_URL),
          queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      });
      if (error) {
        await AsyncStorage.removeItem(PENDING_PROVIDER_KEY).catch(() => undefined);
        throw new Error(error.message);
      }
      return { status: 'redirecting' };
    }

    // (2) iOS: Apple's native sheet, then the identity token goes to Supabase with the raw nonce.
    if (Platform.OS === 'ios' && provider === 'apple' && APPLE_NATIVE) {
      const apple = await appleNativeSignIn();
      if (!apple) return { status: 'cancelled' };
      check(await client.auth.signInWithIdToken({ provider: 'apple', token: apple.identityToken, nonce: apple.rawNonce }));
      if (apple.fullName) {
        // Apple shares the name only once. set_my_name records it only for a parent whose family is still a
        // prospect, so a name the office has recorded for an active family is never overwritten.
        await client.rpc('set_my_name', { p_full_name: apple.fullName }).then(undefined, () => undefined);
      }
      return 'done';
    }

    // (3) Google everywhere native, and Apple on Android: an in-app browser returning to the app.
    const redirectTo = AuthSession.makeRedirectUri({ scheme: 'eliteeducation', path: NATIVE_AUTH_PATH });
    const data = check<{ url: string }>(
      await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      }),
    );
    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success') return { status: 'cancelled' };
    return (await completeFromCallback(provider, res.url)) === 'cancelled' ? { status: 'cancelled' } : 'done';
  }

  /**
   * An invoice just sent to an autopay family with a saved card is marked 'pending' by the database. Ask
   * charge-invoice to take payment now; if this fails, the 15-minute schedule charges it instead.
   */
  function chargeIfAutopay(row: Row | null | undefined) {
    if (!row?.id || row.autopay_status !== 'pending') return;
    client.functions.invoke('charge-invoice', { body: { invoiceId: row.id } }).catch(() => undefined);
  }

  return {
    kind: 'supabase',

    async restoreSession() {
      const notice = await takeCallbackNotice();
      if (notice) throw new AuthNotice(notice);
      // Offline or no login: just show the sign-in screen, keeping any stored session.
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return null;
      const row = check(await client.from('profiles').select('*').eq('id', data.user.id).maybeSingle());
      if (row) return toProfile(row);
      // A login without a profile (e.g. an Apple or Google login that could not be linked): sign it out and say why.
      await client.auth.signOut();
      throw new AuthNotice(NOT_LINKED);
    },
    async signInWithProvider(provider) {
      let started: SocialSignInResult | 'done';
      try {
        started = await startProviderSignIn(provider);
      } catch (err) {
        // Never log tokens; show families a plain-English message instead of the raw provider error.
        const message = err instanceof Error ? err.message : String(err);
        const friendly = message.startsWith('Sign in with') || message.startsWith('We could not');
        throw new Error(friendly ? message : friendlySocialError(provider, message));
      }
      if (started !== 'done') return started;
      const profile = await loadProfile();
      if (!profile) {
        await client.auth.signOut();
        throw new Error(NOT_LINKED);
      }
      return { status: 'signed-in', profile };
    },
    async setMyName(fullName) {
      check(await client.rpc('set_my_name', { p_full_name: fullName.trim() }));
      const profile = await loadProfile();
      if (!profile) throw new Error(NOT_LINKED);
      return profile;
    },
    async setWhatsApp(prefs) {
      check(await client.rpc('set_whatsapp', { p_opt_in: prefs.optIn, p_number: prefs.number }));
      const profile = await loadProfile();
      if (!profile) throw new Error(NOT_LINKED);
      return profile;
    },
    async signIn(email, password) {
      check(await client.auth.signInWithPassword({ email: email.trim(), password }));
      const profile = await loadProfile();
      if (!profile) {
        await client.auth.signOut();
        throw new Error(NOT_LINKED);
      }
      return profile;
    },
    async signOut() {
      // Stop reminders going to this device once signed out.
      await client.rpc('set_push_token', { p_token: null }).then(undefined, () => undefined);
      await client.auth.signOut();
    },
    async signUp(email, password, details) {
      const data = check(
        await client.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { signup: 'parent', full_name: details.fullName.trim(), phone: details.phone?.trim() } },
        }),
      );
      return data.session ? 'signed-in' : 'confirm-email';
    },
    async verifySignUpCode(email, code) {
      check(await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' }));
    },
    async resendSignUpCode(email) {
      check(await client.auth.resend({ type: 'signup', email: email.trim() }));
    },
    async resetPassword(email) {
      check(await client.auth.resetPasswordForEmail(email.trim()));
    },
    async loginEmails() {
      return check<string[]>(await client.rpc('login_emails'));
    },
    async savePushToken(token) {
      check(await client.rpc('set_push_token', { p_token: token }));
    },

    async getSettings() {
      return toSettings(check(await client.from('settings').select('*').eq('id', 1).single()));
    },
    async listTutors() {
      return check(await client.from('tutors').select('*').order('full_name')).map(toTutor);
    },
    async listFamilies() {
      return check(await client.from('families').select('*, family_billing(*)').order('name')).map(toFamily);
    },
    async listStudents() {
      // student_notes is protected by RLS, so families simply get no notes back.
      return check(await client.from('students').select('*, student_notes(notes)').order('full_name')).map(toStudent);
    },
    async listServices() {
      return check(await client.from('services').select('*').order('name')).map(toService);
    },
    async listLessons({ from, to }) {
      return check(
        await client.from('lessons').select('*').lt('start_at', to).gt('end_at', from).order('start_at'),
      ).map(toLesson);
    },
    async getLesson(id) {
      const row = check(await client.from('lessons').select('*').eq('id', id).maybeSingle());
      return row ? toLesson(row) : null;
    },
    async listNotes(filter = {}) {
      let query = client.from('lesson_notes').select('*, lesson_private_notes(private_note), lessons!inner(student_ids)');
      if (filter.lessonId) query = query.eq('lesson_id', filter.lessonId);
      if (filter.studentId) query = query.contains('lessons.student_ids', [filter.studentId]);
      return check(await query.order('created_at', { ascending: false })).map(toNote);
    },
    async listHomework(filter = {}) {
      let query = client.from('homework').select('*');
      if (filter.studentId) query = query.eq('student_id', filter.studentId);
      if (filter.lessonId) query = query.eq('lesson_id', filter.lessonId);
      return check(await query.order('due_date', { ascending: false })).map(toHomework);
    },
    async listRatings(filter = {}) {
      let query = client.from('topic_ratings').select('*');
      if (filter.studentId) query = query.eq('student_id', filter.studentId);
      return check(await query.order('rated_at')).map(toRating);
    },
    async listPackages(filter = {}) {
      let query = client.from('packages').select('*');
      if (filter.familyId) query = query.eq('family_id', filter.familyId);
      return check(await query.order('purchased_at', { ascending: false })).map(toPackage);
    },
    async listCharges(filter = {}) {
      let query = client.from('charges').select('*');
      if (filter.familyId) query = query.eq('family_id', filter.familyId);
      return check(await query.order('date')).map(toCharge);
    },
    async listInvoices(filter = {}) {
      let query = client.from('invoices').select('*, payments(*)');
      if (filter.familyId) query = query.eq('family_id', filter.familyId);
      return check(await query.order('issue_date', { ascending: false })).map(toInvoice);
    },
    async getInvoice(id) {
      const row = check(await client.from('invoices').select('*, payments(*)').eq('id', id).maybeSingle());
      return row ? toInvoice(row) : null;
    },

    async saveSettings(patch) {
      check(await client.from('settings').update(fromSettings(patch)).eq('id', 1));
    },
    async saveTutor(t) {
      const row = strip({
        id: t.id,
        full_name: t.fullName, email: t.email, phone: t.phone, hourly_pay: t.hourlyPay,
        subjects: t.subjects,
        curricula: t.curricula,
        phases: t.phases,
        color: t.color,
      });
      return toTutor(check(await client.from('tutors').upsert(row).select().single()));
    },
    async saveFamily(f) {
      const row = strip({ id: f.id, name: f.name, parent_name: f.parentName, email: f.email, phone: f.phone, status: f.status });
      return toFamily(check(await client.from('families').upsert(row).select('*, family_billing(*)').single()));
    },
    async saveStudent(s) {
      const row = strip({
        id: s.id,
        family_id: s.familyId,
        full_name: s.fullName,
        curriculum: s.curriculum,
        syllabus_id: s.syllabusId,
        phase: s.phase,
        school: s.school,
        year_group: s.yearGroup,
        current_grade: s.currentGrade,
        target_grade: s.targetGrade,
        exam_date: s.examDate,
      });
      const saved = check(await client.from('students').upsert(row).select().single());
      if (s.notes !== undefined) {
        check(await client.from('student_notes').upsert({ student_id: saved.id, notes: s.notes }));
      }
      return toStudent({ ...saved, student_notes: { notes: s.notes } });
    },
    async saveService(s) {
      const row = strip({ id: s.id, name: s.name, duration_min: s.durationMin, rate: s.rate, subject: s.subject, phase: s.phase });
      return toService(check(await client.from('services').upsert(row).select().single()));
    },

    async listEnrolments(filter = {}) {
      let q = client.from('enrolments').select('*');
      if (filter.studentId) q = q.eq('student_id', filter.studentId);
      return check(await q.order('subject')).map(toEnrolment);
    },
    async saveEnrolment(e) {
      // topic_list_id is never sent: the server links each enrolment to its shared list.
      const row = strip({
        id: e.id,
        student_id: e.studentId,
        subject: e.subject.trim(),
        curriculum: e.curriculum?.trim() || null,
        level: e.level?.trim() || null,
        exam_board: e.examBoard?.trim() || null,
        tutor_id: e.tutorId ?? null,
        syllabus_id: e.syllabusId ?? null,
        active: e.active,
      });
      return toEnrolment(check(await client.from('enrolments').upsert(row).select().single()));
    },
    async listTopicLists() {
      return check(await client.from('topic_lists').select('*').order('name')).map(toTopicList);
    },
    async listTopics(filter = {}) {
      // PostgREST caps a response (1000 rows by default), so read the shared lists a page at a time.
      const rows: Row[] = [];
      for (let from = 0; ; from += TOPIC_PAGE) {
        let q = client.from('topics').select('*');
        if (filter.listId) q = q.eq('list_id', filter.listId);
        const page = check(await q.order('list_id').order('sort').order('id').range(from, from + TOPIC_PAGE - 1)) as Row[];
        rows.push(...page);
        if (page.length < TOPIC_PAGE) break;
      }
      return rows.map(toTopic);
    },
    async addTopic(input) {
      const row = check(
        await client.rpc('add_topic', { p_enrolment_id: input.enrolmentId, p_name: input.name, p_unit: input.unit ?? null }),
      ) as Row;
      return toTopic(row);
    },

    async createLessons(lessons) {
      const rows = lessons.map((l) =>
        strip({
          tutor_id: l.tutorId,
          student_ids: l.studentIds,
          service_id: l.serviceId,
          subject: l.subject,
          start_at: l.start,
          end_at: l.end,
          location: l.location,
          meeting_url: l.meetingUrl,
          address: l.address,
          series_id: l.seriesId,
        }),
      );
      return check(await client.from('lessons').insert(rows).select()).map(toLesson);
    },
    async rescheduleLesson(id, start, end) {
      check(await client.from('lessons').update({ start_at: start, end_at: end }).eq('id', id).eq('status', 'scheduled'));
    },
    async cancelLesson(id, reason, waiveFee) {
      return check(
        await client.rpc('cancel_lesson', { p_lesson_id: id, p_reason: reason, p_waive: !!waiveFee }),
      ) as CancellationOutcome;
    },
    async completeLesson(input) {
      check(
        await client.rpc('complete_lesson', {
          p_lesson_id: input.lessonId,
          p_status: input.status,
          p_attendance: input.attendance,
          p_summary: input.summary,
          p_private_note: input.privateNote ?? null,
          p_topic_ids: input.topicIds,
          p_ratings: input.ratings,
          p_homework: input.homework,
        }),
      );
      // complete_lesson stores the title and due date; details and attachments are added through save_homework.
      const rich = input.homework.filter((h) => h.details?.trim() || h.attachments?.length);
      if (rich.length === 0) return;
      // The lesson is already recorded at this point, so a failure here must not read as if nothing was saved.
      const unsaved: string[] = [];
      try {
        const created = check<Row[]>(await client.from('homework').select('id, student_id, title').eq('lesson_id', input.lessonId));
        for (const h of rich) {
          const match = created.find((r) => r.student_id === h.studentId && r.title.trim() === h.title.trim());
          if (!match) {
            unsaved.push(h.title.trim());
            continue;
          }
          try {
            check(
              await client.rpc(
                'save_homework',
                saveHomeworkArgs({
                  id: match.id,
                  studentId: h.studentId,
                  lessonId: input.lessonId,
                  title: h.title.trim(),
                  details: h.details?.trim() || undefined,
                  dueDate: h.dueDate,
                  attachments: h.attachments ?? [],
                }),
              ),
            );
          } catch {
            unsaved.push(h.title.trim());
          }
        }
      } catch {
        unsaved.push(...rich.map((h) => h.title.trim()));
      }
      if (unsaved.length) throw new PartialSaveError(lessonHomeworkWarning(unsaved));
    },
    async setHomeworkDone(id, done) {
      check(await client.rpc('set_homework_done', { p_id: id, p_done: done }));
    },

    // Homework and resources
    async getHomework(id) {
      const row = check(await client.from('homework').select('*').eq('id', id).maybeSingle());
      return row ? toHomework(row) : null;
    },
    async saveHomework(input) {
      return toHomework(firstRow(check(await client.rpc('save_homework', saveHomeworkArgs(input)))));
    },
    async listSubmissions(filter = {}) {
      let query = client.from('homework_submissions').select('*');
      if (filter.homeworkId) query = query.eq('homework_id', filter.homeworkId);
      if (filter.studentId) query = query.eq('student_id', filter.studentId);
      return check(await query.order('submitted_at', { ascending: false })).map(toSubmission);
    },
    async submitHomework(input) {
      const data = check(
        await client.rpc('submit_homework', { p_homework_id: input.homeworkId, p_note: input.note ?? null, p_files: input.files }),
      );
      return toSubmission(firstRow(data));
    },
    async giveFeedback(submissionId, feedback, mark) {
      check(await client.rpc('give_homework_feedback', { p_submission_id: submissionId, p_feedback: feedback, p_mark: mark ?? null }));
    },
    async listResources(filter = {}) {
      // list_resources hides which other families' children a resource is shared with.
      const rows = check<Row[] | null>(await client.rpc('list_resources', { p_student_id: filter.studentId ?? null }));
      return (rows ?? []).map(toResource);
    },
    async saveResource(input) {
      // uploaded_by, uploaded_by_name, visibility and student_ids are set by the database.
      const row = {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        subject: input.subject?.trim() || null,
        curriculum: input.curriculum?.trim() || null,
        level: input.level?.trim() || null,
        kind: input.kind,
        path: input.kind === 'file' ? (input.path ?? null) : null,
        url: input.kind === 'link' && input.url ? (normaliseLink(input.url) ?? input.url) : null,
        file_name: input.kind === 'file' ? (input.fileName ?? null) : null,
        mime_type: input.kind === 'file' ? (input.mimeType ?? null) : null,
        tags: input.tags,
      };
      const saved = input.id
        ? check(await client.from('resources').update(row).eq('id', input.id).select('id').single())
        : check(await client.from('resources').insert(row).select('id').single());
      // Read it back through list_resources, which lists only the caller's own students in student_ids.
      const rows = check<Row[] | null>(await client.rpc('list_resources', { p_student_id: null }));
      const found = (rows ?? []).find((r) => r.id === saved.id);
      if (!found) throw new Error('The resource was saved but could not be read back. Please refresh.');
      return toResource(found);
    },
    async deleteResource(id) {
      // delete_resource returns the stored path only when no homework or hand-in still uses the file.
      const path = check<string | null>(await client.rpc('delete_resource', { p_id: id }));
      if (path) {
        // Best effort: the library entry is gone even if the stored file cannot be removed.
        await client.storage.from('classwork').remove([path]).then(undefined, () => undefined);
      }
    },
    async shareResource(resourceId, studentId) {
      check(await client.rpc('share_resource', { p_resource_id: resourceId, p_student_id: studentId }));
    },
    async unshareResource(resourceId, studentId) {
      check(await client.rpc('unshare_resource', { p_resource_id: resourceId, p_student_id: studentId }));
    },

    async sellPackage(pkg) {
      const row = check(
        await client.rpc('sell_package', {
          p_family_id: pkg.familyId,
          p_name: pkg.name,
          p_service_id: pkg.serviceId ?? null,
          p_lessons_total: pkg.lessonsTotal,
          p_price: pkg.price,
          p_expires_at: pkg.expiresAt ?? null,
        }),
      );
      chargeIfAutopay(row as Row);
      return toInvoice(row as Row);
    },
    async invoiceUnbilled(familyId) {
      const row = check(await client.rpc('invoice_unbilled', { p_family_id: familyId })) as Row | null;
      if (row && row.id) chargeIfAutopay(row);
      return row && row.id ? toInvoice(row) : null;
    },
    async setInvoiceStatus(id, status) {
      const row = check(await client.from('invoices').update({ status }).eq('id', id).select('id, autopay_status').maybeSingle()) as Row | null;
      if (status === 'sent') chargeIfAutopay(row);
    },
    async recordPayment(invoiceId, amount, method, reference) {
      check(await client.from('payments').insert(strip({ invoice_id: invoiceId, amount, method, reference })));
    },
    async addMyChild(c) {
      check(
        await client.rpc('add_my_child', {
          p_full_name: c.fullName,
          p_school: c.school ?? null,
          p_year_group: c.yearGroup ?? null,
          p_phase: c.phase ?? null,
          p_subjects: addChildSubjects(c.subjects),
        }),
      );
    },
    async setFamilyStatus(familyId, status) {
      check(await client.from('families').update({ status }).eq('id', familyId));
    },
    async submitEnquiry(e) {
      check(
        await client.rpc('submit_enquiry', {
          p_parent_name: e.parentName,
          p_email: e.email ?? null,
          p_phone: e.phone ?? null,
          p_student_name: e.studentName ?? null,
          p_curriculum: e.curriculum ?? null,
          p_year_group: e.yearGroup ?? null,
          p_message: e.message ?? null,
          p_preferred_times: e.preferredTimes ?? null,
          p_source: e.source ?? 'app',
          p_subject: e.subject ?? null,
          p_phase: e.phase ?? null,
        }),
      );
    },
    async listEnquiries() {
      return check(await client.from('enquiries').select('*').order('created_at', { ascending: false })).map(toEnquiry);
    },
    async updateEnquiry(id, p) {
      const row = strip({
        status: p.status,
        source: p.source,
        parent_name: p.parentName,
        email: p.email,
        phone: p.phone,
        student_name: p.studentName,
        curriculum: p.curriculum,
        subject: p.subject,
        phase: p.phase,
        year_group: p.yearGroup,
        message: p.message,
        preferred_times: p.preferredTimes,
        family_id: p.familyId,
        student_id: p.studentId,
        trial_lesson_id: p.trialLessonId,
        next_action_at: p.nextActionAt,
        notes: p.notes,
        lost_reason: p.lostReason,
      });
      check(await client.from('enquiries').update(row).eq('id', id));
    },

    async listAvailability() {
      const rows = check(await client.from('availability').select('*').order('weekday').order('start_time'));
      return rows.map((r: Row): Availability => ({ id: r.id, tutorId: r.tutor_id, weekday: r.weekday, start: hhmm(r.start_time), end: hhmm(r.end_time) }));
    },
    async setAvailability(tutorId, blocks) {
      check(await client.from('availability').delete().eq('tutor_id', tutorId));
      if (blocks.length) {
        check(
          await client
            .from('availability')
            .insert(blocks.map((b) => ({ tutor_id: tutorId, weekday: b.weekday, start_time: b.start, end_time: b.end }))),
        );
      }
    },
    async listClosures() {
      const rows = check(await client.from('closures').select('*').order('start_date'));
      return rows.map((r: Row): Closure => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date }));
    },
    async saveClosure(c) {
      check(await client.from('closures').upsert(strip({ id: c.id, name: c.name, start_date: c.startDate, end_date: c.endDate })));
    },
    async deleteClosure(id) {
      check(await client.from('closures').delete().eq('id', id));
    },
    async listAbsences() {
      const rows = check(await client.from('tutor_absences').select('*').order('start_date'));
      return rows.map(
        (r: Row): TutorAbsence => ({ id: r.id, tutorId: r.tutor_id, startDate: r.start_date, endDate: r.end_date, reason: r.reason ?? undefined }),
      );
    },
    async saveAbsence(a) {
      check(
        await client
          .from('tutor_absences')
          .upsert(strip({ id: a.id, tutor_id: a.tutorId, start_date: a.startDate, end_date: a.endDate, reason: a.reason })),
      );
    },
    async deleteAbsence(id) {
      check(await client.from('tutor_absences').delete().eq('id', id));
    },
    async openSlots(i) {
      // The database works in Dubai local dates.
      const from = new Date(i.from).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
      const rows = check(
        await client.rpc('open_slots', {
          p_tutor_id: i.tutorId,
          p_from: from,
          p_days: i.days,
          p_duration_min: i.durationMin,
          p_ignore_lesson: i.ignoreLessonId ?? null,
        }),
      );
      return rows.map((r: Row) => ({ start: new Date(r.start_at).toISOString(), end: new Date(r.end_at).toISOString() }));
    },
    async listRequests() {
      return check(await client.from('lesson_requests').select('*').order('created_at', { ascending: false })).map(toRequest);
    },
    async requestLesson(r) {
      check(
        await client.rpc('request_lesson', {
          p_student_id: r.studentId,
          p_kind: r.kind,
          p_lesson_id: r.lessonId ?? null,
          p_tutor_id: r.tutorId,
          p_service_id: r.serviceId,
          p_start: r.start,
          p_note: r.note ?? null,
          p_subject: r.subject ?? null,
        }),
      );
    },
    async decideRequest(id, approve, response) {
      check(await client.rpc('decide_request', { p_id: id, p_approve: approve, p_response: response ?? null }));
    },
    async withdrawRequest(id) {
      check(await client.rpc('withdraw_request', { p_id: id }));
    },
    async reassignLesson(lessonId, tutorId) {
      check(await client.rpc('reassign_lesson', { p_lesson_id: lessonId, p_tutor_id: tutorId }));
    },

    async listThreads() {
      const rows = check(await client.rpc('my_threads'));
      return rows.map(
        (r: Row): Thread => ({
          familyId: r.family_id,
          familyName: r.family_name,
          parentName: r.parent_name,
          lastBody: r.last_body ?? undefined,
          lastSender: r.last_sender ?? undefined,
          lastAt: r.last_at ?? undefined,
          unread: r.unread ?? 0,
        }),
      );
    },
    async listMessages(familyId) {
      const rows = check(await client.from('messages').select('*').eq('family_id', familyId).order('created_at').limit(500));
      return rows.map(
        (r: Row): Message => ({
          id: r.id,
          familyId: r.family_id,
          senderId: r.sender_id ?? undefined,
          senderName: r.sender_name,
          senderRole: r.sender_role,
          body: r.body,
          createdAt: r.created_at,
        }),
      );
    },
    async sendMessage(familyId, body) {
      check(await client.rpc('send_message', { p_family_id: familyId, p_body: body }));
    },
    async markThreadRead(familyId) {
      check(await client.rpc('mark_thread_read', { p_family_id: familyId }));
    },
    async listAnnouncements() {
      const rows = check(await client.from('announcements').select('*').order('created_at', { ascending: false }).limit(50));
      return rows.map(
        (r: Row): Announcement => ({ id: r.id, createdAt: r.created_at, authorName: r.author_name, title: r.title, body: r.body, audience: r.audience }),
      );
    },
    async postAnnouncement(a) {
      const me = await loadProfile();
      check(await client.from('announcements').insert({ author_name: me?.fullName ?? 'Elite Education', title: a.title.trim(), body: a.body.trim(), audience: a.audience }));
    },
    async listOpportunities() {
      return check(await client.from('opportunities').select('*').order('created_at', { ascending: false })).map(toOpportunity);
    },
    async listBids() {
      const rows = check(await client.from('opportunity_bids').select('*').order('created_at'));
      return rows.map(
        (r: Row): OpportunityBid => ({
          id: r.id,
          createdAt: r.created_at,
          opportunityId: r.opportunity_id,
          tutorId: r.tutor_id,
          pitch: r.pitch,
          availability: r.availability ?? undefined,
          status: r.status,
        }),
      );
    },
    async saveOpportunity(o) {
      const row = strip({
        id: o.id,
        title: o.title.trim(),
        description: o.description,
        curriculum: o.curriculum,
        syllabus_id: o.syllabusId,
        subject: o.subject,
        phase: o.phase,
        student_id: o.studentId,
        enquiry_id: o.enquiryId,
        schedule: o.schedule,
        location: o.location,
        pay_rate: o.payRate,
        closes_on: o.closesOn,
        visibility: o.visibility,
        invited_tutor_ids: o.invitedTutorIds,
        status: o.status,
      });
      return toOpportunity(check(await client.from('opportunities').upsert(row).select().single()));
    },
    async placeBid(opportunityId, pitch, availability) {
      check(await client.rpc('place_bid', { p_opportunity_id: opportunityId, p_pitch: pitch, p_availability: availability ?? null }));
    },
    async withdrawBid(opportunityId) {
      check(await client.rpc('withdraw_bid', { p_opportunity_id: opportunityId }));
    },
    async awardOpportunity(bidId) {
      check(await client.rpc('award_opportunity', { p_bid_id: bidId }));
    },

    async submitTutorApplication(a) {
      check(
        await client.rpc('submit_tutor_application', {
          p_full_name: a.fullName,
          p_email: a.email,
          p_phone: a.phone ?? null,
          p_curricula: a.curricula,
          p_subjects: a.subjects ?? null,
          p_experience: a.experience ?? null,
          p_qualifications: a.qualifications ?? null,
          p_availability: a.availability ?? null,
          p_cv_path: a.cvPath ?? null,
          p_phases: a.phases ?? [],
        }),
      );
    },
    async listApplications() {
      const rows = check(await client.from('tutor_applications').select('*').order('created_at', { ascending: false }));
      return rows.map(
        (r: Row): TutorApplication => ({
          id: r.id,
          createdAt: r.created_at,
          fullName: r.full_name,
          email: r.email,
          phone: r.phone ?? undefined,
          curricula: r.curricula ?? [],
          subjects: r.subjects ?? undefined,
          phases: r.phases ?? [],
          experience: r.experience ?? undefined,
          qualifications: r.qualifications ?? undefined,
          availability: r.availability ?? undefined,
          cvPath: r.cv_path ?? undefined,
          status: r.status,
          notes: r.notes ?? undefined,
          tutorId: r.tutor_id ?? undefined,
        }),
      );
    },
    async updateApplication(id, p) {
      check(await client.from('tutor_applications').update(strip({ status: p.status, notes: p.notes, tutor_id: p.tutorId })).eq('id', id));
    },

    async getPaymentDetails(tutorId) {
      const r = check(await client.from('tutor_payment_details').select('*').eq('tutor_id', tutorId).maybeSingle()) as Row | null;
      return r
        ? { tutorId: r.tutor_id, accountName: r.account_name, bankName: r.bank_name, iban: r.iban, swift: r.swift ?? undefined, updatedAt: r.updated_at }
        : null;
    },
    async savePaymentDetails(d: PaymentDetails) {
      check(
        await client.from('tutor_payment_details').upsert({
          tutor_id: d.tutorId,
          account_name: d.accountName.trim(),
          bank_name: d.bankName.trim(),
          iban: d.iban.replace(/\s+/g, '').toUpperCase(),
          swift: d.swift?.trim().toUpperCase() || null,
          updated_at: new Date().toISOString(),
        }),
      );
    },
    async listTutorInvoices() {
      return check(await client.from('tutor_invoices').select('*').order('period_start', { ascending: false })).map(toTutorInvoice);
    },
    async createTutorInvoice(tutorId, month) {
      return check<string>(await client.rpc('create_tutor_invoice', { p_tutor_id: tutorId, p_month: month }));
    },
    async updateTutorInvoice(id, extras, notes) {
      check(await client.rpc('update_tutor_invoice', { p_id: id, p_extras: extras, p_notes: notes ?? null }));
    },
    async submitTutorInvoice(id) {
      check(await client.rpc('submit_tutor_invoice', { p_id: id }));
    },
    async reviewTutorInvoice(id, approve, comment) {
      check(await client.rpc('review_tutor_invoice', { p_id: id, p_approve: approve, p_comment: comment ?? null }));
    },
    async markTutorInvoicePaid(id, reference) {
      check(await client.rpc('mark_tutor_invoice_paid', { p_id: id, p_reference: reference ?? null }));
    },

    async listReportCycles() {
      const rows = check(await client.from('report_cycles').select('*').order('created_at', { ascending: false }));
      return rows.map(
        (r: Row): ReportCycle => ({ id: r.id, createdAt: r.created_at, name: r.name, startsOn: r.starts_on, dueDate: r.due_date, status: r.status }),
      );
    },
    async openReportCycle(name, startsOn, dueDate) {
      check(await client.rpc('open_report_cycle', { p_name: name, p_starts_on: startsOn, p_due: dueDate }));
    },
    async listStudentReports() {
      return check(await client.from('student_reports').select('*').order('updated_at', { ascending: false })).map(toReport);
    },
    async saveReport(id, f) {
      check(
        await client.rpc('save_report', {
          p_id: id,
          p_attainment: f.attainment ?? null,
          p_effort: f.effort ?? null,
          p_progress: f.progress ?? null,
          p_strengths: f.strengths ?? null,
          p_next_steps: f.nextSteps ?? null,
          p_comment: f.comment ?? null,
          p_ai_assisted: !!f.aiAssisted,
        }),
      );
    },
    async submitReport(id) {
      check(await client.rpc('submit_report', { p_id: id }));
    },
    async setReportStatus(id, status) {
      check(await client.rpc('set_report_status', { p_id: id, p_status: status }));
    },

    async listExpenses() {
      const rows = check(await client.from('expenses').select('*').order('date', { ascending: false }));
      return rows.map(
        (r: Row): Expense => ({
          id: r.id,
          date: r.date,
          category: r.category,
          description: r.description ?? undefined,
          amount: Number(r.amount),
          vatAmount: Number(r.vat_amount),
          receiptPath: r.receipt_path ?? undefined,
        }),
      );
    },
    async saveExpense(e) {
      check(
        await client.from('expenses').upsert(
          strip({ id: e.id, date: e.date, category: e.category, description: e.description, amount: e.amount, vat_amount: e.vatAmount, receipt_path: e.receiptPath }),
        ),
      );
    },
    async deleteExpense(id) {
      check(await client.from('expenses').delete().eq('id', id));
    },

    async uploadFile(bucket, folder, file) {
      const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
      const path = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
      const body = file.file ?? (await (await fetch(file.uri)).arrayBuffer());
      check(await client.storage.from(bucket).upload(path, body, { contentType: file.mimeType, upsert: false }));
      return path;
    },
    async fileUrl(bucket, path) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 3600);
      if (error) console.warn(`Could not open ${bucket}/${path}: ${error.message}`);
      return data?.signedUrl ?? null;
    },
    async removeFile(bucket, path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) console.warn(`Could not remove ${bucket}/${path}: ${error.message}`);
    },
    async aiAssist(request) {
      // The AI service is optional: any failure (not deployed, no key, offline) returns null so callers use templates.
      const { data, error } = await client.functions.invoke('ai-assist', { body: request });
      if (error || !data || data.error) return null;
      return data;
    },
    async startCardPayment(invoiceId) {
      // invokeResult shows the function's own message, e.g. when autopay is already charging this invoice.
      const data = await invokeResult<{ url: string }>(await client.functions.invoke('create-checkout', { body: { invoiceId } }));
      return { url: data.url };
    },

    // Google Calendar
    async listBusyBlocks(filter = {}) {
      let query = client.from('busy_blocks').select('id, tutor_id, start_at, end_at, source');
      if (filter.tutorId) query = query.eq('tutor_id', filter.tutorId);
      if (filter.to) query = query.lt('start_at', filter.to);
      if (filter.from) query = query.gt('end_at', filter.from);
      return check(await query.order('start_at')).map(toBusyBlock);
    },
    async getCalendarConnection() {
      const { data } = await client.auth.getUser();
      if (!data.user) return null;
      const row = check(
        await client.from('calendar_connections').select(CALENDAR_CONNECTION_COLUMNS).eq('profile_id', data.user.id).maybeSingle(),
      );
      return row ? toCalendarConnection(row) : null;
    },
    async connectGoogleCalendar() {
      if (Platform.OS === 'web') {
        const returnTo = calendarReturnTo(window.location.href);
        const data = check<{ url: string }>(await client.functions.invoke('google-connect', { body: { action: 'start', returnTo } }));
        window.location.assign(data.url);
        return 'redirecting';
      }
      const returnTo = AuthSession.makeRedirectUri({ scheme: 'eliteeducation', path: 'calendar-connected' });
      const data = check<{ url: string }>(await client.functions.invoke('google-connect', { body: { action: 'start', returnTo } }));
      const res = await WebBrowser.openAuthSessionAsync(data.url, returnTo);
      if (res.type !== 'success') return 'cancelled';
      const notice = connectResultNotice(res.url);
      if (notice?.tone === 'success') return 'connected';
      if (notice) throw new Error(notice.message);
      return 'cancelled';
    },
    async disconnectGoogleCalendar() {
      check(await client.functions.invoke('google-connect', { body: { action: 'disconnect' } }));
    },
    // Card payments: saved cards, autopay and top-ups
    async listPackageOffers() {
      // RLS returns only active offers to everyone but admins.
      return check(await client.from('package_offers').select('*').order('sort').order('lessons')).map(toOffer);
    },
    async savePackageOffer(o) {
      const row = strip({ id: o.id, name: o.name, service_id: o.serviceId ?? null, lessons: o.lessons, price: o.price, active: o.active, sort: o.sort });
      return toOffer(check(await client.from('package_offers').upsert(row).select().single()));
    },
    async deletePackageOffer(id) {
      check(await client.from('package_offers').delete().eq('id', id));
    },
    async setAutopay(familyId, enabled) {
      check(await client.rpc('set_autopay', { p_family_id: familyId, p_enabled: enabled }));
    },
    async buyPackageOffer(offerId) {
      const data = await invokeResult<{ url: string }>(await client.functions.invoke('create-checkout', { body: { offerId } }));
      return { url: data.url };
    },
    async openBillingPortal(familyId) {
      const body = familyId ? { familyId } : {};
      const data = await invokeResult<{ url: string }>(await client.functions.invoke('billing-portal', { body }));
      return { url: data.url };
    },
    async chargeSavedCard(invoiceId) {
      const data = await invokeResult<{ results?: (AutopayChargeResult & { invoiceId?: string })[] }>(
        await client.functions.invoke('charge-invoice', { body: { invoiceId } }),
      );
      const first = data?.results?.[0];
      return first ? { status: first.status, ...(first.error ? { error: first.error } : {}) } : { status: 'skipped' };
    },

    // Launch readiness: error reporting, system health, data export and account deletion
    async logAppError(e) {
      // Reporting must never cause another error: any failure (offline, not deployed) is swallowed.
      try {
        const { data, error } = await client.rpc('log_app_error', {
          p_message: e.message,
          p_stack: e.stack ?? null,
          p_route: e.route ?? null,
          p_platform: e.platform,
          p_app_version: e.appVersion ?? null,
          p_source: e.source,
          p_fingerprint: e.fingerprint ?? null,
        });
        return !error && data !== false;
      } catch {
        return false;
      }
    },
    async getSystemHealth() {
      return toSystemHealth(check<Row | null>(await client.rpc('system_health')));
    },
    async listAppErrors(limit = 50) {
      return check<Row[]>(await client.from('app_errors').select('*').order('created_at', { ascending: false }).limit(limit)).map(toAppError);
    },
    async listFunctionErrors(limit = 50) {
      return check<Row[]>(await client.from('function_errors').select('*').order('created_at', { ascending: false }).limit(limit)).map(toFunctionError);
    },
    async exportMyData() {
      return check<DataExport>(await client.rpc('export_my_data'));
    },
    async deleteMyAccount() {
      const data = await invokeResult<{ summary?: Row }>(await client.functions.invoke('delete-account', { body: {} }));
      // The login no longer exists, so only the session stored on this device is cleared.
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      return toDeletionSummary(data?.summary);
    },
    async listDeletionRequests() {
      return check<Row[]>(await client.from('deletion_requests').select('*').order('created_at', { ascending: false })).map(toDeletionRequest);
    },
    async recordDeletionRequest(target) {
      return check<string>(
        await client.rpc('admin_record_deletion_request', {
          p_profile_id: target.profileId ?? null,
          p_family_id: target.familyId ?? null,
          p_tutor_id: target.tutorId ?? null,
          p_reason: target.reason?.trim() || null,
        }),
      );
    },
    async cancelDeletionRequest(id) {
      check(await client.rpc('admin_cancel_deletion_request', { p_id: id }));
    },
    async processDeletionRequest(id) {
      const data = await invokeResult<{ summary?: Row }>(await client.functions.invoke('delete-account', { body: { requestId: id } }));
      return toDeletionSummary(data?.summary);
    },
  };
}
