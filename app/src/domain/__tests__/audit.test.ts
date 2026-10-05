import {
  AUDIT_RULES,
  AUDIT_TYPE_GROUPS,
  ERASED,
  REDACTED,
  actorLabeller,
  auditActorLabel,
  describeAuditContext,
  auditEventFromRow,
  describeAuditEvent,
  diffAuditRows,
  redactAuditRow,
  type AuditEvent,
  type AuditNames,
} from '../audit';
import { formatAED } from '../billing';

// Local times, so the expected wording holds in any time zone. (14 Oct 2025 was a Tuesday.)
const iso = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const UUID_SARAH = '3f2a9c1e-0b7d-4e55-9a10-2c4d6e8f0a1b';
const UUID_JAMES = '9b8c7d6e-5f4a-4321-8abc-def012345678';
const UUID_OMAR = '11111111-2222-4333-8444-555555555555';
const UUID_LAYLA = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const UUID_UNKNOWN = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';

const people: Record<string, string> = {
  [UUID_SARAH]: 'Sarah Khan',
  [UUID_JAMES]: 'James Wilson',
  [UUID_OMAR]: 'Omar Al Mansoori',
  [UUID_LAYLA]: 'Layla Al Mansoori',
};
const names: AuditNames = {
  tutor: (id) => people[id],
  student: (id) => people[id],
  family: (id) => (id === 'fam-1' ? 'Al Mansoori' : undefined),
  service: (id) => (id === 'svc-1' ? 'IB Diploma 1:1' : undefined),
};

const ev = (e: Partial<AuditEvent>): AuditEvent => ({
  id: 'aud-1',
  at: iso(2026, 10, 4, 9),
  actorId: 'u-admin',
  actorName: "Craig O'Brien",
  actorRole: 'admin',
  actingAsId: null,
  action: 'update',
  table: 'lessons',
  rowId: 'row-1',
  familyIds: [],
  studentIds: [],
  tutorId: null,
  relatedIds: [],
  before: null,
  after: null,
  ...e,
});
const sarah = { actorId: 'u-tutor', actorName: 'Sarah Khan', actorRole: 'tutor' };
const system = { actorId: null, actorName: null, actorRole: 'system' };
const say = (e: Partial<AuditEvent>) => describeAuditEvent(ev(e), names);

