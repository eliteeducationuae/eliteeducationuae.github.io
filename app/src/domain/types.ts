/**
 * Core domain model for Elite Education.
 * Kept free of React / Supabase so it can be unit tested and shared by every data source.
 */

export type Role = 'admin' | 'tutor' | 'parent' | 'student' | 'accountant';

/** Free text. The legacy values 'IB', 'IGCSE' and 'A-Level' remain valid. */
export type Curriculum = string;

export interface Profile {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  phone?: string;
  /** For role === 'tutor' — the tutor record this login belongs to. */
  tutorId?: string;
  /** For role === 'parent' — the family this login belongs to. */
  familyId?: string;
  /** For role === 'student' — the student record this login belongs to. */
  studentId?: string;
  /** Secret token for the personal calendar feed URL. */
  icsToken?: string;
  /** Whether this person has asked for reminders on WhatsApp (parents and tutors). */
  whatsappOptIn?: boolean;
  /** The WhatsApp number for reminders, in E.164 form, e.g. +971501234567. Kept when they opt out. */
  whatsappNumber?: string;
}

export type FamilyStatus = 'prospect' | 'active' | 'archived';

/**
 * A family. `parentName`, `email` and `phone` mirror the family's main contact
 * (see FamilyContact.isPrimary); the full list lives in the family's contacts.
 * Tutors read families by name only (public.family_directory): `email` is empty and `phone` absent for them.
 */
export interface Family {
  id: string;
  name: string;
  parentName: string;
  email: string;
  phone?: string;
  /** Prospects signed up or enquired but haven't enrolled yet. Defaults to active. */
  status?: FamilyStatus;
  createdAt?: string;
  /** Pay new invoices automatically with the saved card. Only present for admins and the family itself. */
  autopay?: boolean;
  /** The card kept on file for this family. Only present for admins and the family itself. */
  savedCard?: SavedCard;
  /** UAE Tax Registration Number of a company payer. Only present for admins and the family itself. */
  trn?: string;
  /** Address shown on tax invoices. Only present for admins and the family itself. */
  billingAddress?: string;
  /** Company or legal name billed on tax invoices (defaults to the parent's name). Only present for admins and the family itself. */
  billingName?: string;
  /** Set when the family's account was closed and anonymised. */
  deletedAt?: string;
}

export type ContactRelationship = 'mother' | 'father' | 'parent' | 'guardian' | 'pa' | 'family_office' | 'driver' | 'other';
export type ContactChannel = 'email' | 'phone' | 'whatsapp';

/**
 * One person the family wants us to keep in touch with: parents, guardians, a personal
 * assistant, a family office or a driver. Exactly one contact per family is the main one.
 *
 * Tutors who teach the family receive only id, familyId, name, relationship and isPrimary:
 * email and phone are undefined and every flag is false.
 */
export interface FamilyContact {
  id: string;
  familyId: string;
  name: string;
  relationship: ContactRelationship;
  email?: string;
  phone?: string;
  preferredChannel: ContactChannel;
  canLogIn: boolean;
  receivesInvoices: boolean;
  receivesReports: boolean;
  receivesLessonNotes: boolean;
  receivesWhatsApp: boolean;
  emergencyContact: boolean;
  isPrimary: boolean;
  /** True once this contact has signed in. */
  hasLogin: boolean;
  /** The linked login, for matching message senders. Absent for tutors. */
  profileId?: string;
  createdAt?: string;
}

export type FamilyContactDraft = Omit<FamilyContact, 'id' | 'familyId' | 'hasLogin' | 'profileId' | 'createdAt'> & { id?: string };

export interface Student {
  id: string;
  familyId: string;
  fullName: string;
  /** Legacy: subjects now live on enrolments. */
  curriculum?: string;
  /** Legacy: syllabus id from `src/data/curriculum.ts`, e.g. `ib-aa-hl`. Enrolments carry this now. */
  syllabusId?: string;
  /** Phase of education, e.g. 'Primary' (see PHASES in src/domain/catalogue.ts). */
  phase?: string;
  school?: string;
  yearGroup?: string;
  currentGrade?: string;
  targetGrade?: string;
  examDate?: string;
  /** Tutor-only notes (never shown to families). */
  notes?: string;
  /** Set when the student's record was anonymised because the account was closed. */
  deletedAt?: string;
}

