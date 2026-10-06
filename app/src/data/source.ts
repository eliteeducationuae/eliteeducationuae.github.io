import type { AuditActor, AuditCursor, AuditFilter, AuditPage } from '@/domain/audit';
// Admissions advisory
import type {
  AdmissionsCase,
  AdmissionsCaseInput,
  AdmissionsDocument,
  AdmissionsDocumentInput,
  AdmissionsEvent,
  AdmissionsFeeInput,
  AdmissionsKeyDate,
  AdmissionsKeyDateInput,
  AdmissionsTarget,
  AdmissionsTargetInput,
  AdmissionsTask,
  AdmissionsTaskInput,
  AdvisoryUpdate,
  AdvisoryUpdateInput,
  AdvisoryUpdateKind,
  AdvisoryUpdateStatus,
} from '@/domain/admissions';
import type { EnrolmentDraft } from '@/domain/enrolments';
import type { HandoverSources } from '@/domain/handover';
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
  Enrolment,
  FamilyStatus,
  LessonRequest,
  Message,
  Thread,
  TutorAbsence,
  Charge,
  Family,
  FamilyContact,
  FamilyContactDraft,
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
  Topic,
  TopicList,
  TopicRating,
  AutopayStatus,
  PackageOffer,
  AccountantInvite,
  CreditNote,
  Refund,
  // Tutor vetting and onboarding
  HandbookAcknowledgement,
  HandbookVersion,
  TutorCompliance,
  TutorDocument,
  TutorDocumentType,
  VettingOverride,
  // Launch readiness
  AppErrorInput,
  AppErrorRow,
  DataExport,
  DeletionRequest,
  DeletionSummary,
  FunctionErrorRow,
  SystemHealth,
  Handover,
  LessonPlan,
} from '@/domain/types';

import type { ViewAsSession, ViewTarget } from './view-as';

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
export type StorageBucket =
  | 'applications'
  | 'receipts'
  | 'classwork'
  // Admissions advisory
  | 'admissions'
  // Tutor vetting and onboarding
  | 'vetting';

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

/** Session plans: what the tutor sends when saving a plan (the server sets the tutor and times). */
export type LessonPlanInput = Omit<LessonPlan, 'tutorId' | 'createdAt' | 'updatedAt'>;