describe('audit descriptions', () => {
  it('names the actor by first name, or the system', () => {
    expect(auditActorLabel(ev({}))).toBe('Craig');
    expect(auditActorLabel(ev(system))).toBe('The system');
  });

  it('describes lessons being moved, scheduled, cancelled, completed and reassigned', () => {
    const moved = say({
      before: { start_at: iso(2025, 10, 14, 16), end_at: iso(2025, 10, 14, 17) },
      after: { start_at: iso(2025, 10, 15, 17), end_at: iso(2025, 10, 15, 18) },
    });
    expect(moved.summary).toBe('Craig moved the lesson from Tue 14 Oct 16:00 to Wed 15 Oct 17:00.');
    expect(moved.changes).toEqual([]);

    expect(say({ action: 'insert', after: { start_at: iso(2025, 10, 14, 16), student_ids: [UUID_OMAR] } }).summary).toBe(
      'Craig scheduled a lesson for Omar on Tue 14 Oct at 16:00.',
    );
    expect(say({ action: 'insert', after: { start_at: iso(2025, 10, 14, 16), student_ids: [UUID_OMAR, UUID_LAYLA] } }).summary).toBe(
      'Craig scheduled a lesson for Omar and Layla on Tue 14 Oct at 16:00.',
    );
    expect(say({ before: { status: 'scheduled' }, after: { status: 'cancelled' } }).summary).toBe('Craig cancelled the lesson.');
    expect(say({ before: { status: 'scheduled' }, after: { status: 'late-cancel' } }).summary).toBe('Craig cancelled the lesson at short notice.');
    expect(say({ ...sarah, before: { status: 'scheduled' }, after: { status: 'completed' } }).summary).toBe('Sarah recorded the lesson as completed.');
    expect(say({ before: { status: 'scheduled' }, after: { status: 'no-show' } }).summary).toBe('Craig recorded the lesson as a no-show.');
    const reassigned = say({ before: { tutor_id: UUID_SARAH }, after: { tutor_id: UUID_JAMES } });
    expect(reassigned.summary).toBe('Craig reassigned the lesson from Sarah Khan to James Wilson.');
    expect(reassigned.changes).toEqual([]);
  });

  it('describes lesson notes', () => {
    expect(say({ ...sarah, table: 'lesson_notes', action: 'insert', after: { summary: 'x' } }).summary).toBe('Sarah wrote the lesson notes.');
    expect(say({ ...sarah, table: 'lesson_notes', before: { summary: 'x' }, after: { summary: 'y' } }).summary).toBe('Sarah updated the lesson notes.');
  });

  it('describes invoices and payments', () => {
    expect(say({ table: 'invoices', action: 'insert', after: { number: '1001', status: 'draft' } }).summary).toBe('Craig created invoice 1001.');
    expect(say({ table: 'invoices', before: { status: 'draft' }, after: { status: 'sent' } }).summary).toBe('Craig sent the invoice.');
    expect(say({ table: 'invoices', before: { status: 'draft', number: '1001' }, after: { status: 'sent', number: '1001' } }).summary).toBe(
      'Craig sent invoice 1001.',
    );
    expect(say({ ...system, table: 'invoices', before: { status: 'sent' }, after: { status: 'paid' } }).summary).toBe('The system marked the invoice as paid.');
    expect(say({ table: 'invoices', before: { status: 'sent' }, after: { status: 'void' } }).summary).toBe('Craig voided the invoice.');
    expect(say({ ...system, table: 'payments', action: 'insert', after: { amount: 450, method: 'card' } }).summary).toBe(
      `The system recorded a card payment of ${formatAED(450)}.`,
    );
    expect(say({ table: 'payments', action: 'insert', after: { amount: 450.5, method: 'bank-transfer' } }).summary).toBe(
      'Craig recorded a bank transfer of AED 450.50.',
    );
  });

  it('describes charges, packages and tutor invoices', () => {
    expect(say({ table: 'charges', action: 'insert', after: { amount: 350 } }).summary).toBe(`Craig added a charge of ${formatAED(350)}.`);
    expect(say({ table: 'packages', action: 'insert', after: { name: '10 lessons', price: 4000 } }).summary).toBe(
      `Craig sold the package '10 lessons' for ${formatAED(4000)}.`,
    );
    const ti = { table: 'tutor_invoices', tutorId: UUID_SARAH };
    expect(say({ ...ti, ...sarah, before: { status: 'draft' }, after: { status: 'submitted' } }).summary).toBe('Sarah submitted the tutor invoice for Sarah Khan.');
    expect(say({ ...ti, before: { status: 'submitted' }, after: { status: 'approved' } }).summary).toBe('Craig approved the tutor invoice for Sarah Khan.');
    expect(say({ ...ti, before: { status: 'submitted' }, after: { status: 'rejected' } }).summary).toBe(
      'Craig returned the tutor invoice for Sarah Khan for changes.',
    );
    expect(say({ ...ti, before: { status: 'approved' }, after: { status: 'paid' } }).summary).toBe('Craig marked the tutor invoice for Sarah Khan as paid.');
  });

  it('describes enrolments', () => {
    const base = { table: 'enrolments', studentIds: [UUID_OMAR] };
    expect(say({ ...base, action: 'insert', after: { student_id: UUID_OMAR, subject: 'Maths' } }).summary).toBe('Craig enrolled Omar in Maths.');
    expect(say({ ...base, before: { active: true }, after: { active: false } }).summary).toBe("Craig removed one of Omar's subjects.");
    const tutor = say({ ...base, before: { tutor_id: UUID_SARAH }, after: { tutor_id: UUID_JAMES } });
    expect(tutor.summary).toBe("Craig changed the tutor for one of Omar's subjects from Sarah Khan to James Wilson.");
    expect(tutor.changes).toEqual([]);
  });

  it('describes people, services and settings with a line per change', () => {
    const student = say({ table: 'students', rowId: UUID_OMAR, before: { target_grade: '6' }, after: { target_grade: '7' } });
    expect(student).toEqual({ summary: "Craig updated Omar Al Mansoori's details.", changes: ['Target grade: 6 → 7'] });
    expect(say({ table: 'students', action: 'insert', after: { full_name: 'Zara Khan' } }).summary).toBe('Craig added Zara Khan.');
    expect(say({ table: 'families', rowId: 'fam-1', before: { phone: '+971 50 1' }, after: { phone: '+971 50 2' } })).toEqual({
      summary: "Craig updated the Al Mansoori family's details.",
      changes: ['Phone: +971 50 1 → +971 50 2'],
    });
    expect(say({ table: 'tutors', rowId: UUID_SARAH, before: { hourly_pay: 200 }, after: { hourly_pay: 220.5 } })).toEqual({
      summary: "Craig updated Sarah Khan's details.",
      changes: [`Hourly pay: ${formatAED(200)} → AED 220.50`],
    });
    expect(say({ table: 'services', action: 'delete', rowId: 'svc-1', before: { name: 'IB Diploma 1:1' } }).summary).toBe(
      "Craig removed the service 'IB Diploma 1:1'.",
    );
    const settings = say({ table: 'settings', before: { bank_details: REDACTED, vat_rate: 0, email_invoices: true }, after: { bank_details: REDACTED, vat_rate: 0.05, email_invoices: false } });
    expect(settings.summary).toBe('Craig changed the business settings.');
    expect(settings.changes).toEqual(['Bank details were changed (hidden for security).', 'VAT rate: 0% → 5%', 'Email invoices: Yes → No']);
  });

  it('describes reports, homework and roles', () => {
    expect(say({ table: 'student_reports', before: { status: 'submitted' }, after: { status: 'approved' } }).summary).toBe('Craig approved the report.');
    expect(say({ table: 'student_reports', before: { status: 'approved' }, after: { status: 'published', published_at: iso(2026, 10, 4) } })).toEqual({
      summary: 'Craig published the report.',
      changes: [],
    });
    expect(say({ ...sarah, table: 'student_reports', before: { status: 'draft' }, after: { status: 'submitted' } }).summary).toBe('Sarah submitted the report.');
    expect(say({ ...sarah, table: 'homework', action: 'insert', after: { title: 'Vectors worksheet', due_date: '2025-10-17', done: false } }).summary).toBe(
      "Sarah set homework 'Vectors worksheet' due Fri 17 Oct.",
    );
    expect(say({ table: 'homework', before: { done: false }, after: { done: true } }).summary).toBe('Craig marked the homework as done.');
    const due = say({ table: 'homework', before: { due_date: '2026-10-17' }, after: { due_date: '2026-10-20' } });
    expect(due.changes).toEqual(['Due date: 17 Oct 2026 → 20 Oct 2026']);
    expect(
      say({
        table: 'opportunities',
        before: { title: 'IB Maths HL', status: 'open', awarded_tutor_id: null },
        after: { title: 'IB Maths HL', status: 'awarded', awarded_tutor_id: UUID_SARAH, awarded_at: iso(2026, 10, 4) },
      }),
    ).toEqual({ summary: "Craig awarded the role 'IB Maths HL' to Sarah Khan.", changes: [] });
  });

  it('falls back to a generic sentence for other tables', () => {
    expect(say({ table: 'topic_lists', before: { name: 'a' }, after: { name: 'b' } })).toEqual({
      summary: 'Craig changed a record in topic lists.',
      changes: ['Name: a → b'],
    });
    expect(say({ ...system, table: 'expenses', action: 'insert', after: { amount: 5 } })).toEqual({
      summary: 'The system added a record to expenses.',
      changes: [],
    });
  });

  it('never prints raw ids', () => {
    const texts = [
      say({ before: { tutor_id: UUID_SARAH, student_ids: [UUID_OMAR] }, after: { tutor_id: UUID_UNKNOWN, student_ids: [UUID_UNKNOWN] } }),
      say({ table: 'charges', before: { invoice_id: UUID_UNKNOWN, lesson_id: null }, after: { invoice_id: UUID_JAMES, lesson_id: UUID_OMAR } }),
      say({ table: 'students', rowId: UUID_UNKNOWN, before: { school: UUID_UNKNOWN }, after: { school: 'x' } }),
      say({ action: 'insert', after: { start_at: iso(2025, 10, 14, 16), student_ids: [UUID_UNKNOWN] } }),
    ];
    const all = JSON.stringify(texts);
    for (const id of [UUID_SARAH, UUID_JAMES, UUID_OMAR, UUID_UNKNOWN]) expect(all).not.toContain(id);
    expect(texts[0].summary).toBe('Craig reassigned the lesson from Sarah Khan to someone.');
    expect(texts[0].changes).toEqual(['Students: Omar Al Mansoori → someone']);
    expect(texts[1].changes).toEqual(['Invoice was changed.', 'Lesson was changed.']);
    expect(texts[3].summary).toBe('Craig scheduled a lesson for a student on Tue 14 Oct at 16:00.');
  });
});

