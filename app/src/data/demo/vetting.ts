import type {
  HandbookAcknowledgement,
  HandbookVersion,
  Profile,
  TutorCompliance,
  TutorDocument,
  VettingOverride,
} from '@/domain/types';
import { toDateKey } from '@/domain/dates';
import { activeOverride, formatLongDate, isCleared, vettingBlockMessage, vettingStatus } from '@/domain/vetting';

import type { NewTutorDocument } from '../source';
import { AccessError, newId, notifyAdmins, notifyTutor, requireAdmin, type DemoDB } from './db';

/**
 * Demo versions of tutor vetting and onboarding. Each mirrors a database function or policy in the
 * vetting migration: admins see and manage everything; tutors see their own documents, overrides,
 * acknowledgements and compliance row; parents and students see nothing.
 */

/** Default and maximum length of an override, in days. */
const DEFAULT_OVERRIDE_DAYS = 30;
const MAX_OVERRIDE_DAYS = 90;

const tutorName = (db: DemoDB, tutorId: string) => db.tutors.find((t) => t.id === tutorId)?.fullName ?? 'This tutor';
/** Names for documents in sentences, as in the database's vetting_doc_label. */
const SENTENCE_LABELS: Record<TutorDocument['type'], string> = {
  police_clearance: 'police clearance certificate',
  passport_id: 'passport or identity document',
  qualification: 'qualification certificate',
  other: 'document',
};
const FOOTER = '\n\nElite Education | eliteeducation.me';
const firstName = (db: DemoDB, tutorId: string) => tutorName(db, tutorId).split(' ')[0];
const newestFirst = <T extends { createdAt: string }>(rows: T[]) => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Rows the viewer may see: admins all, tutors their own, everyone else none. */
function visibleTo<T extends { tutorId: string }>(rows: T[], viewer: Profile, tutorId?: string): T[] {
  const mine = viewer.role === 'admin' ? rows : viewer.role === 'tutor' && viewer.tutorId ? rows.filter((r) => r.tutorId === viewer.tutorId) : [];
  return tutorId ? mine.filter((r) => r.tutorId === tutorId) : mine;
}

function compliance(db: DemoDB, tutorId: string, now: Date): TutorCompliance {
  const docs = (db.tutorDocuments ?? []).filter((d) => d.tutorId === tutorId);
  const profileIds = new Set(db.profiles.filter((p) => p.tutorId === tutorId).map((p) => p.id));
  const current = Math.max(0, ...(db.handbookVersions ?? []).map((h) => h.version));
  const acknowledged = Math.max(0, ...(db.handbookAcks ?? []).filter((a) => a.tutorId === tutorId).map((a) => a.version));
  const override = activeOverride(db.vettingOverrides ?? [], tutorId, now);
  return {
    tutorId,
    vettingStatus: vettingStatus(docs, now),
    // As in the database: the latest expiry of any verified police clearance, even an expired one.
    clearanceExpiry: docs
      .filter((d) => d.type === 'police_clearance' && d.status === 'verified' && d.expiryDate)
      .map((d) => d.expiryDate!)
      .sort()
      .at(-1),
    documentsPending: docs.filter((d) => d.status === 'pending').length,
    bankDetails: db.paymentDetails.some((p) => p.tutorId === tutorId),
    availabilitySet: db.availability.some((a) => a.tutorId === tutorId),
    calendarConnected: (db.calendarConnections ?? []).some((c) => profileIds.has(c.profileId) && c.status === 'connected'),
    whatsappOptIn: db.profiles.some((p) => p.tutorId === tutorId && !!p.whatsappOptIn),
    handbookVersion: current || undefined,
    handbookAcknowledgedVersion: acknowledged || undefined,
    onboardingStartedAt: db.tutorOnboarding?.[tutorId],
    override: override ? { id: override.id, reason: override.reason, until: override.expiresAt } : undefined,
    enforced: !!db.vettingEnforced,
  };
}

