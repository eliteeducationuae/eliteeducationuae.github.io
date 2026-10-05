/** Tutor vetting and onboarding: pure mappers between database rows and app types. */
import type { HandbookAcknowledgement, HandbookVersion, TutorCompliance, TutorDocument, VettingOverride, VettingStatus } from '@/domain/types';

import type { NewTutorDocument } from './source';

type Row = Record<string, any>;

const iso = (v: unknown): string | undefined => (v == null || v === '' ? undefined : new Date(String(v)).toISOString());
/** Dates come back as `YYYY-MM-DD`; keep only that part if a time is attached. */
const dateKey = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v).slice(0, 10));
const text = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v));
const blank = (v: string | undefined): string | null => v?.trim() || null;

export const toTutorDocument = (r: Row): TutorDocument => ({
  id: r.id,
  tutorId: r.tutor_id,
  type: r.doc_type,
  title: text(r.title),
  filePath: r.file_path,
  fileName: text(r.file_name),
  issueDate: dateKey(r.issue_date),
  expiryDate: dateKey(r.expiry_date),
  status: r.status,
  reviewNote: text(r.review_note),
  createdAt: iso(r.created_at)!,
  verifiedAt: iso(r.verified_at),
  verifiedByName: text(r.verified_by_name),
});

export const toVettingOverride = (r: Row): VettingOverride => ({
  id: r.id,
  tutorId: r.tutor_id,
  reason: r.reason,
  createdAt: iso(r.created_at)!,
  createdByName: text(r.created_by_name),
  expiresAt: iso(r.expires_at)!,
  revokedAt: iso(r.revoked_at),
  revokedByName: text(r.revoked_by_name),
});

const VETTING_STATUSES: VettingStatus[] = ['cleared', 'expiring', 'pending', 'expired', 'missing'];

export const toTutorCompliance = (r: Row): TutorCompliance => ({
  tutorId: r.tutor_id,
  vettingStatus: VETTING_STATUSES.includes(r.vetting_status) ? r.vetting_status : 'missing',
  clearanceExpiry: dateKey(r.clearance_expiry),
  documentsPending: Number(r.documents_pending ?? 0),
  bankDetails: !!r.bank_details,
  availabilitySet: !!r.availability_set,
  calendarConnected: !!r.calendar_connected,
  whatsappOptIn: !!r.whatsapp_opt_in,
  handbookVersion: r.handbook_version == null ? undefined : Number(r.handbook_version),
  handbookAcknowledgedVersion: r.handbook_acknowledged_version == null ? undefined : Number(r.handbook_acknowledged_version),
  onboardingStartedAt: iso(r.onboarding_started_at),
  override: r.override_id ? { id: r.override_id, reason: r.override_reason ?? '', until: iso(r.override_until)! } : undefined,
  enforced: !!r.enforced,
});

export const toHandbookVersion = (r: Row): HandbookVersion => ({
  id: r.id,
  version: Number(r.version),
  title: r.title,
  body: r.body,
  publishedAt: iso(r.published_at)!,
  publishedByName: text(r.published_by_name),
});

export const toHandbookAck = (r: Row): HandbookAcknowledgement => ({
  tutorId: r.tutor_id,
  version: Number(r.version),
  acknowledgedAt: iso(r.acknowledged_at)!,
});

/** The submit_tutor_document RPC's parameters, with blanks sent as null. */
export function submitDocumentParams(input: NewTutorDocument) {
  return {
    p_tutor_id: input.tutorId,
    p_doc_type: input.type,
    p_file_path: input.filePath,
    p_file_name: blank(input.fileName),
    p_title: blank(input.title),
    p_issue_date: blank(input.issueDate),
    p_expiry_date: blank(input.expiryDate),
  };
}

/** The review_tutor_document RPC's parameters, with blanks sent as null. */
export function reviewDocumentParams(id: string, decision: { approve: boolean; issueDate?: string; expiryDate?: string; note?: string }) {
  return {
    p_id: id,
    p_approve: decision.approve,
    p_issue_date: blank(decision.issueDate),
    p_expiry_date: blank(decision.expiryDate),
    p_note: blank(decision.note),
  };
}
