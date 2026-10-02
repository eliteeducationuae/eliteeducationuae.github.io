import type { CancellationOutcome } from '@/domain/scheduling';
import type {
  AttendanceMark,
  Charge,
  Family,
  Homework,
  Invoice,
  InvoiceStatus,
  Lesson,
  LessonNote,
  LessonPackage,
  LessonStatus,
  PaymentMethod,
  Profile,
  Service,
  Settings,
  Student,
  Tutor,
  TopicRating,
} from '@/domain/types';

export interface CompleteLessonInput {
  lessonId: string;
  status: Extract<LessonStatus, 'completed' | 'no-show'>;
  attendance: Record<string, AttendanceMark>;
  summary: string;
  privateNote?: string;
  topicIds: string[];
  /** Per-student topic ratings. */
  ratings: { studentId: string; topicId: string; rating: TopicRating['rating'] }[];
  homework: { studentId: string; title: string; dueDate: string }[];
}

export type NewLesson = Omit<Lesson, 'id' | 'status'>;

export interface CardPaymentResult {
  /** Stripe Checkout URL to open (production). */
  url?: string;
  /** True when the payment was recorded immediately (demo). */
  paid?: boolean;
}

/**
 * Everything the app can read or do. Every implementation must apply the same visibility rules:
 * admins see everything; tutors see their own lessons and students; parents see their family;
 * students see themselves. Private tutor notes are never returned to parents or students.
 */
export interface DataSource {
  readonly kind: 'demo' | 'supabase';

  // Auth
  restoreSession(): Promise<Profile | null>;
  signIn(email: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;
  /** Demo only: quick sign-in accounts. */
  demoAccounts?(): Profile[];
  /** Demo only: wipe and reseed. */
  resetDemo?(): Promise<void>;
  /** Store this device's push token for lesson reminders (production only). */
  savePushToken?(token: string): Promise<void>;

  // Reads
  getSettings(): Promise<Settings>;
  listTutors(): Promise<Tutor[]>;
  listFamilies(): Promise<Family[]>;
  listStudents(): Promise<Student[]>;
  listServices(): Promise<Service[]>;
  listLessons(range: { from: string; to: string }): Promise<Lesson[]>;
  getLesson(id: string): Promise<Lesson | null>;
  listNotes(filter?: { studentId?: string; lessonId?: string }): Promise<LessonNote[]>;
  listHomework(filter?: { studentId?: string }): Promise<Homework[]>;
  listRatings(filter?: { studentId?: string }): Promise<TopicRating[]>;
  listPackages(filter?: { familyId?: string }): Promise<LessonPackage[]>;
  listCharges(filter?: { familyId?: string }): Promise<Charge[]>;
  listInvoices(filter?: { familyId?: string }): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;

  // Admin set-up
  saveSettings(patch: Partial<Settings>): Promise<void>;
  saveTutor(tutor: Omit<Tutor, 'id'> & { id?: string }): Promise<Tutor>;
  saveFamily(family: Omit<Family, 'id'> & { id?: string }): Promise<Family>;
  saveStudent(student: Omit<Student, 'id'> & { id?: string }): Promise<Student>;
  saveService(service: Omit<Service, 'id'> & { id?: string }): Promise<Service>;

  // Scheduling
  createLessons(lessons: NewLesson[]): Promise<Lesson[]>;
  rescheduleLesson(id: string, start: string, end: string): Promise<void>;
  /** Applies the cancellation policy (late cancellations are charged unless waived by an admin). */
  cancelLesson(id: string, reason: string, waiveFee?: boolean): Promise<CancellationOutcome>;
  completeLesson(input: CompleteLessonInput): Promise<void>;
  setHomeworkDone(id: string, done: boolean): Promise<void>;

  // Billing
  sellPackage(pkg: Omit<LessonPackage, 'id' | 'lessonsUsed' | 'purchasedAt'>): Promise<Invoice>;
  /** Invoice all of a family's unbilled charges. Returns null if nothing to bill. */
  invoiceUnbilled(familyId: string): Promise<Invoice | null>;
  setInvoiceStatus(id: string, status: InvoiceStatus): Promise<void>;
  recordPayment(invoiceId: string, amount: number, method: PaymentMethod, reference?: string): Promise<void>;
  startCardPayment(invoiceId: string): Promise<CardPaymentResult>;
}