describe('audit recording rules', () => {
  it('redacts sensitive columns but keeps empty values empty', () => {
    expect(
      redactAuditRow('settings', { bank_details: 'IBAN AE07', stripe_customer_id: 'cus_1', ics_token: 'abc', notify_email: 'a@b.c', swift: null }),
    ).toEqual({ bank_details: REDACTED, stripe_customer_id: REDACTED, ics_token: REDACTED, notify_email: 'a@b.c', swift: null });
  });

  it('keeps only changed columns, redacted, and ignores housekeeping', () => {
    const diff = diffAuditRows(
      'settings',
      { bank_details: 'IBAN AE07 0000', vat_rate: 0, next_invoice_number: 1001 },
      { bank_details: 'IBAN AE07 9999', vat_rate: 0, next_invoice_number: 1002 },
    );
    expect(diff).toEqual({ before: { bank_details: REDACTED }, after: { bank_details: REDACTED } });
    expect(JSON.stringify(diff)).not.toContain('AE07');
    expect(diffAuditRows('settings', { next_invoice_number: 1 }, { next_invoice_number: 2 })).toBeNull();
    expect(diffAuditRows('lessons', { status: 'scheduled', reminded_at: null }, { status: 'scheduled', reminded_at: iso(2026, 10, 4) })).toBeNull();
    expect(diffAuditRows('invoices', { autopay_attempts: 0, autopay_claimed_at: null }, { autopay_attempts: 1, autopay_claimed_at: 'x' })).toBeNull();
    expect(diffAuditRows('lessons', { student_ids: ['a', 'b'], status: 'x' }, { student_ids: ['a', 'b'], status: 'x' })).toBeNull();
    expect(diffAuditRows('lessons', { student_ids: ['a'] }, { student_ids: ['a', 'b'] })).toEqual({ before: { student_ids: ['a'] }, after: { student_ids: ['a', 'b'] } });
    // Same object, different key order: no change.
    expect(diffAuditRows('lesson_notes', { attendance: { a: 'present', b: 'late' } }, { attendance: { b: 'late', a: 'present' } })).toBeNull();
    expect(diffAuditRows('lessons', null, null)).toBeNull();
    expect(diffAuditRows('lessons', null, { id: 'l1', reminded_at: 'x', status: 'scheduled' })).toEqual({ before: null, after: { id: 'l1', status: 'scheduled' } });
    expect(diffAuditRows('tutor_invoices', { id: 't', bank_iban: 'AE07' }, null)).toEqual({ before: { id: 't', bank_iban: REDACTED }, after: null });
  });

  it('records only status changes on reports', () => {
    const base = { id: 'r1', status: 'draft', comment: 'Good', updated_at: 'a', submitted_at: null, published_at: null };
    expect(AUDIT_RULES.student_reports.when).toEqual(['status']);
    expect(diffAuditRows('student_reports', null, base)).toBeNull();
    expect(diffAuditRows('student_reports', base, null)).toBeNull();
    expect(diffAuditRows('student_reports', base, { ...base, comment: 'Better', updated_at: 'b' })).toBeNull();
    expect(diffAuditRows('student_reports', base, { ...base, comment: 'Better', status: 'submitted', submitted_at: 'c', updated_at: 'b' })).toEqual({
      before: { status: 'draft' },
      after: { status: 'submitted', submitted_at: 'c' },
    });
  });

  it('records only awards and status changes on roles, with the title', () => {
    const base = { id: 'o1', title: 'IB Maths HL', status: 'open', awarded_tutor_id: null, awarded_at: null, description: 'x', pay_rate: 200 };
    expect(diffAuditRows('opportunities', null, base)).toBeNull();
    expect(diffAuditRows('opportunities', base, { ...base, pay_rate: 250, description: 'y' })).toBeNull();
    expect(diffAuditRows('opportunities', base, { ...base, status: 'awarded', awarded_tutor_id: 't1', awarded_at: 'now', pay_rate: 250 })).toEqual({
      before: { title: 'IB Maths HL', status: 'open', awarded_tutor_id: null, awarded_at: null },
      after: { title: 'IB Maths HL', status: 'awarded', awarded_tutor_id: 't1', awarded_at: 'now' },
    });
    expect(diffAuditRows('opportunities', base, { ...base, status: 'closed' })).toEqual({
      before: { title: 'IB Maths HL', status: 'open' },
      after: { title: 'IB Maths HL', status: 'closed' },
    });
  });

  it('groups every table the History filter offers once', () => {
    const tables = AUDIT_TYPE_GROUPS.flatMap((g) => g.tables);
    expect(new Set(tables).size).toBe(tables.length);
    expect(tables).toEqual(expect.arrayContaining(['lessons', 'lesson_notes', 'invoices', 'payments', 'student_reports', 'settings']));
  });

  it('maps RPC rows to events', () => {
    const e = auditEventFromRow({
      id: 'a1',
      at: '2026-10-04T05:00:00+00:00',
      actor_id: null,
      actor_name: null,
      actor_role: 'system',
      acting_as: null,
      action: 'insert',
      table_name: 'payments',
      row_id: 'p1',
      family_ids: ['f1'],
      student_ids: null,
      tutor_id: null,
      related_ids: ['i1'],
      before: null,
      after: { amount: 450, method: 'card' },
      context: { invoice_number: 'INV-1001' },
    });
    expect(e).toEqual({
      id: 'a1',
      at: '2026-10-04T05:00:00+00:00',
      actorId: null,
      actorName: null,
      actorRole: 'system',
      actingAsId: null,
      action: 'insert',
      table: 'payments',
      rowId: 'p1',
      familyIds: ['f1'],
      studentIds: [],
      tutorId: null,
      relatedIds: ['i1'],
      before: null,
      after: { amount: 450, method: 'card' },
      context: { invoice_number: 'INV-1001' },
    });
    expect(auditEventFromRow({ id: 'a2', at: 'x', action: 'update', table: 'lessons' }).table).toBe('lessons');
  });
});