/** WhatsApp reminder preferences: whether to send them, and the E.164 number (kept when opting out). */
export interface WhatsAppPrefs {
  optIn: boolean;
  number: string | null;
}

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
  /** Save the signed-in person's WhatsApp opt-in and number (E.164). Returns the refreshed profile. */
  setWhatsApp?(prefs: WhatsAppPrefs): Promise<Profile>;
  /**
   * Give the signed-in person (or, for an admin, the profile named) a new secret calendar feed address, so a feed
   * link that has been shared or leaked stops working at once. Returns the new token.
   */
  resetIcsToken?(profileId?: string): Promise<string>;
  /** Email a password-reset link. */
  resetPassword?(email: string): Promise<void>;
  /** Admin: lower-cased emails that have an app login. */
  loginEmails?(): Promise<string[]>;
  /** Store this device's push token for lesson reminders (production only). */
  savePushToken?(token: string): Promise<void>;
  /** Admin only: everyone who is not an admin and has a login (parents, students and tutors), for "View as". */
  listViewTargets?(): Promise<ViewTarget[]>;
  /**
   * Admin only: start a read-only view of the app as this person. The returned source is scoped to them and
   * refuses every change; call end() to finish. The admin's own sign-in is left untouched.
   */
  startViewAs?(profileId: string): Promise<ViewAsSession>;

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

  // Subjects: enrolments and shared topic lists
  /**
   * Enrolments of the students the caller can see. The custom rates are present only where the caller
   * may see them: tutorPay for admins and the enrolment's own tutor, familyPrice for admins and the family.
   */
  listEnrolments(filter?: { studentId?: string }): Promise<Enrolment[]>;
  /** Admins only. `active: false` removes the subject from use but keeps its history. */
  saveEnrolment(e: EnrolmentDraft & { studentId: string }): Promise<Enrolment>;
  /** Admins only. Sets or clears (null) the custom tutor pay and family price per hour for one enrolment. */
  setEnrolmentRates(input: { enrolmentId: string; tutorPay: number | null; familyPrice: number | null }): Promise<void>;
  listTopicLists(): Promise<TopicList[]>;
  listTopics(filter?: { listId?: string }): Promise<Topic[]>;
  /**
   * Adds a topic to the shared list for the enrolment's subject, curriculum and level (admins, and tutors who
   * teach that enrolment). Creates or reuses the list; the same name in the same unit returns the existing topic.
   */
  addTopic(input: { enrolmentId: string; name: string; unit?: string }): Promise<Topic>;

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

  // Family contacts
  /** The family's contacts, main contact first. Admins and the family see everything; a tutor who teaches the family sees names and relationships only; anyone else gets an empty list. */
  listFamilyContacts(familyId: string): Promise<FamilyContact[]>;
  /** Admins, or a parent for their own family. Making a contact the main one replaces the previous main contact. */
  saveFamilyContact(familyId: string, contact: FamilyContactDraft): Promise<FamilyContact>;
  /** Admins, or a parent for their own family. Never the main contact; a parent cannot remove the last contact who can sign in. */
  removeFamilyContact(contactId: string): Promise<void>;

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
  /**
   * Admin only: mark an enquiry or tutor application as spam (kept, but out of the pipeline) or as genuine.
   * With sendAck, marking as genuine also sends the usual thank-you email that was held back.
   */
  setSpamStatus(kind: 'enquiry' | 'application', id: string, spam: boolean, sendAck?: boolean): Promise<void>;

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

  // Card payments: saved cards, autopay and top-ups
  /** Admins see every offer; everyone else sees active ones. Sorted by position, then fewest lessons. */
  listPackageOffers(): Promise<PackageOffer[]>;
  /** Admin: create or update a top-up offer. */
  savePackageOffer(offer: Omit<PackageOffer, 'id'> & { id?: string }): Promise<PackageOffer>;
  /** Admin: remove a top-up offer. */
  deletePackageOffer(id: string): Promise<void>;
  /** The family's parent or an admin. Switching on needs a saved card (AUTOPAY_NO_CARD_MESSAGE otherwise). */
  setAutopay(familyId: string, enabled: boolean): Promise<void>;
  /** Parent: buy an offer by card. Production returns the Checkout url; the demo records the purchase at once. */
  buyPackageOffer(offerId: string): Promise<CardPaymentResult>;
  /** Production only: the Stripe page where a family manages its saved cards. Admins pass the family. */
  openBillingPortal?(familyId?: string): Promise<{ url: string }>;
  /** Admin: charge a sent invoice to the family's saved card now. */
  chargeSavedCard?(invoiceId: string): Promise<AutopayChargeResult>;

  // Audit trail
  /** Admins only: the audit trail, newest first. Pass the previous page's `next` to continue. */
  listAuditEvents?(filter: AuditFilter, page?: { before?: AuditCursor; limit?: number }): Promise<AuditPage>;
  /** Admins only: everyone who appears in the audit trail, for the person filter. */
  listAuditActors?(): Promise<AuditActor[]>;
  // Tax: credit notes, refunds and accountant access
  /** Admins and accountants see every credit note; parents their family's; others none. */
  listCreditNotes(filter?: { familyId?: string; invoiceId?: string }): Promise<CreditNote[]>;
  getCreditNote(id: string): Promise<CreditNote | null>;
  /** Admin: credit all or part of a sent or paid invoice. A full credit voids the invoice. */
  issueCreditNote(input: CreditNoteInput): Promise<CreditNote>;
  /** Admins and accountants see every refund; parents their family's; others none. */
  listRefunds(filter?: { familyId?: string; invoiceId?: string }): Promise<Refund[]>;
  /** Admin: return money against a payment. Card payments go back through Stripe; others are recorded. */
  refundPayment(input: RefundInput): Promise<Refund>;
  /** Admin: accountants invited to read the books. */
  listAccountants(): Promise<AccountantInvite[]>;
  /** Admin: invite an accountant. 'linked' when an accountant login with that email already exists. */
  inviteAccountant(email: string, fullName?: string): Promise<'invited' | 'linked'>;
  /** Admin: remove an accountant's invite and access. */
  removeAccountant(email: string): Promise<void>;

  // Admissions advisory
  // Admin sees every case; an adviser tutor only their own cases; parents and students their family's.
  // Families see documents only when shared with them (or their own uploads), updates only once sent,
  // and timeline events only when family-visible.
  listAdmissionsCases(filter?: { studentId?: string }): Promise<AdmissionsCase[]>;
  getAdmissionsCase(id: string): Promise<AdmissionsCase | null>;
  /** Admin creates and changes anything; the adviser may change the summary and status only. */
  saveAdmissionsCase(input: AdmissionsCaseInput): Promise<AdmissionsCase>;
  listAdmissionsTargets(filter?: { caseId?: string }): Promise<AdmissionsTarget[]>;
  saveAdmissionsTarget(input: AdmissionsTargetInput): Promise<AdmissionsTarget>;
  deleteAdmissionsTarget(id: string): Promise<void>;
  /** `from`/`to` are YYYY-MM-DD, inclusive on the due date. */
  listAdmissionsKeyDates(filter?: { caseId?: string; from?: string; to?: string }): Promise<AdmissionsKeyDate[]>;
  saveAdmissionsKeyDate(input: AdmissionsKeyDateInput): Promise<AdmissionsKeyDate>;
  deleteAdmissionsKeyDate(id: string): Promise<void>;
  listAdmissionsTasks(filter?: { caseId?: string }): Promise<AdmissionsTask[]>;
  saveAdmissionsTask(input: AdmissionsTaskInput): Promise<AdmissionsTask>;
  /** Families may tick off only tasks owned by the family. */
  setAdmissionsTaskDone(id: string, done: boolean): Promise<void>;
  deleteAdmissionsTask(id: string): Promise<void>;
  listAdmissionsDocuments(filter?: { caseId?: string }): Promise<AdmissionsDocument[]>;
  /** Record an uploaded file (bucket 'admissions'). Family uploads are always shared with the family. */
  addAdmissionsDocument(input: AdmissionsDocumentInput): Promise<AdmissionsDocument>;
  /** Also removes the stored file. Families may delete only their own uploads. */
  deleteAdmissionsDocument(id: string): Promise<void>;
  listAdvisoryUpdates(filter?: { caseId?: string }): Promise<AdvisoryUpdate[]>;
  saveAdvisoryUpdate(input: AdvisoryUpdateInput): Promise<AdvisoryUpdate>;
  /** Advisers move draft and submitted only; the admin approves and publishes (a published update is final). */
  setAdvisoryUpdateStatus(id: string, status: AdvisoryUpdateStatus): Promise<void>;
  deleteAdvisoryUpdate(id: string): Promise<void>;
  /** Newest first. */
  listAdmissionsEvents(filter?: { caseId?: string }): Promise<AdmissionsEvent[]>;
  addAdmissionsMilestone(caseId: string, title: string, detail?: string): Promise<void>;
  /** Admin: raise a sent invoice for advisory fees, linked to the case. */
  billAdmissionsFee(input: AdmissionsFeeInput): Promise<Invoice>;

  // Tutor vetting and onboarding
  /** Newest first. Admins see every tutor's documents, tutors their own, everyone else none. */
  listTutorDocuments(filter?: { tutorId?: string }): Promise<TutorDocument[]>;
  /** A tutor (for themselves) or an admin records an uploaded document; it starts as pending review. */
  submitTutorDocument(input: NewTutorDocument): Promise<TutorDocument>;
  /** Admin: verify (with dates) or reject (with a note) a document. */
  reviewTutorDocument(id: string, decision: { approve: boolean; issueDate?: string; expiryDate?: string; note?: string }): Promise<void>;
  /** Delete a document record and, best effort, its stored file. */
  deleteTutorDocument(id: string): Promise<void>;
  /** Admins get every tutor, tutors their own row, everyone else none. */
  listTutorCompliance(): Promise<TutorCompliance[]>;
  /** Newest first, including revoked and expired overrides. */
  listVettingOverrides(filter?: { tutorId?: string }): Promise<VettingOverride[]>;
  /** Admin: allow assignments to a tutor who is not cleared, for `days` (1 to 90, default 30). The reason needs 10+ characters. */
  grantVettingOverride(tutorId: string, reason: string, days?: number): Promise<void>;
  revokeVettingOverride(id: string): Promise<void>;
  /** Whether assignments are blocked for tutors whose police clearance is not verified. */
  getVettingEnforced(): Promise<boolean>;
  setVettingEnforced(on: boolean): Promise<void>;
  /** Newest version first. */
  listHandbookVersions(): Promise<HandbookVersion[]>;
  /** Admin: publish a new handbook version; every tutor is asked to acknowledge it. */
  publishHandbook(title: string, body: string): Promise<HandbookVersion>;
  listHandbookAcknowledgements(filter?: { tutorId?: string }): Promise<HandbookAcknowledgement[]>;
  /** Tutor: acknowledge the current handbook version. */
  acknowledgeHandbook(version: number): Promise<void>;

  // Launch readiness: error reporting, system health, data export and account deletion
  /** Record an app error for the office. Never throws: returns false when it could not be recorded. */
  logAppError(e: AppErrorInput): Promise<boolean>;
  /** Admin: the system health report (checks, scheduled jobs and database version). */
  getSystemHealth(): Promise<SystemHealth>;
  /** Admin: the most recent app errors, newest first. */
  listAppErrors(limit?: number): Promise<AppErrorRow[]>;
  /** Admin: the most recent Edge Function errors, newest first. */
  listFunctionErrors(limit?: number): Promise<FunctionErrorRow[]>;
  /** Everything held about the signed-in person, for download. */
  exportMyData(): Promise<DataExport>;
  /** Delete the signed-in person's account (financial records are kept, anonymised). Signs out locally. */
  deleteMyAccount(): Promise<DeletionSummary>;
  /** Admin: deletion requests, newest first. */
  listDeletionRequests(): Promise<DeletionRequest[]>;
  /** Admin: record a deletion request received by email or telephone. Returns its id. */
  recordDeletionRequest(target: { profileId?: string; familyId?: string; tutorId?: string; reason?: string }): Promise<string>;
  /** Admin: cancel a pending deletion request. */
  cancelDeletionRequest(id: string): Promise<void>;
  /** Admin: carry out a pending or failed deletion request now. */
  processDeletionRequest(id: string): Promise<DeletionSummary>;

  // Session plans and handover packs
  getLessonPlan(lessonId: string): Promise<LessonPlan | null>;
  /** Plans of lessons starting in [from, to) that the caller can see. */
  listLessonPlans(range: { from: string; to: string }): Promise<LessonPlan[]>;
  /** The lesson's tutor or an admin; scheduled lessons only. */
  saveLessonPlan(input: LessonPlanInput): Promise<LessonPlan>;
  deleteLessonPlan(lessonId: string): Promise<void>;
  /** Admins: all. Tutors: those where they are the incoming or outgoing tutor. Newest first. */
  listHandovers(filter?: { studentId?: string; lessonId?: string }): Promise<Handover[]>;
  /** Raw material for a pack. Incoming tutor and admins only; throws otherwise. */
  getHandoverSources(id: string): Promise<HandoverSources>;
  /** The outgoing tutor or an admin. */
  saveHandoverNote(id: string, note: string): Promise<void>;
  /** The incoming tutor opened the pack. No-op for anyone else. */
  markHandoverViewed(id: string): Promise<void>;
}

