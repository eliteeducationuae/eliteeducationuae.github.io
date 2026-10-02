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

export interface Family {
  id: string;
  name: string;
  parentName: string;
  email: string;
  phone?: string;
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
}
