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
import { connectResultNotice } from '@/domain/calendar-connection';
import type { CancellationOutcome } from '@/domain/scheduling';
import type {
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
  Invoice,
  Lesson,
  LessonNote,
  LessonPackage,
  Profile,
  Service,
  Settings,
  Student,
  Tutor,
  TopicRating,
} from '@/domain/types';

import { APPLE_NATIVE, appleNativeSignIn } from './apple-native';
import { AuthNotice, NOT_LINKED } from './messages';
import type { DataSource, SocialProvider, SocialSignInResult } from './source';

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
  curriculum: r.curriculum,
  syllabusId: r.syllabus_id,
  school: r.school ?? undefined,
  yearGroup: r.year_group ?? undefined,
  currentGrade: r.current_grade ?? undefined,
  targetGrade: r.target_grade ?? undefined,
  examDate: r.exam_date ?? undefined,
  notes: r.student_notes?.notes ?? undefined,
});

const toService = (r: Row): Service => ({ id: r.id, name: r.name, durationMin: r.duration_min, rate: Number(r.rate) });

const toLesson = (r: Row): Lesson => ({
  id: r.id,
  tutorId: r.tutor_id,
  studentIds: r.student_ids,
  serviceId: r.service_id,
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
});

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
  payments: (r.payments ?? []).map((p: Row) => ({
    id: p.id,
    invoiceId: p.invoice_id,
    amount: Number(p.amount),
    method: p.method,
    paidAt: p.paid_at,
    reference: p.reference ?? undefined,
  })),
});

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
      return check(await client.from('families').select('*').order('name')).map(toFamily);
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
      const row = strip({ id: t.id, full_name: t.fullName, email: t.email, phone: t.phone, hourly_pay: t.hourlyPay, subjects: t.subjects, color: t.color });
      return toTutor(check(await client.from('tutors').upsert(row).select().single()));
    },
    async saveFamily(f) {
      const row = strip({ id: f.id, name: f.name, parent_name: f.parentName, email: f.email, phone: f.phone, status: f.status });
      return toFamily(check(await client.from('families').upsert(row).select().single()));
    },
    async saveStudent(s) {
      const row = strip({
        id: s.id,
        family_id: s.familyId,
        full_name: s.fullName,
        curriculum: s.curriculum,
        syllabus_id: s.syllabusId,
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
      const row = strip({ id: s.id, name: s.name, duration_min: s.durationMin, rate: s.rate });
      return toService(check(await client.from('services').upsert(row).select().single()));
    },

    async createLessons(lessons) {
      const rows = lessons.map((l) =>
        strip({
          tutor_id: l.tutorId,
          student_ids: l.studentIds,
          service_id: l.serviceId,
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
    },
    async setHomeworkDone(id, done) {
      check(await client.rpc('set_homework_done', { p_id: id, p_done: done }));
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
      return toInvoice(row as Row);
    },
    async invoiceUnbilled(familyId) {
      const row = check(await client.rpc('invoice_unbilled', { p_family_id: familyId })) as Row | null;
      return row && row.id ? toInvoice(row) : null;
    },
    async setInvoiceStatus(id, status) {
      check(await client.from('invoices').update({ status }).eq('id', id));
    },
    async recordPayment(invoiceId, amount, method, reference) {
      check(await client.from('payments').insert(strip({ invoice_id: invoiceId, amount, method, reference })));
    },
    async addMyChild(c) {
      check(
        await client.rpc('add_my_child', {
          p_full_name: c.fullName,
          p_curriculum: c.curriculum,
          p_syllabus_id: c.syllabusId,
          p_school: c.school ?? null,
          p_year_group: c.yearGroup ?? null,
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
      const { data } = await client.storage.from(bucket).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },
    async aiAssist(request) {
      // The AI service is optional: any failure (not deployed, no key, offline) returns null so callers use templates.
      const { data, error } = await client.functions.invoke('ai-assist', { body: request });
      if (error || !data || data.error) return null;
      return data;
    },
    async startCardPayment(invoiceId) {
      const data = check(await client.functions.invoke('create-checkout', { body: { invoiceId } })) as { url: string };
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
  };
}
