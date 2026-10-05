import { describeAuditEvent, REDACTED, type AuditEvent, type AuditNames } from '@/domain/audit';
import { addDays, formatDay, formatTime } from '@/domain/dates';

import { auditedWrite, ensureAuditSeed, listAuditActorsDemo, listAuditEventsDemo, recordAuditChanges, snapshotAudited } from '../demo/audit';
import { AccessError, cmd, type DemoDB } from '../demo/db';
import { cw } from '../demo/classwork';
import { ops } from '../demo/operations';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 2, 12, 0); // Fri 2 Oct 2026, midday
const who = (db: DemoDB, role: string) => db.profiles.find((p) => p.role === role)!;
const namesFor = (db: DemoDB): AuditNames => ({
  tutor: (id) => db.tutors.find((t) => t.id === id)?.fullName,
  student: (id) => db.students.find((s) => s.id === id)?.fullName,
  family: (id) => db.families.find((f) => f.id === id)?.name,
  service: (id) => db.services.find((s) => s.id === id)?.name,
});
const fresh = () => {
  const db = createSeed(NOW);
  db.audit = [];
  return db;
};
const upcomingFor = (db: DemoDB, studentId: string) =>
  db.lessons.filter((l) => l.status === 'scheduled' && l.start > NOW.toISOString() && l.studentIds.includes(studentId))[0];

