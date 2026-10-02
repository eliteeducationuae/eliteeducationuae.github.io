import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { CancellationOutcome } from '@/domain/scheduling';
import type {
  Charge,
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

import { NOT_LINKED } from './messages';
import type { DataSource } from './source';

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
  });

const toTutor = (r: Row): Tutor => ({
  id: r.id,
  fullName: r.full_name,
  email: r.email,
  phone: r.phone ?? undefined,
  hourlyPay: Number(r.hourly_pay),
  subjects: r.subjects ?? [],
  color: r.color,
});

const toFamily = (r: Row): Family => ({
  id: r.id,
  name: r.name,
  parentName: r.parent_name,
  email: r.email,
  phone: r.phone ?? undefined,
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

  return {
    kind: 'supabase',

    restoreSession: loadProfile,
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
    async signUp(email, password) {
      const data = check(await client.auth.signUp({ email: email.trim(), password }));
      return data.session ? 'signed-in' : 'confirm-email';
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
      const row = strip({ id: f.id, name: f.name, parent_name: f.parentName, email: f.email, phone: f.phone });
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
    async startCardPayment(invoiceId) {
      const data = check(await client.functions.invoke('create-checkout', { body: { invoiceId } })) as { url: string };
      return { url: data.url };
    },
  };
}