// Tax: credit notes, refunds and accountant access

export interface CreditNoteLineInput {
  description: string;
  /** 0-based index of the invoice line being credited. */
  invoiceLine?: number;
  /** Net amount (before VAT) to credit. */
  net: number;
}

export interface CreditNoteInput {
  invoiceId: string;
  reason: string;
  /** Net amounts by line. Ignored when `gross` is given. */
  lines: CreditNoteLineInput[];
  /**
   * Credit this amount including VAT instead of by line: one line with the VAT worked out from the gross, so the
   * note's total is exactly this amount.
   */
  gross?: number;
  /**
   * Put the lessons on lines credited in full back to unbilled so they can be invoiced again. The note is marked
   * rebilled only when a lesson is actually released (never for a gross amount).
   */
  releaseCharges?: boolean;
}

export interface RefundInput {
  paymentId: string;
  /** Gross amount to return, AED. */
  amount: number;
  reason: string;
  /** Bank or cash reference for manual refunds. */
  reference?: string;
  /** How a refund recorded by hand went back. Defaults to the payment's own method. Ignored for card refunds. */
  method?: 'bank-transfer' | 'cash';
  /** Issue a credit note for the refunded amount at the same time. */
  withCreditNote: boolean;
  /** Unique per attempt so a retried request never refunds twice. */
  requestKey: string;
}