describe('demo audit trail', () => {
  it('records a move as one lesson update by Craig', () => {
    const db = fresh();
    const admin = who(db, 'admin');
    const lesson = { ...upcomingFor(db, 's-omar') };
    const start = addDays(new Date(lesson.start), 1).toISOString();
    const end = addDays(new Date(lesson.end), 1).toISOString();
    auditedWrite(db, admin, () => cmd.rescheduleLesson(db, admin, lesson.id, start, end), NOW);

    expect(db.audit).toHaveLength(1);
    const e = db.audit![0];
    expect(e).toMatchObject({
      action: 'update',
      table: 'lessons',
      rowId: lesson.id,
      actorId: 'u-admin',
      actorName: "Craig O'Brien",
      actorRole: 'admin',
      studentIds: ['s-omar'],
      familyIds: ['f-mansoori'],
      tutorId: lesson.tutorId,
      at: NOW.toISOString(),
    });
    expect(e.before).toEqual({ start_at: lesson.start, end_at: lesson.end });
    expect(e.after).toEqual({ start_at: start, end_at: end });
    expect(describeAuditEvent(e, namesFor(db)).summary).toBe(
      `Craig moved the lesson from ${formatDay(lesson.start)} ${formatTime(lesson.start)} to ${formatDay(start)} ${formatTime(start)}.`,
    );
  });

  it('redacts bank details but still records the change', () => {
    const db = fresh();
    const admin = who(db, 'admin');
    auditedWrite(db, admin, () => cmd.saveSettings(db, admin, { bankDetails: 'Elite Education, IBAN AE12 3456 7890 1234 5678 901' }), NOW);
    expect(db.audit).toHaveLength(1);
    expect(db.audit![0]).toMatchObject({ table: 'settings', rowId: '1', before: { bank_details: REDACTED }, after: { bank_details: REDACTED } });
    expect(JSON.stringify(db.audit)).not.toMatch(/IBAN|AE12|AE00/);
    expect(describeAuditEvent(db.audit![0], namesFor(db)).changes).toEqual(['Bank details were changed (hidden for security).']);
  });

  it('records nothing for a write that fails, or changes nothing', () => {
    const db = fresh();
    const tutor = who(db, 'tutor');
    const lesson = upcomingFor(db, 's-omar');
    expect(() => auditedWrite(db, tutor, () => cmd.rescheduleLesson(db, tutor, lesson.id, lesson.start, lesson.end))).toThrow(AccessError);
    const admin = who(db, 'admin');
    auditedWrite(db, admin, () => cmd.saveSettings(db, admin, {}));
    // Only the next invoice number changes when an invoice is raised; that alone isn't recorded.
    auditedWrite(db, admin, () => (db.settings.nextInvoiceNumber += 1));
    expect(db.audit).toEqual([]);
  });

  it('records invoices and their payments as separate rows', () => {
    const db = fresh();
    const admin = who(db, 'admin');
    const invoice = db.invoices.find((i) => i.familyId === 'f-hughes' && i.status === 'sent')!;
    auditedWrite(db, admin, () => cmd.recordPayment(db, admin, invoice.id, 100, 'cash', 'Desk'), NOW);
    const payment = db.audit!.find((e) => e.table === 'payments')!;
    expect(payment).toMatchObject({ action: 'insert', familyIds: ['f-hughes'], relatedIds: [invoice.id] });
    expect(payment.after).toMatchObject({ invoice_id: invoice.id, amount: 100, method: 'cash' });
    expect(db.audit!.some((e) => e.table === 'invoices' && 'payments' in (e.after ?? {}))).toBe(false);
  });

  it('never records private notes', () => {
    const db = fresh();
    const admin = who(db, 'admin');
    auditedWrite(db, admin, () => {
      const omar = db.students.find((s) => s.id === 's-omar')!;
      omar.notes = 'PRIVATE-STUDENT-NOTE';
      omar.targetGrade = '6';
      const note = db.notes[0];
      note.privateNote = 'PRIVATE-LESSON-NOTE';
    });
    expect(db.audit).toHaveLength(1);
    expect(db.audit![0]).toMatchObject({ table: 'students', before: { target_grade: '7' }, after: { target_grade: '6' } });
    expect(JSON.stringify(db.audit)).not.toContain('PRIVATE');
    expect(Object.keys(snapshotAudited(db).get('students')!.get('s-omar')!)).not.toContain('notes');
  });

  it('links lesson notes and homework to their lesson', () => {
    const db = fresh();
    const tutor = who(db, 'tutor');
    const lesson = db.lessons.find((l) => l.tutorId === 't-sarah' && l.status === 'scheduled' && l.end < NOW.toISOString());
    const hw = db.homework.find((h) => h.lessonId && h.studentId === 's-layla')!;
    auditedWrite(db, tutor, () => cmd.setHomeworkDone(db, tutor, hw.id, !hw.done), NOW);
    const e = db.audit!.find((x) => x.table === 'homework')!;
    expect(e).toMatchObject({ studentIds: ['s-layla'], familyIds: ['f-mansoori'], relatedIds: [hw.lessonId] });
    expect(lesson).toBeDefined();
    if (lesson) {
      auditedWrite(db, tutor, () => cmd.completeLesson(db, tutor, cw.checkLessonHomework({ lessonId: lesson.id, status: 'completed', summary: 'We covered vectors.', topicIds: [], attendance: {}, ratings: [], homework: [] })), NOW);
      const note = db.audit!.find((x) => x.table === 'lesson_notes')!;
      expect(note).toMatchObject({ action: 'insert', rowId: lesson.id, relatedIds: [lesson.id], tutorId: 't-sarah' });
      expect(describeAuditEvent(note, namesFor(db)).summary).toBe('Sarah wrote the lesson notes.');
    }
  });

  it('records report status changes only', () => {
    const db = fresh();
    const admin = who(db, 'admin');
    const report = db.reports.find((r) => r.status === 'submitted')!;
    auditedWrite(db, admin, () => ops.setReportStatus(db, admin, report.id, 'approved'), NOW);
    expect(db.audit!.filter((e) => e.table === 'student_reports')).toHaveLength(1);
    expect(db.audit![0].after).toMatchObject({ status: 'approved' });
    expect(describeAuditEvent(db.audit![0], namesFor(db)).summary).toBe('Craig approved the report.');
  });

  it('is for admins only', () => {
    const db = createSeed(NOW);
    ensureAuditSeed(db, NOW);
    for (const role of ['tutor', 'parent', 'student']) {
      expect(() => listAuditEventsDemo(db, who(db, role), {})).toThrow(AccessError);
      expect(() => listAuditActorsDemo(db, who(db, role))).toThrow(AccessError);
    }
    expect(listAuditEventsDemo(db, who(db, 'admin'), {}).events.length).toBeGreaterThan(0);
  });
});

