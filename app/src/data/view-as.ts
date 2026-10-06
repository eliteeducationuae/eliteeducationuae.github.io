/**
 * Admin "View as": an admin sees the app exactly as a parent, student or tutor sees it, read-only.
 *
 * This module has no runtime imports from session.ts or index.ts, so any of them (and query.ts) can import it
 * without creating a cycle. Writes are refused here, in the client, and again by the server, which rejects
 * every change made with a view token.
 */
import { create } from 'zustand';

import type { Profile } from '@/domain/types';

import type { DataSource } from './source';

/** Shown when a change is attempted while viewing as someone else. Matches the server's message exactly. */
export const VIEW_ONLY_MESSAGE = 'Viewing only — changes are disabled.';
/** Shown when the view has expired or been ended. Matches the server's message exactly. */
export const VIEW_ENDED_MESSAGE = 'This view has ended. Please return to your own account.';

/** A change was attempted while an admin is viewing as someone else. */
export class ViewOnlyError extends Error {
  constructor() {
    super(VIEW_ONLY_MESSAGE);
    this.name = 'ViewOnlyError';
    Object.setPrototypeOf(this, ViewOnlyError.prototype);
  }
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : '';

/** True for a ViewOnlyError, or any error carrying the server's view-only message. */
export function isViewOnlyError(err: unknown): boolean {
  return err instanceof ViewOnlyError || messageOf(err).includes(VIEW_ONLY_MESSAGE);
}

/** True when the server says the view has ended (expired, or ended from another device). */
export function isViewEndedError(err: unknown): boolean {
  return messageOf(err).includes(VIEW_ENDED_MESSAGE);
}

/** Someone with a login an admin can view as. */
export type ViewTarget = {
  profileId: string;
  role: 'parent' | 'student' | 'tutor';
  fullName: string;
  email: string;
  familyId?: string;
  studentId?: string;
  tutorId?: string;
};

/** The view in progress, kept in the session store. Never persisted. */
export type ViewingState = { viewId: string; profile: Profile; admin: Profile; expiresAt: string };

/** What DataSource.startViewAs returns: the viewed profile and a read-only source scoped to them. */
export type ViewAsSession = {
  viewId: string;
  profile: Profile;
  expiresAt: string;
  /** Read-only: writes reject with ViewOnlyError. */
  source: DataSource;
  /** End the view on the server and forget its tokens. Never throws. */
  end(): Promise<void>;
};

/**
 * The logins linked to a family (its parents), a student or a tutor, sorted by name. With more than one
 * reference, the logins for any of them are returned.
 */
export function viewTargetsFor(targets: ViewTarget[], ref: { familyId?: string; studentId?: string; tutorId?: string }): ViewTarget[] {
  return targets
    .filter(
      (t) =>
        (!!ref.familyId && t.role === 'parent' && t.familyId === ref.familyId) ||
        (!!ref.studentId && t.role === 'student' && t.studentId === ref.studentId) ||
        (!!ref.tutorId && t.role === 'tutor' && t.tutorId === ref.tutorId),
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Whole minutes until the view expires (rounded up), never below 0. */
export function minutesLeft(expiresAt: string, now: number): number {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60_000);
}

/**
 * How each DataSource member behaves while viewing:
 * - 'read' passes through to the viewed person's source;
 * - 'silent' is an automatic background write (e.g. marking a thread read); it resolves without doing anything;
 * - 'write' rejects with ViewOnlyError.
 * Typed as a Record over every key, so a new DataSource member will not compile until it is classified here.
 */
export const SOURCE_ACCESS: Record<keyof DataSource, 'read' | 'write' | 'silent'> = {
  kind: 'read',

  // Auth
  restoreSession: 'read',
  signIn: 'write',
  signOut: 'write',
  demoAccounts: 'read',
  resetDemo: 'write',
  signUp: 'write',
  verifySignUpCode: 'write',
  resendSignUpCode: 'write',
  signInWithProvider: 'write',
  setMyName: 'write',
  setWhatsApp: 'write',
  resetPassword: 'write',
  loginEmails: 'read',
  savePushToken: 'silent',
  listViewTargets: 'read',
  startViewAs: 'write',

  // Reads
  getSettings: 'read',
  listTutors: 'read',
  listFamilies: 'read',
  listStudents: 'read',
  listServices: 'read',
  listLessons: 'read',
  getLesson: 'read',
  listNotes: 'read',
  listHomework: 'read',
  listRatings: 'read',
  listPackages: 'read',
  listCharges: 'read',
  listInvoices: 'read',
  getInvoice: 'read',

  // Admin set-up
  saveSettings: 'write',
  saveTutor: 'write',
  saveFamily: 'write',
  saveStudent: 'write',
  saveService: 'write',

  // Subjects
  listEnrolments: 'read',
  saveEnrolment: 'write',
  listTopicLists: 'read',
  listTopics: 'read',
  addTopic: 'write',

  // Scheduling
  createLessons: 'write',
  rescheduleLesson: 'write',
  cancelLesson: 'write',
  completeLesson: 'write',
  setHomeworkDone: 'write',

  // Homework and resources
  getHomework: 'read',
  saveHomework: 'write',
  listSubmissions: 'read',
  submitHomework: 'write',
  giveFeedback: 'write',
  listResources: 'read',
  saveResource: 'write',
  deleteResource: 'write',
  shareResource: 'write',
  unshareResource: 'write',

  // Billing
  sellPackage: 'write',
  invoiceUnbilled: 'write',
  setInvoiceStatus: 'write',
  recordPayment: 'write',
  startCardPayment: 'write',

  // Families
  addMyChild: 'write',
  setFamilyStatus: 'write',
  submitEnquiry: 'write',
  listEnquiries: 'read',
  updateEnquiry: 'write',

  // Availability, closures, absences, booking
  listAvailability: 'read',
  setAvailability: 'write',
  listClosures: 'read',
  saveClosure: 'write',
  deleteClosure: 'write',
  listAbsences: 'read',
  saveAbsence: 'write',
  deleteAbsence: 'write',
  openSlots: 'read',
  listRequests: 'read',
  requestLesson: 'write',
  decideRequest: 'write',
  withdrawRequest: 'write',
  reassignLesson: 'write',

  // Messaging
  listThreads: 'read',
  listMessages: 'read',
  sendMessage: 'write',
  markThreadRead: 'silent',
  listAnnouncements: 'read',
  postAnnouncement: 'write',

  // Opportunities
  listOpportunities: 'read',
  listBids: 'read',
  saveOpportunity: 'write',
  placeBid: 'write',
  withdrawBid: 'write',
  awardOpportunity: 'write',

  // Hiring
  submitTutorApplication: 'write',
  listApplications: 'read',
  updateApplication: 'write',

  // Tutor pay
  getPaymentDetails: 'read',
  savePaymentDetails: 'write',
  listTutorInvoices: 'read',
  createTutorInvoice: 'write',
  updateTutorInvoice: 'write',
  submitTutorInvoice: 'write',
  reviewTutorInvoice: 'write',
  markTutorInvoicePaid: 'write',

  // Student reports
  listReportCycles: 'read',
  openReportCycle: 'write',
  listStudentReports: 'read',
  saveReport: 'write',
  submitReport: 'write',
  setReportStatus: 'write',

  // Money
  listExpenses: 'read',
  saveExpense: 'write',
  deleteExpense: 'write',

  // Files
  uploadFile: 'write',
  fileUrl: 'read',
  removeFile: 'write',

  // AI (calls a paid service and records usage)
  aiAssist: 'write',

  // Google Calendar
  listBusyBlocks: 'read',
  getCalendarConnection: 'read',
  connectGoogleCalendar: 'write',
  disconnectGoogleCalendar: 'write',

  // Card payments
  listPackageOffers: 'read',
  savePackageOffer: 'write',
  deletePackageOffer: 'write',
  setAutopay: 'write',
  buyPackageOffer: 'write',
  openBillingPortal: 'write',
  chargeSavedCard: 'write',

  // Per-student rates
  setEnrolmentRates: 'write',

  // Family contacts
  listFamilyContacts: 'read',
  saveFamilyContact: 'write',
  removeFamilyContact: 'write',

  // Audit log (administrators only; a viewed person cannot read it)
  listAuditEvents: 'read',
  listAuditActors: 'read',

  // Tax: credit notes, refunds and accountant access
  listCreditNotes: 'read',
  getCreditNote: 'read',
  issueCreditNote: 'write',
  listRefunds: 'read',
  refundPayment: 'write',
  listAccountants: 'read',
  inviteAccountant: 'write',
  removeAccountant: 'write',

  // Admissions advisory
  listAdmissionsCases: 'read',
  getAdmissionsCase: 'read',
  saveAdmissionsCase: 'write',
  listAdmissionsTargets: 'read',
  saveAdmissionsTarget: 'write',
  deleteAdmissionsTarget: 'write',
  listAdmissionsKeyDates: 'read',
  saveAdmissionsKeyDate: 'write',
  deleteAdmissionsKeyDate: 'write',
  listAdmissionsTasks: 'read',
  saveAdmissionsTask: 'write',
  setAdmissionsTaskDone: 'write',
  deleteAdmissionsTask: 'write',
  listAdmissionsDocuments: 'read',
  addAdmissionsDocument: 'write',
  deleteAdmissionsDocument: 'write',
  listAdvisoryUpdates: 'read',
  saveAdvisoryUpdate: 'write',
  setAdvisoryUpdateStatus: 'write',
  deleteAdvisoryUpdate: 'write',
  listAdmissionsEvents: 'read',
  addAdmissionsMilestone: 'write',
  billAdmissionsFee: 'write',

  // Tutor vetting and onboarding
  listTutorDocuments: 'read',
  submitTutorDocument: 'write',
  reviewTutorDocument: 'write',
  deleteTutorDocument: 'write',
  listTutorCompliance: 'read',
  listVettingOverrides: 'read',
  grantVettingOverride: 'write',
  revokeVettingOverride: 'write',
  getVettingEnforced: 'read',
  setVettingEnforced: 'write',
  listHandbookVersions: 'read',
  publishHandbook: 'write',
  listHandbookAcknowledgements: 'read',
  acknowledgeHandbook: 'write',

  // Launch readiness (downloading a viewed person's data on their behalf is refused)
  // Errors seen while viewing are not the viewed person's, and the server would refuse the write anyway.
  logAppError: 'silent',
  getSystemHealth: 'read',
  listAppErrors: 'read',
  listFunctionErrors: 'read',
  exportMyData: 'write',
  deleteMyAccount: 'write',
  listDeletionRequests: 'read',
  recordDeletionRequest: 'write',
  cancelDeletionRequest: 'write',
  processDeletionRequest: 'write',

  // Spam review
  setSpamStatus: 'write',

  // Session plans and handover packs
  getLessonPlan: 'read',
  listLessonPlans: 'read',
  saveLessonPlan: 'write',
  deleteLessonPlan: 'write',
  listHandovers: 'read',
  getHandoverSources: 'read',
  saveHandoverNote: 'write',
  // Opening a pack while viewing must not mark it as read for the tutor.
  markHandoverViewed: 'silent',
};

const refuse = async (): Promise<never> => {
  throw new ViewOnlyError();
};
const nothing = async (): Promise<void> => undefined;

/**
 * Wrap a source so only reads reach it. Writes, and any member not classified in SOURCE_ACCESS, reject with
 * ViewOnlyError (fail closed); automatic background writes quietly do nothing. Optional members the inner
 * source lacks stay undefined, so `if (!source.signUp)` checks behave as before.
 */
export function readOnlySource(inner: DataSource): DataSource {
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(inner, {
    get(target, key) {
      // Never look like a promise, and leave symbol lookups (inspection, iteration) alone.
      if (typeof key === 'symbol' || key === 'then') return undefined;
      const value: unknown = Reflect.get(target, key, target);
      if (value === undefined) return undefined;
      const access = Object.prototype.hasOwnProperty.call(SOURCE_ACCESS, key) ? SOURCE_ACCESS[key as keyof DataSource] : 'write';
      if (access === 'silent') return nothing;
      if (access === 'write') return refuse;
      if (typeof value !== 'function') return value;
      let fn = bound.get(key);
      if (!fn) {
        fn = (value as (...args: unknown[]) => unknown).bind(target);
        bound.set(key, fn);
      }
      return fn;
    },
    set() {
      return false;
    },
  });
}

/** A calm notice the app shows when a change was refused (view-only) or the view has ended. */
interface ViewNoticeState {
  /** `returned` is shown once the admin is back in their own account after a view ended. */
  notice: 'view-only' | 'ended' | 'returned' | null;
  /** When the notice was raised (ms since epoch), so repeated notices restart the flash. */
  at: number;
  flag(kind: 'view-only' | 'ended' | 'returned'): void;
  clear(): void;
}

export const useViewNotice = create<ViewNoticeState>((set) => ({
  notice: null,
  at: 0,
  flag(kind) {
    set({ notice: kind, at: Date.now() });
  },
  clear() {
    set({ notice: null, at: 0 });
  },
}));

/**
 * Raise the calm notice for an error that is an expected "View as" refusal. Returns true when it was one, so the
 * caller can treat it as handled.
 */
export function flagViewError(err: unknown): boolean {
  if (isViewOnlyError(err)) useViewNotice.getState().flag('view-only');
  else if (isViewEndedError(err)) useViewNotice.getState().flag('ended');
  else return false;
  return true;
}

type RejectionTarget = {
  addEventListener?: (type: 'unhandledrejection', listener: (e: { reason?: unknown; preventDefault(): void }) => void) => void;
  removeEventListener?: (type: 'unhandledrejection', listener: (e: { reason?: unknown; preventDefault(): void }) => void) => void;
};

/**
 * On the web, a screen that awaits a refused change without catching it (for example a mutateAsync in a button
 * handler) would otherwise surface the refusal as an uncaught error. While viewing, a refusal is expected and is
 * already shown as the calm notice, so it is marked as handled here. Any other rejection is left alone.
 * Returns a function that removes the listener. Does nothing where there is no window (native, tests).
 */
export function handleViewRejections(target: RejectionTarget | undefined = globalThis as RejectionTarget): () => void {
  if (!target || typeof target.addEventListener !== 'function') return () => undefined;
  const listener = (e: { reason?: unknown; preventDefault(): void }) => {
    if (flagViewError(e.reason)) e.preventDefault();
  };
  target.addEventListener('unhandledrejection', listener);
  return () => target.removeEventListener?.('unhandledrejection', listener);
}
