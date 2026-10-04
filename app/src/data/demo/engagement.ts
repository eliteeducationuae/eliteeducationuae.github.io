import { findClashes, openSlots } from '@/domain/scheduling';
import type { Audience, Availability, Closure, Enquiry, FamilyStatus, Profile, Thread, TutorAbsence } from '@/domain/types';

import type { NewChild, NewEnquiry, NewLessonRequest } from '../source';
import { AccessError, newId, requireAdmin, type DemoDB } from './db';

/** Demo versions of the engagement features. Each mirrors a database function or policy. */

function canAccessThread(db: DemoDB, viewer: Profile, familyId: string): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'parent') return viewer.familyId === familyId;
  if (viewer.role === 'tutor') {
    const kids = new Set(db.students.filter((s) => s.familyId === familyId).map((s) => s.id));
    return db.lessons.some((l) => l.tutorId === viewer.tutorId && l.studentIds.some((id) => kids.has(id)));
  }
  return false;
}

export const eq = {
  addMyChild(db: DemoDB, viewer: Profile, child: NewChild) {
    if (viewer.role !== 'parent' || !viewer.familyId) throw new AccessError('Only parents can add children');
    if (!child.fullName.trim()) throw new Error('Enter your child’s name');
    db.students.push({ id: newId('stu'), familyId: viewer.familyId, ...child, fullName: child.fullName.trim() });
  },
  setFamilyStatus(db: DemoDB, viewer: Profile, familyId: string, status: FamilyStatus) {
    requireAdmin(viewer);
    const f = db.families.find((x) => x.id === familyId);
    if (f) f.status = status;
  },
  submitEnquiry(db: DemoDB, viewer: Profile | null, e: NewEnquiry, now = new Date()) {
    if (!e.parentName.trim()) throw new Error('Please enter your name');
    if (!e.email?.trim() && !e.phone?.trim()) throw new Error('Please give an email address or phone number');
    db.enquiries.push({
      id: newId('enq'),
      createdAt: now.toISOString(),
      status: 'new',
      source: e.source ?? 'app',
      ...e,
      parentName: e.parentName.trim(),
      familyId: viewer?.role === 'parent' ? viewer.familyId : undefined,
    });
  },
  enquiries(db: DemoDB, viewer: Profile): Enquiry[] {
    if (viewer.role === 'admin') return db.enquiries;
    if (viewer.role === 'parent') return db.enquiries.filter((e) => e.familyId && e.familyId === viewer.familyId);
    return [];
  },
  updateEnquiry(db: DemoDB, viewer: Profile, id: string, patch: Partial<Enquiry>) {
    requireAdmin(viewer);
    const e = db.enquiries.find((x) => x.id === id);
    if (!e) throw new Error('Enquiry not found');
    Object.assign(e, patch);
  },

  setAvailability(db: DemoDB, viewer: Profile, tutorId: string, blocks: Omit<Availability, 'id' | 'tutorId'>[]) {
    if (!(viewer.role === 'admin' || viewer.tutorId === tutorId)) throw new AccessError('Not allowed');
    db.availability = db.availability.filter((a) => a.tutorId !== tutorId);
    for (const b of blocks) {
      if (b.end <= b.start) throw new Error('Each block must end after it starts');
      db.availability.push({ ...b, id: newId('av'), tutorId });
    }
  },
  saveClosure(db: DemoDB, viewer: Profile, c: Omit<Closure, 'id'> & { id?: string }) {
    requireAdmin(viewer);
    if (c.endDate < c.startDate) throw new Error('The end date must be on or after the start date');
    const existing = c.id ? db.closures.find((x) => x.id === c.id) : undefined;
    if (existing) Object.assign(existing, c);
    else db.closures.push({ ...c, id: newId('clo') });
  },
  deleteClosure(db: DemoDB, viewer: Profile, id: string) {
    requireAdmin(viewer);
    db.closures = db.closures.filter((c) => c.id !== id);
  },
  absences(db: DemoDB, viewer: Profile): TutorAbsence[] {
    return db.absences.filter((a) => viewer.role === 'admin' || a.tutorId === viewer.tutorId);
  },
  saveAbsence(db: DemoDB, viewer: Profile, a: Omit<TutorAbsence, 'id'> & { id?: string }) {
    if (!(viewer.role === 'admin' || viewer.tutorId === a.tutorId)) throw new AccessError('Not allowed');
    if (a.endDate < a.startDate) throw new Error('The end date must be on or after the start date');
    const existing = a.id ? db.absences.find((x) => x.id === a.id) : undefined;
    if (existing) Object.assign(existing, a);
    else db.absences.push({ ...a, id: newId('abs') });
  },
  deleteAbsence(db: DemoDB, viewer: Profile, id: string) {
    db.absences = db.absences.filter((a) => !(a.id === id && (viewer.role === 'admin' || a.tutorId === viewer.tutorId)));
  },
  openSlots(db: DemoDB, input: { tutorId: string; from: string; days: number; durationMin: number; ignoreLessonId?: string }, now = new Date()) {
    return openSlots({
      ...input,
      from: new Date(input.from),
      availability: db.availability,
      lessons: db.lessons,
      closures: db.closures,
      absences: db.absences,
      noticeHours: db.settings.bookingNoticeHours,
      now,
    }).map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() }));
  },

  requests(db: DemoDB, viewer: Profile) {
    return db.requests.filter(
      (r) => viewer.role === 'admin' || (viewer.role === 'parent' && r.familyId === viewer.familyId) || (viewer.role === 'tutor' && r.tutorId === viewer.tutorId),
    );
  },
  requestLesson(db: DemoDB, viewer: Profile, input: NewLessonRequest, now = new Date()) {
    const student = db.students.find((s) => s.id === input.studentId);
    if (!student || !(viewer.role === 'admin' || student.familyId === viewer.familyId)) throw new AccessError('Student not found');
    let tutorId = input.tutorId;
    let serviceId = input.serviceId;
    let duration: number;
    if (input.kind === 'reschedule') {
      const l = db.lessons.find((x) => x.id === input.lessonId && x.studentIds.includes(student.id) && x.status === 'scheduled');
      if (!l) throw new Error('That lesson can no longer be moved');
      tutorId = l.tutorId;
      serviceId = l.serviceId;
      duration = (new Date(l.end).getTime() - new Date(l.start).getTime()) / 60_000;
    } else {
      const svc = db.services.find((s) => s.id === serviceId);
      if (!svc) throw new Error('Choose a lesson type');
      duration = svc.durationMin;
    }
    const day = new Date(input.start);
    day.setHours(0, 0, 0, 0);
    const free = eq.openSlots(db, { tutorId, from: day.toISOString(), days: 1, durationMin: duration, ignoreLessonId: input.lessonId }, now);
    if (!free.some((s) => s.start === new Date(input.start).toISOString())) throw new Error('Sorry, that time is no longer available');
    db.requests.push({
      id: newId('req'),
      createdAt: now.toISOString(),
      familyId: student.familyId,
      studentId: student.id,
      kind: input.kind,
      lessonId: input.lessonId,
      tutorId,
      serviceId,
      start: new Date(input.start).toISOString(),
      end: new Date(new Date(input.start).getTime() + duration * 60_000).toISOString(),
      note: input.note?.trim() || undefined,
      status: 'pending',
    });
  },
  decideRequest(db: DemoDB, viewer: Profile, id: string, approve: boolean, response?: string, now = new Date()) {
    requireAdmin(viewer);
    const r = db.requests.find((x) => x.id === id);
    if (!r || r.status !== 'pending') throw new Error('This request has already been dealt with');
    if (approve) {
      const slot = { start: new Date(r.start), end: new Date(r.end) };
      if (findClashes({ ...slot, tutorId: r.tutorId, studentIds: [r.studentId], ignoreLessonId: r.lessonId }, db.lessons).length) {
        throw new Error('That time now clashes with another lesson — decline and suggest another time');
      }
      if (r.kind === 'reschedule') {
        const l = db.lessons.find((x) => x.id === r.lessonId && x.status === 'scheduled');
        if (!l) throw new Error('The original lesson can no longer be moved');
        l.start = r.start;
        l.end = r.end;
      } else {
        const previous = [...db.lessons].reverse().find((l) => l.studentIds.includes(r.studentId));
        db.lessons.push({
          id: newId('les'),
          tutorId: r.tutorId,
          studentIds: [r.studentId],
          serviceId: r.serviceId,
          start: r.start,
          end: r.end,
          location: previous?.location ?? 'online',
          meetingUrl: previous?.meetingUrl,
          address: previous?.address,
          status: 'scheduled',
        });
      }
    }
    r.status = approve ? 'approved' : 'declined';
    r.response = response?.trim() || undefined;
    r.decidedAt = now.toISOString();
  },
  withdrawRequest(db: DemoDB, viewer: Profile, id: string) {
    const r = db.requests.find((x) => x.id === id && x.status === 'pending' && (viewer.role === 'admin' || x.familyId === viewer.familyId));
    if (!r) throw new Error('Request not found');
    r.status = 'withdrawn';
  },
  reassignLesson(db: DemoDB, viewer: Profile, lessonId: string, tutorId: string) {
    requireAdmin(viewer);
    const l = db.lessons.find((x) => x.id === lessonId && x.status === 'scheduled');
    if (!l) throw new Error('Only scheduled lessons can be reassigned');
    if (findClashes({ start: new Date(l.start), end: new Date(l.end), tutorId, studentIds: [], ignoreLessonId: l.id }, db.lessons).length) {
      throw new Error(`${db.tutors.find((t) => t.id === tutorId)?.fullName ?? 'That tutor'} already has a lesson then`);
    }
    l.tutorId = tutorId;
  },

  threads(db: DemoDB, viewer: Profile): Thread[] {
    const reads = db.reads[viewer.id] ?? {};
    return db.families
      .filter((f) => f.status !== 'archived' && canAccessThread(db, viewer, f.id))
      .map((f) => {
        const msgs = db.messages.filter((m) => m.familyId === f.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const last = msgs[msgs.length - 1];
        return {
          familyId: f.id,
          familyName: f.name,
          parentName: f.parentName,
          lastBody: last?.body,
          lastSender: last?.senderName,
          lastAt: last?.createdAt,
          unread: msgs.filter((m) => m.senderId !== viewer.id && m.createdAt > (reads[f.id] ?? '')).length,
        };
      })
      .filter((t) => t.lastAt || viewer.role === 'admin' || viewer.familyId === t.familyId)
      .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.familyName.localeCompare(b.familyName));
  },
  messages(db: DemoDB, viewer: Profile, familyId: string) {
    if (!canAccessThread(db, viewer, familyId)) throw new AccessError('Conversation not found');
    return db.messages.filter((m) => m.familyId === familyId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  sendMessage(db: DemoDB, viewer: Profile, familyId: string, body: string, now = new Date()) {
    if (!canAccessThread(db, viewer, familyId)) throw new AccessError('Conversation not found');
    if (!body.trim()) return;
    db.messages.push({ id: newId('msg'), familyId, senderId: viewer.id, senderName: viewer.fullName, senderRole: viewer.role, body: body.trim(), createdAt: now.toISOString() });
    eq.markRead(db, viewer, familyId, now);
  },
  markRead(db: DemoDB, viewer: Profile, familyId: string, now = new Date()) {
    if (!canAccessThread(db, viewer, familyId)) return;
    db.reads[viewer.id] = { ...(db.reads[viewer.id] ?? {}), [familyId]: now.toISOString() };
  },
  announcements(db: DemoDB, viewer: Profile) {
    return db.announcements
      .filter(
        (a) =>
          viewer.role === 'admin' ||
          a.audience === 'everyone' ||
          (a.audience === 'parents' && viewer.role === 'parent') ||
          (a.audience === 'tutors' && viewer.role === 'tutor'),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  postAnnouncement(db: DemoDB, viewer: Profile, a: { title: string; body: string; audience: Audience }, now = new Date()) {
    requireAdmin(viewer);
    if (!a.title.trim() || !a.body.trim()) throw new Error('Add a title and a message');
    db.announcements.push({ id: newId('ann'), createdAt: now.toISOString(), authorName: viewer.fullName, ...a });
  },
};