describe('audit context', () => {
  const lessonStart = iso(2026, 10, 8, 16);
  const ctx = (e: Partial<AuditEvent>) => describeAuditContext(ev(e), names);

  it('names the students, subject and lesson day for lesson records', () => {
    const lesson = { table: 'lessons', studentIds: [UUID_OMAR], context: { lesson_start: lessonStart, subject: 'Chemistry' } };
    expect(ctx({ ...lesson, before: { status: 'scheduled' }, after: { status: 'completed' } })).toBe('Omar · Chemistry · Thu 8 Oct');
    expect(say({ ...lesson, before: { status: 'scheduled' }, after: { status: 'completed' } })).toEqual({
      summary: 'Craig recorded the lesson as completed.',
      context: 'Omar · Chemistry · Thu 8 Oct',
      changes: [],
    });
    expect(ctx({ ...lesson, table: 'lesson_notes', action: 'insert', studentIds: [UUID_OMAR, UUID_LAYLA] })).toBe('Omar and Layla · Chemistry · Thu 8 Oct');
    // Without saved context, a lesson falls back to its own row and service.
    expect(ctx({ table: 'lessons', action: 'insert', studentIds: [UUID_OMAR], after: { start_at: lessonStart, service_id: 'svc-1' } })).toBe(
      'Omar · IB Diploma 1:1 · Thu 8 Oct',
    );
  });

  it('names the student and subject for reports and homework', () => {
    expect(ctx({ table: 'student_reports', studentIds: [UUID_LAYLA], context: { subject: 'English' } })).toBe('Layla · English');
    expect(ctx({ table: 'homework', action: 'insert', studentIds: [UUID_OMAR] })).toBe('Omar');
  });

  it('names the family and invoice for billing records', () => {
    expect(ctx({ table: 'payments', action: 'insert', familyIds: ['fam-1'], context: { invoice_number: 'INV-1001' } })).toBe(
      'Al Mansoori family · INV-1001',
    );
    expect(ctx({ table: 'invoices', familyIds: ['fam-1'], context: { invoice_number: 'INV-1001' } })).toBe('Al Mansoori family');
    expect(ctx({ table: 'charges', action: 'insert', studentIds: [UUID_OMAR], context: { invoice_number: 'INV-1002', subject: 'Maths' } })).toBe(
      'Omar · Maths · INV-1002',
    );
  });

  it('adds nothing when the summary already names the record, or nothing is known', () => {
    expect(ctx({ table: 'students', rowId: UUID_OMAR, studentIds: [UUID_OMAR] })).toBeUndefined();
    expect(ctx({ table: 'settings' })).toBeUndefined();
    expect(ctx({ table: 'lessons', studentIds: [UUID_UNKNOWN] })).toBeUndefined();
    expect(say({ table: 'settings', before: { vat_rate: 0 }, after: { vat_rate: 0.05 } })).not.toHaveProperty('context');
  });
});

