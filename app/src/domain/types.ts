/**
 * Core domain model for Elite Education.
 * Kept free of React / Supabase so it can be unit tested and shared by every data source.
 */

export type Role = 'admin' | 'tutor' | 'parent' | 'student';

export type Curriculum = 'IB' | 'IGCSE' | 'A-Level';

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
}

export type FamilyStatus = 'prospect' | 'active' | 'archived';

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
}

export interface Student {
  id: string;
  familyId: string;
  fullName: string;
  curriculum: Curriculum;
  /** Syllabus id from `src/data/curriculum.ts`, e.g. `ib-aa-hl`. */
  syllabusId: string;
  school?: string;
  yearGroup?: string;
  currentGrade?: string;
  targetGrade?: string;
  examDate?: string;
  /** Tutor-only notes (never shown to families). */
  notes?: string;
}

export interface Tutor {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  /** Pay to the tutor in AED per hour taught. */
  hourlyPay: number;
  subjects: string[];
  /** Calendar colour. */
  color: string;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  /** Price charged per student per lesson, AED. */
  rate: number;
}

export type LessonStatus = 'scheduled' | 'completed' | 'cancelled' | 'late-cancel' | 'no-show';

export type LessonLocation = 'online' | 'in-person';

export interface Lesson {
  id: string;
  tutorId: string;
  studentIds: string[];
  serviceId: string;
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
  yearGroup?: string;
  message?: string;
  preferredTimes?: string;
  familyId?: string;
  studentId?: string;
  trialLessonId?: string;
  nextActionAt?: string;
  notes?: string;
  lostReason?: string;
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
  experience?: string;
  qualifications?: string;
  availability?: string;
  cvPath?: string;
  status: ApplicationStatus;
  notes?: string;
  tutorId?: string;
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

export type AutopayStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

/** A lesson bundle parents can buy themselves by card. */
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