export interface Tutor {
  id: string;
  fullName: string;
  /** Blank, like phone and hourlyPay, unless the viewer is an admin or this tutor (see 20261113001200_tutorpay_fix.sql). */
  email: string;
  phone?: string;
  /** Pay to the tutor in AED per hour taught. Only admins and the tutor themself may read it. */
  hourlyPay?: number;
  /** Subjects taught, e.g. 'Chemistry'. */
  subjects: string[];
  /** Curricula taught, e.g. 'IGCSE'. */
  curricula: string[];
  /** Phases taught, e.g. 'Primary'. */
  phases: string[];
  /** Calendar colour. */
  color: string;
  /** Set when the tutor's account was closed and anonymised. */
  deletedAt?: string;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  /** Price charged per student per lesson, AED. */
  rate: number;
  subject?: string;
  phase?: string;
}

/** One subject a student studies with us. */
export interface Enrolment {
  id: string;
  studentId: string;
  subject: string;
  curriculum?: string;
  level?: string;
  examBoard?: string;
  tutorId?: string;
  /** built-in maths tree id from src/data/curriculum.ts */
  syllabusId?: string;
  /** shared stored list, set by the server */
  topicListId?: string;
  active: boolean;
  createdAt?: string;
  /** Custom AED per hour paid to the tutor for this student and subject. Only present for admins and the teaching tutor. */
  tutorPay?: number;
  /** 'opportunity' when the pay was set by awarding an opportunity and not changed since. */
  tutorPaySource?: 'custom' | 'opportunity';
  /** Custom AED per hour charged to the family for this subject. Only present for admins and the family. */
  familyPrice?: number;
}

/** A shared topic list for one subject, curriculum and level. */
export interface TopicList {
  id: string;
  subject: string;
  curriculum?: string;
  level?: string;
  name: string;
  createdAt?: string;
}

export interface Topic {
  id: string;
  listId: string;
  unit?: string;
  name: string;
  sort: number;
  createdAt?: string;
}

export type LessonStatus = 'scheduled' | 'completed' | 'cancelled' | 'late-cancel' | 'no-show';

export type LessonLocation = 'online' | 'in-person';