describe('demo audit seed and queries', () => {
  const db = createSeed(NOW);
  ensureAuditSeed(db, NOW);
  const admin = who(db, 'admin');
  const all = db.audit!;
  const names = namesFor(db);

  it('seeds a plausible month of history without leaking secrets', () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.length).toBeGreaterThan(30); // enough for the activity log to page
    for (const e of all) {
      const t = new Date(e.at).getTime();
      expect(t).toBeLessThan(NOW.getTime());
      expect(t).toBeGreaterThan(addDays(NOW, -31).getTime());
    }
    const text = all.map((e) => describeAuditEvent(e, names));
    const summaries = text.map((t) => t.summary);
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Craig scheduled a lesson for Omar on /),
        expect.stringMatching(/^Craig moved the lesson from /),
        'Sarah wrote the lesson notes.',
        'Craig sent the invoice.',
        expect.stringMatching(/^Craig recorded a bank transfer of AED /),
        expect.stringMatching(/^The system recorded a card payment of AED /),
        "Craig updated Layla Al Mansoori's details.",
        "Craig updated the Hughes family's details.",
        "Craig updated Sarah Khan's details.",
        'Craig changed the business settings.',
      ]),
    );
    expect(text.flatMap((t) => t.changes)).toEqual(
      expect.arrayContaining(['Target grade: 8 → 9', 'Bank details were changed (hidden for security).', 'Hourly pay: AED 180 → AED 200']),
    );
    expect(JSON.stringify(all)).not.toMatch(/IBAN|AE00/);
    expect(JSON.stringify(all)).not.toContain('rushes calculus');
  });

  it('only seeds once', () => {
    const before = JSON.stringify(db.audit);
    ensureAuditSeed(db, addDays(NOW, 5));
    expect(JSON.stringify(db.audit)).toBe(before);
  });

  it('filters like the RPC', () => {
    const omarLesson = all.find((e) => e.table === 'lessons' && e.action === 'update')!;
    const byEntity = listAuditEventsDemo(db, admin, { entityId: omarLesson.rowId! }).events;
    expect(byEntity.length).toBe(2); // booked, then moved
    expect(byEntity.every((e) => e.rowId === omarLesson.rowId)).toBe(true);

    const notes = all.find((e) => e.table === 'lesson_notes')!;
    expect(listAuditEventsDemo(db, admin, { entityId: notes.relatedIds[0] }).events.map((e) => e.id)).toContain(notes.id);

    const mansoori = listAuditEventsDemo(db, admin, { familyId: 'f-mansoori' }).events;
    expect(mansoori.length).toBeGreaterThan(0);
    expect(mansoori.every((e) => e.familyIds.includes('f-mansoori'))).toBe(true);
    expect(mansoori.some((e) => e.table === 'payments')).toBe(true);

    const layla = listAuditEventsDemo(db, admin, { studentId: 's-layla' }).events;
    expect(layla.length).toBeGreaterThan(0);
    expect(layla.every((e) => e.studentIds.includes('s-layla'))).toBe(true);

    const sarah = listAuditEventsDemo(db, admin, { tutorId: 't-sarah' }).events;
    expect(sarah.length).toBeGreaterThan(0);
    expect(sarah.every((e) => e.tutorId === 't-sarah')).toBe(true);

    const bySarah = listAuditEventsDemo(db, admin, { actorId: 'u-tutor' }).events;
    expect(bySarah.length).toBeGreaterThan(0);
    expect(bySarah.every((e) => e.actorId === 'u-tutor')).toBe(true);

    const billing = listAuditEventsDemo(db, admin, { tables: ['invoices', 'payments'] }).events;
    expect(new Set(billing.map((e) => e.table))).toEqual(new Set(['invoices', 'payments']));
    expect(listAuditEventsDemo(db, admin, { tables: [] }).events.length).toBe(Math.min(all.length, 30));

    const from = addDays(NOW, -10).toISOString();
    const to = addDays(NOW, -2).toISOString();
    const window = listAuditEventsDemo(db, admin, { from, to }).events;
    expect(window.length).toBeGreaterThan(0);
    expect(window.length).toBe(all.filter((e) => e.at >= from && e.at < to).length);
  });

  it('pages newest first without overlaps', () => {
    const seen: AuditEvent[] = [];
    let before: { at: string; id: string } | undefined;
    for (let i = 0; i < 20; i++) {
      const page = listAuditEventsDemo(db, admin, {}, { before, limit: 4 });
      seen.push(...page.events);
      if (!page.next) break;
      expect(page.events).toHaveLength(4);
      before = page.next;
    }
    expect(seen.map((e) => e.id)).toEqual([...all].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).map((e) => e.id));
    expect(new Set(seen.map((e) => e.id)).size).toBe(all.length);
    const exact = listAuditEventsDemo(db, admin, {}, { limit: all.length });
    expect(exact.next).toBeNull();
  });

  it('lists the people in the trail', () => {
    expect(listAuditActorsDemo(db, admin)).toEqual([
      { id: 'u-admin', name: "Craig O'Brien", role: 'admin' },
      { id: 'u-tutor', name: 'Sarah Khan', role: 'tutor' },
    ]);
  });

  it('records changes against a snapshot taken earlier', () => {
    const copy = structuredClone(db);
    const snap = snapshotAudited(copy);
    copy.families.find((f) => f.id === 'f-sharma')!.phone = '+971 50 123 4567';
    copy.services = copy.services.filter((s) => s.id !== 'svc-primary');
    const count = copy.audit!.length;
    recordAuditChanges(copy, snap, admin, NOW);
    const added = copy.audit!.slice(count).map((e) => describeAuditEvent(e, namesFor(copy)).summary);
    expect(added).toEqual(["Craig updated the Sharma family's details.", "Craig removed the service 'Primary 1:1'."]);
  });
});