/**
 * Mirrors the database's assignment guard: throws the vetting block message when enforcement is on and the
 * tutor is neither cleared nor covered by an active override.
 */
export function assertCleared(db: DemoDB, tutorId: string, action: 'lesson' | 'enrolment' | 'role', now = new Date()) {
  if (!db.vettingEnforced) return;
  const docs = (db.tutorDocuments ?? []).filter((d) => d.tutorId === tutorId);
  if (isCleared(vettingStatus(docs, now))) return;
  if (activeOverride(db.vettingOverrides ?? [], tutorId, now)) return;
  throw new Error(vettingBlockMessage(tutorName(db, tutorId), action));
}

export const vet = {
  documents(db: DemoDB, viewer: Profile, filter?: { tutorId?: string }): TutorDocument[] {
    return newestFirst(visibleTo(db.tutorDocuments ?? [], viewer, filter?.tutorId));
  },

  submitDocument(db: DemoDB, viewer: Profile, input: NewTutorDocument, now = new Date()): TutorDocument {
    if (viewer.role !== 'admin' && !(viewer.role === 'tutor' && viewer.tutorId === input.tutorId)) {
      throw new AccessError('You can only upload your own documents');
    }
    const tutor = db.tutors.find((t) => t.id === input.tutorId);
    if (!tutor) throw new Error('Tutor not found');
    if (!SENTENCE_LABELS[input.type]) throw new Error('Please choose the type of document');
    const folder = `tutors/${input.tutorId}/`;
    if (!input.filePath.startsWith(folder) || input.filePath.length <= folder.length || input.filePath.includes('..')) {
      throw new Error('The file was not uploaded to the right place. Please try again.');
    }
    const issueDate = input.issueDate?.trim() || undefined;
    const expiryDate = input.expiryDate?.trim() || undefined;
    // The expiry date is confirmed at review.
    if (issueDate && issueDate > toDateKey(now)) throw new Error('The issue date cannot be in the future');
    if (issueDate && expiryDate && expiryDate < issueDate) throw new Error('The expiry date cannot be before the issue date');
    if ((input.title?.length ?? 0) > 200) throw new Error('Please keep the title to 200 characters');
    const doc: TutorDocument = {
      id: newId('doc'),
      tutorId: input.tutorId,
      type: input.type,
      title: input.title?.trim() || undefined,
      filePath: input.filePath,
      fileName: input.fileName?.trim() || undefined,
      issueDate,
      expiryDate,
      status: 'pending',
      createdAt: now.toISOString(),
    };
    (db.tutorDocuments ??= []).push(doc);
    notifyAdmins(
      db,
      `Document to review: ${tutor.fullName}`,
      `A new ${SENTENCE_LABELS[input.type]} has been uploaded for ${tutor.fullName}. Please review it in Manage > Tutor checks and verify or reject it.${FOOTER}`,
      `/manage/vetting/${input.tutorId}`,
      now,
    );
    return doc;
  },

  reviewDocument(
    db: DemoDB,
    viewer: Profile,
    id: string,
    decision: { approve: boolean; issueDate?: string; expiryDate?: string; note?: string },
    now = new Date(),
  ) {
    requireAdmin(viewer);
    const doc = (db.tutorDocuments ?? []).find((d) => d.id === id);
    if (!doc) throw new Error('Document not found');
    // As in review_tutor_document, a document can be reviewed again, e.g. to correct its dates.
    const note = decision.note?.trim() || undefined;
    if (decision.approve) {
      const issueDate = decision.issueDate?.trim() || doc.issueDate;
      const expiryDate = decision.expiryDate?.trim() || doc.expiryDate;
      const today = toDateKey(now);
      const police = doc.type === 'police_clearance';
      if (police && !expiryDate) throw new Error('Please enter the expiry date before verifying');
      if (police && expiryDate! < today) throw new Error('This certificate has already expired. Please ask the tutor for a current one.');
      if (issueDate && issueDate > today) throw new Error('The issue date cannot be in the future');
      if (issueDate && expiryDate && expiryDate < issueDate) throw new Error('The expiry date cannot be before the issue date');
      Object.assign(doc, { status: 'verified', issueDate, expiryDate, reviewNote: note, verifiedAt: now.toISOString(), verifiedByName: viewer.fullName });
      // As in review_tutor_document: the tutor is told, never with the file path.
      notifyTutor(
        db,
        doc.tutorId,
        police ? 'Your police clearance has been verified' : `Your ${SENTENCE_LABELS[doc.type]} has been verified`,
        `Dear ${firstName(db, doc.tutorId)},\n\nThank you for uploading your ${SENTENCE_LABELS[doc.type]}. It has now been verified by Elite Education` +
          (expiryDate ? ` and is valid until ${formatLongDate(expiryDate)}` : '') +
          '.' +
          (police && expiryDate ? ' We will remind you well before it expires so that you can upload a renewed certificate in good time.' : '') +
          FOOTER,
        '/checks',
        now,
      );
    } else {
      if (!note) throw new Error('Please give a reason so that the tutor knows what to upload');
      if (note.length > 1000) throw new Error('Please keep the reason to 1000 characters');
      Object.assign(doc, { status: 'rejected', reviewNote: note, verifiedAt: undefined, verifiedByName: undefined });
      notifyTutor(
        db,
        doc.tutorId,
        `Please upload a new ${SENTENCE_LABELS[doc.type]}`,
        `Dear ${firstName(db, doc.tutorId)},\n\nThank you for uploading your ${SENTENCE_LABELS[doc.type]}. Unfortunately we are unable to accept it, for the following reason:\n\n${note}\n\nPlease upload a replacement in the Elite Education app under Checks.${FOOTER}`,
        '/checks',
        now,
      );
    }
  },

  /** Returns the stored file's path so it can be removed. Tutors may remove their own documents until verified. */
  deleteDocument(db: DemoDB, viewer: Profile, id: string): string {
    const doc = (db.tutorDocuments ?? []).find((d) => d.id === id);
    if (!doc || (viewer.role !== 'admin' && !(viewer.role === 'tutor' && viewer.tutorId === doc.tutorId))) {
      throw new Error('Document not found');
    }
    if (viewer.role !== 'admin' && doc.status === 'verified') {
      throw new AccessError('Verified documents can only be removed by Elite Education');
    }
    db.tutorDocuments = (db.tutorDocuments ?? []).filter((d) => d.id !== id);
    return doc.filePath;
  },

  compliance(db: DemoDB, viewer: Profile, now = new Date()): TutorCompliance[] {
    if (viewer.role === 'admin') {
      return [...db.tutors].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((t) => compliance(db, t.id, now));
    }
    if (viewer.role === 'tutor' && viewer.tutorId && db.tutors.some((t) => t.id === viewer.tutorId)) {
      return [compliance(db, viewer.tutorId, now)];
    }
    return [];
  },

  overrides(db: DemoDB, viewer: Profile, filter?: { tutorId?: string }): VettingOverride[] {
    return newestFirst(visibleTo(db.vettingOverrides ?? [], viewer, filter?.tutorId));
  },

  grantOverride(db: DemoDB, viewer: Profile, tutorId: string, reason: string, days = DEFAULT_OVERRIDE_DAYS, now = new Date()) {
    requireAdmin(viewer);
    const tutor = db.tutors.find((t) => t.id === tutorId);
    if (!tutor) throw new Error('Tutor not found');
    const why = reason.trim();
    if (why.length < 10) throw new Error('Please give a reason of at least 10 characters for the override');
    if (why.length > 1000) throw new Error('Please keep the reason to 1000 characters');
    if (!Number.isInteger(days) || days < 1 || days > MAX_OVERRIDE_DAYS) {
      throw new Error(`An override can last between 1 and ${MAX_OVERRIDE_DAYS} days`);
    }
    const override: VettingOverride = {
      id: newId('ovr'),
      tutorId,
      reason: why,
      createdAt: now.toISOString(),
      createdByName: viewer.fullName,
      expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    };
    (db.vettingOverrides ??= []).push(override);
    notifyAdmins(
      db,
      `Clearance override recorded for ${tutor.fullName}`,
      `${viewer.fullName} recorded a police clearance override for ${tutor.fullName}, valid until ${formatLongDate(override.expiresAt)}.\n\nReason: ${why}${FOOTER}`,
      `/manage/vetting/${tutorId}`,
      now,
    );
    return override.id;
  },

  revokeOverride(db: DemoDB, viewer: Profile, id: string, now = new Date()) {
    requireAdmin(viewer);
    const o = (db.vettingOverrides ?? []).find((x) => x.id === id);
    if (!o || o.revokedAt) throw new Error('That override has already ended');
    o.revokedAt = now.toISOString();
    o.revokedByName = viewer.fullName;
  },

  enforced: (db: DemoDB) => !!db.vettingEnforced,

  setEnforced(db: DemoDB, viewer: Profile, on: boolean) {
    requireAdmin(viewer);
    db.vettingEnforced = on;
  },

  handbookVersions(db: DemoDB, viewer: Profile): HandbookVersion[] {
    if (viewer.role !== 'admin' && viewer.role !== 'tutor') return [];
    return [...(db.handbookVersions ?? [])].sort((a, b) => b.version - a.version);
  },

  publishHandbook(db: DemoDB, viewer: Profile, title: string, body: string, now = new Date()): HandbookVersion {
    requireAdmin(viewer);
    if (!title.trim() || title.trim().length > 200) throw new Error('Please give the handbook a title of up to 200 characters');
    if (!body.trim() || body.trim().length > 50_000) throw new Error('Please write the handbook (up to 50,000 characters)');
    const version: HandbookVersion = {
      id: newId('hb'),
      version: Math.max(0, ...(db.handbookVersions ?? []).map((h) => h.version)) + 1,
      title: title.trim(),
      body: body.trim(),
      publishedAt: now.toISOString(),
      publishedByName: viewer.fullName,
    };
    (db.handbookVersions ??= []).push(version);
    // As in publish_handbook: every tutor with a login, by first name, except the publishing administrator.
    const tutorIds = new Set(
      db.profiles.filter((p) => p.tutorId && (p.role === 'tutor' || p.role === 'admin') && p.tutorId !== viewer.tutorId).map((p) => p.tutorId!),
    );
    for (const tutorId of tutorIds) {
      notifyTutor(
        db,
        tutorId,
        'Updated tutor handbook',
        `Dear ${firstName(db, tutorId)},\n\nWe have published version ${version.version} of the Elite Education tutor handbook. Please read it in the app and confirm that you have read and agree to follow it.${FOOTER}`,
        '/handbook',
        now,
      );
    }
    return version;
  },

  handbookAcks(db: DemoDB, viewer: Profile, filter?: { tutorId?: string }): HandbookAcknowledgement[] {
    return visibleTo(db.handbookAcks ?? [], viewer, filter?.tutorId).sort((a, b) => b.acknowledgedAt.localeCompare(a.acknowledgedAt));
  },

  acknowledgeHandbook(db: DemoDB, viewer: Profile, version: number, now = new Date()) {
    const tutorId = viewer.tutorId;
    if (!tutorId || (viewer.role !== 'tutor' && viewer.role !== 'admin')) throw new AccessError('Only tutors acknowledge the handbook');
    const current = Math.max(0, ...(db.handbookVersions ?? []).map((h) => h.version));
    if (!current || version !== current) throw new Error('Please acknowledge the current version of the handbook.');
    const acks = (db.handbookAcks ??= []);
    if (acks.some((a) => a.tutorId === tutorId && a.version === version)) return;
    acks.push({ tutorId, version, acknowledgedAt: now.toISOString() });
  },

  /** Records when a hired applicant's onboarding began (first time only). */
  startOnboarding(db: DemoDB, tutorId: string, now = new Date()) {
    (db.tutorOnboarding ??= {})[tutorId] ??= now.toISOString();
  },
};