// Tutor vetting and onboarding

/** A document already uploaded to the 'vetting' bucket, to record for review. Dates are `YYYY-MM-DD`. */
export interface NewTutorDocument {
  tutorId: string;
  type: TutorDocumentType;
  filePath: string;
  fileName?: string;
  title?: string;
  issueDate?: string;
  expiryDate?: string;
}

/** Outcome of charging a saved card; 'skipped' when there was nothing to charge or no card/autopay. */
export interface AutopayChargeResult {
  status: AutopayStatus | 'skipped';
  error?: string;
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
  subject?: string;
  phase?: string;
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
  phases?: string[];
  experience?: string;
  qualifications?: string;
  availability?: string;
  cvPath?: string;
  /** Milliseconds from the form opening to submission; very fast submissions are marked as possible spam. */
  elapsedMs?: number;
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
  | { task: 'insights'; figures: unknown }
  // Admissions advisory
  | {
      task: 'admissions-update';
      caseId: string;
      kind: AdvisoryUpdateKind;
      period?: string;
      notes?: string;
      /** The names the app shows, used only when the server cannot read them itself. */
      addressee?: string;
      adviser?: string;
    };

export type AiResult =
  | { task: 'report-draft'; strengths: string; nextSteps: string; comment: string }
  | { task: 'parent-update'; message: string }
  | { task: 'insights'; summary: string }
  // Admissions advisory
  | { task: 'admissions-update'; title: string; body: string };

export interface SignUpDetails {
  fullName: string;
  phone?: string;
}

export interface NewChildSubject {
  subject: string;
  curriculum?: string;
  level?: string;
  examBoard?: string;
  /** A built-in course the family chose; the server keeps it only if it is built in and fits the subject. */
  syllabusId?: string;
}

export interface NewChild {
  fullName: string;
  school?: string;
  yearGroup?: string;
  phase?: string;
  /** 1 to 10 subjects. */
  subjects: NewChildSubject[];
}

export interface NewEnquiry {
  parentName: string;
  email?: string;
  phone?: string;
  studentName?: string;
  curriculum?: string;
  subject?: string;
  phase?: string;
  yearGroup?: string;
  message?: string;
  preferredTimes?: string;
  source?: Enquiry['source'];
  /** Milliseconds from the form opening to submission; very fast submissions are marked as possible spam. */
  elapsedMs?: number;
}

export interface NewLessonRequest {
  studentId: string;
  kind: LessonRequest['kind'];
  lessonId?: string;
  tutorId: string;
  serviceId: string;
  subject?: string;
  start: string;
  note?: string;
}