export interface Lesson {
  id: string;
  tutorId: string;
  studentIds: string[];
  serviceId: string;
  subject?: string;
  /** ISO date-time. */
  start: string;
  /** ISO date-time. */
  end: string;
  location: LessonLocation;
  meetingUrl?: string;
  address?: string;
  status: LessonStatus;
  /** Lessons created together as a recurring series share this id. */
  seriesId?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export type AttendanceMark = 'present' | 'late' | 'absent';

export interface LessonNote {
  lessonId: string;
  summary: string;
  /** Tutor-only. */
  privateNote?: string;
  topicIds: string[];
  attendance: Record<string, AttendanceMark>;
  createdAt: string;
}

export interface Homework {
  id: string;
  studentId: string;
  lessonId?: string;
  title: string;
  dueDate: string;
  done: boolean;
  /** Instructions for the student. */
  details?: string;
  attachments?: Attachment[];
  /** The tutor who set it. */
  tutorId?: string;
  createdAt?: string;
}

/** A file or link attached to homework, a hand-in or a resource. Files live in the private `classwork` bucket. */
export interface Attachment {
  kind: 'file' | 'link';
  name: string;
  /** Storage path in the classwork bucket (files): students/<studentId>/… or resources/…. */
  path?: string;
  /** Web address (links), http or https only. */
  url?: string;
  mimeType?: string;
  /** Set when the attachment came from the resource library. */
  resourceId?: string;
}

/** A student's hand-in for a piece of homework, with the tutor's feedback once given. */
export interface HomeworkSubmission {
  id: string;
  homeworkId: string;
  studentId: string;
  submittedBy?: string;
  submittedByName?: string;
  note?: string;
  files: Attachment[];
  submittedAt: string;
  feedback?: string;
  mark?: string;
  feedbackAt?: string;
  feedbackBy?: string;
  feedbackByName?: string;
}

export type ResourceVisibility = 'tutors' | 'students';

/** An item in the shared resource library. */
export interface Resource {
  id: string;
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
  uploadedBy?: string;
  uploadedByName?: string;
  /** 'tutors' = library only; 'students' = also shared with studentIds. Tutors and admins always see every resource. */
  visibility: ResourceVisibility;
  studentIds: string[];
  createdAt: string;
}

/** One rating of how well a student understands a syllabus topic (1 = weak … 5 = secure). */
export interface TopicRating {
  id: string;
  studentId: string;
  topicId: string;
  lessonId?: string;
  rating: 1 | 2 | 3 | 4 | 5;
  ratedAt: string;
}

export interface LessonPackage {
  id: string;
  familyId: string;
  name: string;
  /** If set, credits only apply to lessons of this service. */
  serviceId?: string;
  lessonsTotal: number;
  lessonsUsed: number;
  price: number;
  purchasedAt: string;
  expiresAt?: string;
}

export type ChargeStatus = 'unbilled' | 'invoiced' | 'package';

/** What a single student owes for a single lesson. */
export interface Charge {
  id: string;
  lessonId: string;
  studentId: string;
  familyId: string;
  description: string;
  amount: number;
  status: ChargeStatus;
  invoiceId?: string;
  packageId?: string;
  date: string;
  /** 'custom' when the enrolment's family price was used instead of the service price. */
  priceSource?: 'service' | 'custom';
  /** The custom AED per hour the amount was worked out from (custom prices only). */
  hourlyPrice?: number;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  chargeId?: string;
  packageId?: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

export type PaymentMethod = 'card' | 'bank-transfer' | 'cash';

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  reference?: string;
  /** True when taken through Stripe and refundable by card. */
  viaStripe?: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  familyId: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  items: InvoiceItem[];
  vatRate: number;
  payments: Payment[];
  notes?: string;
  /** Progress of an automatic charge to the family's saved card, when autopay applies. */
  autopayStatus?: AutopayStatus;
  /** Why the last automatic charge failed, in words the family can act on. */
  autopayError?: string;
  /** Date of supply (the lessons or package), when different from the issue date. */
  supplyDate?: string;
  /** Supplier details frozen when the invoice was issued. */
  supplier?: TaxParty;
  /** Customer details frozen when the invoice was issued. */
  customer?: TaxParty;
  /** Credit notes issued against this invoice. */
  creditNotes?: CreditNoteRef[];
  /** Money returned to the family against this invoice. */
  refunds?: Refund[];
}

export interface Settings {
  businessName: string;
  currency: 'AED';
  /** 0.05 once VAT registered in the UAE. */
  vatRate: number;
  /** Cancellations with less notice than this are "late" and chargeable. */
  cancellationHours: number;
  /** Fraction of the lesson rate charged for a late cancellation (0–1). */
  lateCancelFee: number;
  /** Fraction of the lesson rate charged for a no-show (0–1). */
  noShowFee: number;
  /** Whether tutors are paid for late-cancelled / no-show lessons. */
  payTutorForLateCancel: boolean;
  invoiceDueDays: number;
  nextInvoiceNumber: number;
  bankDetails?: string;
  /** Where business alerts (new enquiries, requests) are emailed. Defaults to admin logins. */
  notifyEmail?: string;
  emailLessonNotes: boolean;
  emailInvoices: boolean;
  emailMessages: boolean;
  /** Parents can only request lessons at least this many hours ahead. */
  bookingNoticeHours: number;
  /** Registered legal name shown on tax invoices (falls back to businessName). */
  legalName?: string;
  /** UAE Tax Registration Number (15 digits). Invoices become tax invoices once set. */
  trn?: string;
  registeredAddress?: string;
  /** Extra line printed at the foot of invoices and credit notes. */
  invoiceFooter?: string;
  /** First month of the VAT quarter cycle the FTA assigned (1 = Jan/Apr/Jul/Oct). */
  vatQuarterStartMonth: VatQuarterStartMonth;
  nextCreditNoteNumber: number;
  /** Website forms must pass the Cloudflare Turnstile security check; submissions without it are kept but marked as possible spam. */
  captchaRequired?: boolean;
}

/** A weekly block when a tutor can teach. `weekday` 0 = Monday. Times are `HH:MM`. */
export interface Availability {
  id: string;
  tutorId: string;
  weekday: number;
  start: string;
  end: string;
}

/** Holidays and term breaks: no lessons are offered or scheduled. Dates are `YYYY-MM-DD`. */
export interface Closure {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface TutorAbsence {
  id: string;
  tutorId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

/** A time the tutor is busy in their own Google Calendar, copied by calendar-sync. Times only, never event details. */
export interface BusyBlock {
  id: string;
  tutorId: string;
  /** ISO date-time. */
  start: string;
  /** ISO date-time. */
  end: string;
  source: 'google';
}

export type CalendarConnectionStatus = 'connected' | 'error';

/** A tutor's or admin's link to their Google Calendar. Tokens never reach the app. */
export interface CalendarConnection {
  profileId: string;
  provider: 'google';
  googleEmail?: string;
  calendarId: string;
  status: CalendarConnectionStatus;
  lastSyncedAt?: string;
  lastError?: string;
}

/** How a public form submission looks: `suspected` and `spam` are kept but left out of the pipeline. */
export type SpamStatus = 'clean' | 'suspected' | 'spam';
/** Why a submission was marked as possible spam. */
export type SpamReason = 'link-in-name' | 'links' | 'too-fast' | 'captcha';

export type EnquiryStatus = 'new' | 'contacted' | 'trial-booked' | 'enrolled' | 'lost';
export type EnquirySource = 'app' | 'website' | 'referral' | 'phone' | 'other';

export interface Enquiry {
  id: string;
  createdAt: string;
  status: EnquiryStatus;
  source: EnquirySource;
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
  familyId?: string;
  studentId?: string;
  trialLessonId?: string;
  nextActionAt?: string;
  notes?: string;
  lostReason?: string;
  /** Undefined means clean. */
  spamStatus?: SpamStatus;
  spamReasons?: SpamReason[];
  /** How many repeat submissions were merged into this one. */
  repeatCount?: number;
  lastSubmittedAt?: string;
}

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** A parent asking for an extra lesson or to move one, at a specific open slot. */
export interface LessonRequest {
  id: string;
  createdAt: string;
  familyId: string;
  studentId: string;
  kind: 'new-lesson' | 'reschedule';
  lessonId?: string;
  tutorId: string;
  serviceId: string;
  subject?: string;
  start: string;
  end: string;
  note?: string;
  status: RequestStatus;
  response?: string;
  decidedAt?: string;
}

export interface Message {
  id: string;
  familyId: string;
  senderId?: string;
  senderName: string;
  senderRole: Role;
  body: string;
  createdAt: string;
}

/** A family conversation as listed in the inbox. */
export interface Thread {
  familyId: string;
  familyName: string;
  parentName: string;
  lastBody?: string;
  lastSender?: string;
  lastAt?: string;
  unread: number;
}

export type Audience = 'everyone' | 'parents' | 'tutors';

export interface Announcement {
  id: string;
  createdAt: string;
  authorName: string;
  title: string;
  body: string;
  audience: Audience;
}

// ---------------------------------------------------------------------------
// Running the business: roles, hiring, tutor pay, reports, expenses
// ---------------------------------------------------------------------------

export type OpportunityStatus = 'open' | 'awarded' | 'closed';

/** A student placement tutors can express interest in. Pay is set by the business. */
export interface Opportunity {
  id: string;
  createdAt: string;
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
  /** AED per hour paid to the tutor. */
  payRate: number;
  closesOn?: string;
  status: OpportunityStatus;
  visibility: 'all' | 'invited';
  invitedTutorIds: string[];
  awardedTutorId?: string;
  awardedAt?: string;
}

export type BidStatus = 'pending' | 'awarded' | 'declined' | 'withdrawn';

export interface OpportunityBid {
  id: string;
  createdAt: string;
  opportunityId: string;
  tutorId: string;
  pitch: string;
  availability?: string;
  status: BidStatus;
}

export type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'hired' | 'rejected';

export interface TutorApplication {
  id: string;
  createdAt: string;
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
  status: ApplicationStatus;
  notes?: string;
  tutorId?: string;
  /** Undefined means clean. */
  spamStatus?: SpamStatus;
  spamReasons?: SpamReason[];
  /** How many repeat submissions were merged into this one. */
  repeatCount?: number;
  lastSubmittedAt?: string;
}

export interface PaymentDetails {
  tutorId: string;
  accountName: string;
  bankName: string;
  iban: string;
  swift?: string;
  updatedAt?: string;
}

export type TutorInvoiceStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';

export interface TutorInvoiceItem {
  description: string;
  /** Hours for lessons; any quantity for extras. */
  quantity: number;
  unitPrice: number;
  lessonId?: string;
  /** 'custom' when a per-student pay rate set the unit price. */
  rateSource?: 'usual' | 'custom';
}

export interface TutorInvoice {
  id: string;
  createdAt: string;
  tutorId: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  status: TutorInvoiceStatus;
  items: TutorInvoiceItem[];
  notes?: string;
  adminComment?: string;
  submittedAt?: string;
  approvedAt?: string;
  paidAt?: string;
  paymentReference?: string;
}

export interface ReportCycle {
  id: string;
  createdAt: string;
  name: string;
  startsOn: string;
  dueDate: string;
  status: 'open' | 'closed';
}

export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'published';

export interface StudentReport {
  id: string;
  cycleId: string;
  studentId: string;
  tutorId: string;
  subject?: string;
  enrolmentId?: string;
  /** Working-at grade, e.g. "6" or "A". */
  attainment?: string;
  /** 1–5 */
  effort?: number;
  /** 1–5 */
  progress?: number;
  strengths?: string;
  nextSteps?: string;
  comment?: string;
  status: ReportStatus;
  aiAssisted: boolean;
  updatedAt: string;
  submittedAt?: string;
  publishedAt?: string;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  description?: string;
  amount: number;
  vatAmount: number;
  receiptPath?: string;
}

// ---------------------------------------------------------------------------
// Card payments: saved cards, autopay and top-ups
// ---------------------------------------------------------------------------

/** A family's card on file. Card numbers never leave Stripe; only these details are kept. */
export interface SavedCard {
  brand: string;
  last4: string;
  /** 'MM/YY' */
  expires?: string;
}

/** 'unknown': the card processor could not be reached mid-charge; the invoice stays held until the outcome is known. */
export type AutopayStatus = 'pending' | 'processing' | 'unknown' | 'succeeded' | 'failed';

/** A lesson package parents can buy themselves by card. */
export interface PackageOffer {
  id: string;
  name: string;
  /** Credits only apply to this lesson type when set. */
  serviceId?: string;
  lessons: number;
  /** AED, before VAT. */
  price: number;
  /** Shown to parents. */
  active: boolean;
  sort: number;
}

// ---------------------------------------------------------------------------
// Tax: credit notes, refunds and accountant access
// ---------------------------------------------------------------------------

/** A supplier or customer as printed on a tax document. */
export interface TaxParty {
  name: string;
  address?: string;
  trn?: string;
  email?: string;
}

/** 1 = quarters start Jan/Apr/Jul/Oct, 2 = Feb/May/Aug/Nov, 3 = Mar/Jun/Sep/Dec. */
export type VatQuarterStartMonth = 1 | 2 | 3;

/** The summary of a credit note carried on its invoice. */
export interface CreditNoteRef {
  id: string;
  number: string;
  issueDate: string;
  subtotal: number;
  vat: number;
  total: number;
  /** True when any lesson on the note was returned to be invoiced again. */
  rebilled: boolean;
  /**
   * The net of the lines whose lessons were returned to be invoiced again (a billing correction). The rest of the
   * subtotal is a true credit. Missing on older data: then the whole subtotal when rebilled, otherwise none.
   */
  rebilledNet?: number;
}

export interface CreditNoteLine {
  description: string;
  /** 0-based index of the invoice line credited, when it credits one. */
  invoiceLine?: number;
  net: number;
  vat: number;
  /** True when this line's lesson was returned to be invoiced again. */
  rebilled?: boolean;
}

export interface CreditNote extends CreditNoteRef {
  invoiceId: string;
  invoiceNumber: string;
  familyId: string;
  reason: string;
  vatRate: number;
  lines: CreditNoteLine[];
  supplier?: TaxParty;
  customer?: TaxParty;
  createdAt: string;
}

export type RefundStatus = 'pending' | 'succeeded' | 'failed';

export interface Refund {
  id: string;
  invoiceId: string;
  familyId: string;
  paymentId: string;
  amount: number;
  method: PaymentMethod;
  status: RefundStatus;
  reason: string;
  reference?: string;
  creditNoteId?: string;
  failureReason?: string;
  createdAt: string;
  settledAt?: string;
}

/** An accountant invited to read the books. */
export interface AccountantInvite {
  email: string;
  fullName?: string;
  invitedAt: string;
  acceptedAt?: string;
}

/** A VAT return period. Dates are YYYY-MM-DD, inclusive. */
export interface VatQuarter {
  start: string;
  end: string;
  /** e.g. 'Jan – Mar 2026' or 'Dec 2025 – Feb 2026'. */
  label: string;
}

export interface VatSummaryRow {
  kind: 'invoice' | 'credit-note' | 'expense';
  date: string;
  reference: string;
  party?: string;
  net: number;
  vatRate?: number;
  vat: number;
  gross: number;
}

export interface VatSummary {
  quarter: VatQuarter;
  invoiceCount: number;
  standardRatedNet: number;
  /** Net of credit notes against standard-rated invoices (shown as 'Less credit notes (net)'). */
  standardRatedCreditsNet: number;
  /** 0% invoices issued while the business had a TRN. */
  zeroRatedNet: number;
  /** 0% invoices issued without a TRN (before VAT registration): outside the scope of VAT, not zero-rated. */
  outOfScopeNet: number;
  outputVat: number;
  creditNoteCount: number;
  creditsNet: number;
  creditsVat: number;
  netOutputVat: number;
  expenseCount: number;
  expensesGross: number;
  inputVat: number;
  /** Negative when VAT is reclaimable. */
  netVatPayable: number;
  rows: VatSummaryRow[];
}

// ---------------------------------------------------------------------------
// Tutor vetting and onboarding
// ---------------------------------------------------------------------------

export type TutorDocumentType = 'police_clearance' | 'passport_id' | 'qualification' | 'other';
export type TutorDocumentReview = 'pending' | 'verified' | 'rejected';

/** A document a tutor uploads for vetting, e.g. a police clearance certificate. Dates are `YYYY-MM-DD`. */
export interface TutorDocument {
  id: string;
  tutorId: string;
  type: TutorDocumentType;
  title?: string;
  /** Path in the private 'vetting' bucket, `tutors/<tutorId>/<file>`. */
  filePath: string;
  fileName?: string;
  issueDate?: string;
  expiryDate?: string;
  status: TutorDocumentReview;
  reviewNote?: string;
  createdAt: string;
  verifiedAt?: string;
  verifiedByName?: string;
}

/** A tutor's police clearance position: 'expiring' is still cleared, within 60 days of expiry. */
export type VettingStatus = 'cleared' | 'expiring' | 'pending' | 'expired' | 'missing';

/** An administrator's time-limited permission to assign work to a tutor who is not yet cleared. */
export interface VettingOverride {
  id: string;
  tutorId: string;
  reason: string;
  createdAt: string;
  createdByName?: string;
  expiresAt: string;
  revokedAt?: string;
  revokedByName?: string;
}

/** One tutor's vetting and onboarding position (mirrors public.tutor_compliance()). */
export interface TutorCompliance {
  tutorId: string;
  vettingStatus: VettingStatus;
  /** Expiry of the police clearance that determines the status. */
  clearanceExpiry?: string;
  /** Documents of any type awaiting review. */
  documentsPending: number;
  bankDetails: boolean;
  availabilitySet: boolean;
  calendarConnected: boolean;
  whatsappOptIn: boolean;
  /** Current handbook version, if one has been published. */
  handbookVersion?: number;
  handbookAcknowledgedVersion?: number;
  onboardingStartedAt?: string;
  /** The active override, if any. `until` is an ISO time. */
  override?: { id: string; reason: string; until: string };
  /** Whether assignments are blocked for tutors who are not cleared. */
  enforced: boolean;
}

export interface HandbookVersion {
  id: string;
  version: number;
  title: string;
  /** Markdown. */
  body: string;
  publishedAt: string;
  publishedByName?: string;
}

export interface HandbookAcknowledgement {
  tutorId: string;
  version: number;
  acknowledgedAt: string;
}

// ---------------------------------------------------------------------------
// Launch readiness: error reporting, system health, data export and account deletion

/** Where an app error was caught. */
export type AppErrorSource = 'boundary' | 'query' | 'mutation' | 'global' | 'manual';

export type AppPlatform = 'ios' | 'android' | 'web' | 'unknown';

/** What the app sends to log_app_error. Never contains profile fields; messages are scrubbed of personal data first. */
export interface AppErrorInput {
  message: string;
  stack?: string;
  route?: string;
  platform: AppPlatform;
  appVersion?: string;
  source: AppErrorSource;
  fingerprint?: string;
}

/** An app error as administrators see it. */
export interface AppErrorRow {
  id: string;
  createdAt: string;
  profileId?: string;
  role?: string;
  platform: AppPlatform;
  appVersion?: string;
  route?: string;
  source: AppErrorSource;
  message: string;
  stack?: string;
  fingerprint?: string;
}

/** A failure recorded by an Edge Function. */
export interface FunctionErrorRow {
  id: string;
  createdAt: string;
  functionName: string;
  message: string;
  status?: number;
  context?: Record<string, unknown>;
}

export type HealthStatus = 'ok' | 'warning' | 'failing';

export interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  /** A full sentence explaining the state. */
  detail: string;
  count?: number;
}

export interface HealthJob {
  name: string;
  lastStartedAt?: string;
  lastSucceededAt?: string;
  lastFailedAt?: string;
  lastError?: string;
}

export interface MigrationRecord {
  version: string;
  name: string;
  appliedAt?: string;
}

export interface SystemHealth {
  checkedAt: string;
  status: HealthStatus;
  checks: HealthCheck[];
  jobs: HealthJob[];
  database: { latest: string; latestName: string; count: number; migrations: MigrationRecord[] };
}

export type DeletionRequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type DeletionTargetKind = 'profile' | 'family' | 'tutor';

/** What an account deletion removed and kept. */
export interface DeletionSummary {
  role?: Role;
  familyAnonymised?: boolean;
  studentsAnonymised?: number;
  futureLessonsCancelled?: number;
  upcomingLessonsNeedingTutor?: number;
  invoicesRetained?: number;
  paymentsRetained?: number;
  /** Kept with the invoices and payments for tax records (families only). */
  creditNotesRetained?: number;
  refundsRetained?: number;
  /** True when a family contact who is not the main contact closed only their own login; the family stays open. */
  loginOnly?: boolean;
}

export interface DeletionRequest {
  id: string;
  createdAt: string;
  status: DeletionRequestStatus;
  targetKind: DeletionTargetKind;
  profileId?: string;
  familyId?: string;
  tutorId?: string;
  role?: Role;
  label: string;
  reason?: string;
  completedAt?: string;
  summary: DeletionSummary;
  error?: string;
}

/** The signed-in person's data, as returned by export_my_data. Sections are loosely typed: they are passed through to the file. */
export interface DataExport extends Record<string, unknown> {
  format: 'elite-education-export/1';
  exportedAt: string;
  account: Record<string, unknown>;
  family?: Record<string, unknown> | null;
  tutor?: Record<string, unknown> | null;
  paymentDetails?: { accountName?: string; bankName?: string; ibanLast4?: string } | null;
}

// ---------------------------------------------------------------------------
// Session plans and handover packs
// ---------------------------------------------------------------------------

/** Homework the tutor intends to set; no studentId = every student in the lesson. */
export interface PlannedHomework {
  studentId?: string;
  title: string;
  details?: string;
}

/** A tutor's plan for an upcoming lesson. One per lesson. */
export interface LessonPlan {
  lessonId: string;
  /** The lesson's tutor when the plan was saved. */
  tutorId?: string;
  objectives: string;
  topicIds: string[];
  resourceIds: string[];
  homework: PlannedHomework[];
  /** Parents and the student can read the plan when true. */
  sharedWithFamily: boolean;
  createdAt?: string;
  updatedAt: string;
}

/** Why a tutor received a handover pack: covering one lesson, taking over a subject, or winning a new student. */
export type HandoverReason = 'cover' | 'reassigned' | 'awarded';

/** A student passing from one tutor to another, with the outgoing tutor's note. */
export interface Handover {
  id: string;
  createdAt: string;
  reason: HandoverReason;
  studentId: string;
  /** The student's name when the handover was made, for a tutor who cannot see the student yet. */
  studentName?: string;
  subject?: string;
  enrolmentId?: string;
  lessonId?: string;
  opportunityId?: string;
  fromTutorId?: string;
  toTutorId: string;
  /** The outgoing tutor's handover note. */
  note?: string;
  noteUpdatedAt?: string;
  viewedAt?: string;
}
