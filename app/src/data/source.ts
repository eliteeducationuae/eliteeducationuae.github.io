import type { CancellationOutcome } from '@/domain/scheduling';
import type {
  ApplicationStatus,
  Expense,
  Opportunity,
  OpportunityBid,
  PaymentDetails,
  ReportCycle,
  ReportStatus,
  StudentReport,
  TutorApplication,
  TutorInvoice,
  TutorInvoiceItem,
  Announcement,
  Audience,
  Availability,
  AttendanceMark,
  Closure,
  Enquiry,
  FamilyStatus,
  LessonRequest,
  Message,
  Thread,
  TutorAbsence,
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
  /** Create a parent login. Returns 'confirm-email' if they must confirm with the emailed code first. */
  signUp?(email: string, password: string, details: SignUpDetails): Promise<'signed-in' | 'confirm-email'>;
  /** Confirm a sign-up with the 6-digit code from the email. */
  verifySignUpCode?(email: string, code: string): Promise<void>;
  /** Email the sign-up code again. */
  resendSignUpCode?(email: string): Promise<void>;
  /** Email a password-reset link. */
  resetPassword?(email: string): Promise<void>;
  /** Admin: lower-cased emails that have an app login. */
  loginEmails?(): Promise<string[]>;
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

  // Families: self-service and pipeline
  addMyChild(child: NewChild): Promise<void>;
  setFamilyStatus(familyId: string, status: FamilyStatus): Promise<void>;
  submitEnquiry(enquiry: NewEnquiry): Promise<void>;
  listEnquiries(): Promise<Enquiry[]>;
  updateEnquiry(id: string, patch: Partial<Omit<Enquiry, 'id' | 'createdAt'>>): Promise<void>;

  // Availability, closures, absences, booking
  listAvailability(): Promise<Availability[]>;
  /** Replace all of a tutor's weekly availability. */
  setAvailability(tutorId: string, blocks: Omit<Availability, 'id' | 'tutorId'>[]): Promise<void>;
  listClosures(): Promise<Closure[]>;
  saveClosure(closure: Omit<Closure, 'id'> & { id?: string }): Promise<void>;
  deleteClosure(id: string): Promise<void>;
  listAbsences(): Promise<TutorAbsence[]>;
  saveAbsence(absence: Omit<TutorAbsence, 'id'> & { id?: string }): Promise<void>;
  deleteAbsence(id: string): Promise<void>;
  openSlots(input: { tutorId: string; from: string; days: number; durationMin: number; ignoreLessonId?: string }): Promise<{ start: string; end: string }[]>;
  listRequests(): Promise<LessonRequest[]>;
  requestLesson(input: NewLessonRequest): Promise<void>;
  decideRequest(id: string, approve: boolean, response?: string): Promise<void>;
  withdrawRequest(id: string): Promise<void>;
  reassignLesson(lessonId: string, tutorId: string): Promise<void>;

  // Messaging
  listThreads(): Promise<Thread[]>;
  listMessages(familyId: string): Promise<Message[]>;
  sendMessage(familyId: string, body: string): Promise<void>;
  markThreadRead(familyId: string): Promise<void>;
  listAnnouncements(): Promise<Announcement[]>;
  postAnnouncement(a: { title: string; body: string; audience: Audience }): Promise<void>;

  // Roles tutors express interest in
  listOpportunities(): Promise<Opportunity[]>;
  listBids(): Promise<OpportunityBid[]>;
  saveOpportunity(o: NewOpportunity & { id?: string; status?: Opportunity['status'] }): Promise<Opportunity>;
  placeBid(opportunityId: string, pitch: string, availability?: string): Promise<void>;
  withdrawBid(opportunityId: string): Promise<void>;
  awardOpportunity(bidId: string): Promise<void>;

  // Hiring
  submitTutorApplication(a: NewTutorApplication): Promise<void>;
  listApplications(): Promise<TutorApplication[]>;
  updateApplication(id: string, patch: { status?: ApplicationStatus; notes?: string; tutorId?: string }): Promise<void>;

  // Tutor pay
  getPaymentDetails(tutorId: string): Promise<PaymentDetails | null>;
  savePaymentDetails(d: Omit<PaymentDetails, 'updatedAt'>): Promise<void>;
  listTutorInvoices(): Promise<TutorInvoice[]>;
  /** Build (or rebuild a draft of) a tutor's invoice for the month containing `month` (YYYY-MM-DD). Returns its id. */
  createTutorInvoice(tutorId: string, month: string): Promise<string>;
  updateTutorInvoice(id: string, extras: Omit<TutorInvoiceItem, 'lessonId'>[], notes?: string): Promise<void>;
  submitTutorInvoice(id: string): Promise<void>;
  reviewTutorInvoice(id: string, approve: boolean, comment?: string): Promise<void>;
  markTutorInvoicePaid(id: string, reference?: string): Promise<void>;

  // Student reports
  listReportCycles(): Promise<ReportCycle[]>;
  openReportCycle(name: string, startsOn: string, dueDate: string): Promise<void>;
  listStudentReports(): Promise<StudentReport[]>;
  saveReport(id: string, fields: ReportFields): Promise<void>;
  submitReport(id: string): Promise<void>;
  setReportStatus(id: string, status: Extract<ReportStatus, 'draft' | 'approved' | 'published'>): Promise<void>;

  // Money
  listExpenses(): Promise<Expense[]>;
  saveExpense(e: Omit<Expense, 'id'> & { id?: string }): Promise<void>;
  deleteExpense(id: string): Promise<void>;

  /** AI drafting (production only). Returns null when the AI service isn't available, so callers fall back to templates. */
  aiAssist?(request: AiRequest): Promise<AiResult | null>;
}

export interface NewOpportunity {
  title: string;
  description?: string;
  curriculum?: string;
  syllabusId?: string;
  studentId?: string;
  enquiryId?: string;
  schedule?: string;
  location?: string;
  payRate: number;
  closesOn?: string;
  visibility: Opportunity['visibility'];
  invitedTutorIds: string[];
}

export interface NewTutorApplication {
  fullName: string;
  email: string;
  phone?: string;
  curricula: string[];
  subjects?: string;
  experience?: string;
  qualifications?: string;
  availability?: string;
  cvPath?: string;
}

export interface ReportFields {
  attainment?: string;
  effort?: number;
  progress?: number;
  strengths?: string;
  nextSteps?: string;
  comment?: string;
  aiAssisted?: boolean;
}

export type AiRequest =
  | { task: 'report-draft'; reportId: string; facts: unknown }
  | { task: 'parent-update'; lessonId: string }
  | { task: 'insights'; figures: unknown };

export type AiResult =
  | { task: 'report-draft'; strengths: string; nextSteps: string; comment: string }
  | { task: 'parent-update'; message: string }
  | { task: 'insights'; summary: string };

export interface SignUpDetails {
  fullName: string;
  phone?: string;
}

export interface NewChild {
  fullName: string;
  curriculum: Student['curriculum'];
  syllabusId: string;
  school?: string;
  yearGroup?: string;
}

export interface NewEnquiry {
  parentName: string;
  email?: string;
  phone?: string;
  studentName?: string;
  curriculum?: string;
  yearGroup?: string;
  message?: string;
  preferredTimes?: string;
  source?: Enquiry['source'];
}

export interface NewLessonRequest {
  studentId: string;
  kind: LessonRequest['kind'];
  lessonId?: string;
  tutorId: string;
  serviceId: string;
  start: string;
  note?: string;
}
