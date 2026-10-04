import type { CancellationOutcome } from '@/domain/scheduling';
import type {
  ApplicationStatus,
  Attachment,
  HomeworkSubmission,
  Resource,
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
  BusyBlock,
  CalendarConnection,
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
  homework: { studentId: string; title: string; dueDate: string; details?: string; attachments?: Attachment[] }[];
}

/** Private storage buckets files can be uploaded to. */
export type StorageBucket = 'applications' | 'receipts' | 'classwork';

/** New homework (no id) or an edit to existing homework. */
export interface HomeworkInput {
  id?: string;
  studentId: string;
  lessonId?: string;
  title: string;
  details?: string;
  dueDate: string;
  attachments: Attachment[];
}

/**
 * Thrown when the main change was saved but a follow-up step was not, for example a lesson recorded
 * whose homework attachments could not be added. The message says what to finish by hand.
 */
export class PartialSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartialSaveError';
  }
}

/** A new library resource (no id) or an edit to one. */
export interface ResourceInput {
  id?: string;
  title: string;
  description?: string;
  subject?: string;
  curriculum?: string;
  level?: string;
  kind: 'file' | 'link';
  path?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  tags: string[];
}

/** Third-party sign-in providers offered on the sign-in screen. */
export type SocialProvider = 'apple' | 'google';

/**
 * Outcome of signInWithProvider: signed straight in, leaving the page for the provider (web; the result
 * arrives through restoreSession after the redirect), or cancelled by the person.
 */
export type SocialSignInResult = { status: 'signed-in'; profile: Profile } | { status: 'redirecting' } | { status: 'cancelled' };

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
  /**
   * Sign in with Apple or Google. On the web this redirects the page away ('redirecting'); on devices it
   * opens the provider's sheet or browser and returns the signed-in profile, or 'cancelled'. Throws
   * NOT_LINKED if the login has no profile, and a friendly message if the provider is not switched on.
   */
  signInWithProvider?(provider: SocialProvider): Promise<SocialSignInResult>;
  /**
   * A parent saves their own name, e.g. after an Apple sign-in that shared none. Renames a prospect family too;
   * a name the office has recorded for an active family is left alone. Returns the refreshed profile.
   */
  setMyName?(fullName: string): Promise<Profile>;
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
  listHomework(filter?: { studentId?: string; lessonId?: string }): Promise<Homework[]>;
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

  // Homework and resources
  getHomework(id: string): Promise<Homework | null>;
  /** Tutors (for students they teach) and admins: set new homework or edit its title, details, due date and attachments. */
  saveHomework(input: HomeworkInput): Promise<Homework>;
  listSubmissions(filter?: { homeworkId?: string; studentId?: string }): Promise<HomeworkSubmission[]>;
  /** Students and parents hand in work (note and/or files). Marks the homework done and tells the tutor. */
  submitHomework(input: { homeworkId: string; note?: string; files: Attachment[] }): Promise<HomeworkSubmission>;
  /** The student's tutor or an admin: written feedback and an optional mark. Tells the student and family. */
  giveFeedback(submissionId: string, feedback: string, mark?: string): Promise<void>;
  /** Tutors/admin: the whole library. Students/parents: resources shared with them. Optional filter to one student's shared resources. */
  listResources(filter?: { studentId?: string }): Promise<Resource[]>;
  saveResource(input: ResourceInput): Promise<Resource>;
  deleteResource(id: string): Promise<void>;
  /** Share a library resource with a student (and their family). */
  shareResource(resourceId: string, studentId: string): Promise<void>;
  /** Stop sharing a library resource with a student. */
  unshareResource(resourceId: string, studentId: string): Promise<void>;

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

  /** Upload a picked file to private storage. Returns the stored path. */
  uploadFile?(bucket: StorageBucket, folder: string, file: PickedFile): Promise<string>;
  /** A short-lived link to view a stored file. Null when the file cannot be reached (removed, refused or offline). */
  fileUrl?(bucket: StorageBucket, path: string): Promise<string | null>;
  /** Remove a file the signed-in user uploaded, e.g. an attachment removed before saving. Best effort. */
  removeFile?(bucket: StorageBucket, path: string): Promise<void>;

  /** AI drafting (production only). Returns null when the AI service isn't available, so callers fall back to templates. */
  aiAssist?(request: AiRequest): Promise<AiResult | null>;

  // Google Calendar (tutors and admin)
  /** Google busy times. Admins see every tutor's, tutors their own, families none. */
  listBusyBlocks?(filter?: { tutorId?: string; from?: string; to?: string }): Promise<BusyBlock[]>;
  /** The signed-in tutor's or admin's Google Calendar link, or null. */
  getCalendarConnection?(): Promise<CalendarConnection | null>;
  /** Start connecting Google Calendar. Production returns once the browser flow finishes; the demo connects at once. */
  connectGoogleCalendar?(): Promise<'connected' | 'cancelled' | 'redirecting'>;
  disconnectGoogleCalendar?(): Promise<void>;
}

export interface PickedFile {
  name: string;
  uri: string;
  mimeType?: string;
  /** Present on web. */
  file?: Blob;
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