describe('audit privacy and naming', () => {
  it('redacts payment-provider ids whatever the column, but not ordinary words', () => {
    expect(redactAuditRow('payments', { reference: 'pi_test_123', method: 'card', note: 'in person', status: 'in-progress' })).toEqual({
      reference: REDACTED,
      method: 'card',
      note: 'in person',
      status: 'in-progress',
    });
    const diff = diffAuditRows('payments', null, { id: 'p1', amount: 300, reference: 'pi_3PabcDEF', stripe_payment_intent: 'pi_3PabcDEF' });
    expect(JSON.stringify(diff)).not.toContain('pi_3P');
    expect(redactAuditRow('payments', { reference: 'TRF-1' })).toEqual({ reference: 'TRF-1' });
  });

  it('ignores automatic-payment bookkeeping on invoices', () => {
    expect(diffAuditRows('invoices', { autopay_status: 'pending', autopay_error: null }, { autopay_status: 'failed', autopay_error: 'Card declined' })).toBeNull();
  });

  it('keeps only who it was when a person is deleted', () => {
    expect(diffAuditRows('families', { id: 'f1', name: 'Gone', email: 'g@x', phone: '+971' }, null)).toEqual({
      before: { id: 'f1', name: 'Gone' },
      after: null,
    });
    expect(diffAuditRows('students', { id: 's1', full_name: 'Sam', family_id: 'f1', target_grade: '7' }, null)).toEqual({
      before: { id: 's1', full_name: 'Sam', family_id: 'f1' },
      after: null,
    });
  });

  it('describes erased values without showing them', () => {
    expect(say({ table: 'families', before: { phone: null }, after: { phone: ERASED } }).changes).toEqual(['Phone was changed (erased on request).']);
    expect(auditActorLabel(ev({ actorName: null }))).toBe('A former user');
  });

  it('adds a surname initial only when two people share a first name', () => {
    const label = actorLabeller([
      { id: 'u-1', name: 'Sarah Khan' },
      { id: 'u-2', name: 'Sarah Miles' },
      { id: 'u-3', name: "Craig O'Brien" },
    ]);
    expect(label(ev({ actorId: 'u-1', actorName: 'Sarah Khan' }))).toBe('Sarah K.');
    expect(label(ev({ actorId: 'u-2', actorName: 'Sarah Miles' }))).toBe('Sarah M.');
    expect(label(ev({ actorId: 'u-3', actorName: "Craig O'Brien" }))).toBe('Craig');
    expect(label(ev(system))).toBe('The system');
    expect(describeAuditEvent(ev({ actorId: 'u-1', actorName: 'Sarah Khan', table: 'settings' }), { ...names, actorLabel: label }).summary).toBe(
      'Sarah K. changed the business settings.',
    );
  });
});
