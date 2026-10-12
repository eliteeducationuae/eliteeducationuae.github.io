import { q, visibleStudentIds } from '../demo/db';
import { createSeed } from '../demo/seed';

// Mirrors supabase/migrations/20261114000200_sec_db.sql and 20261114000600_sec_db_families.sql
// (supabase/tests/sec_db_test.sql and sec_db_families_test.sql).
describe('demo: tutors see the students they currently teach, and families by name only', () => {
  const who = (db: ReturnType<typeof createSeed>, id: string) => db.profiles.find((p) => p.id === id)!;

  it('gives a tutor the families they teach without email or telephone', () => {
    const db = createSeed();
    const families = q.families(db, who(db, 'u-tutor'));
    expect(families.length).toBeGreaterThan(0);
    for (const f of families) {
      expect(f.name).toBeTruthy();
      expect(f.parentName).toBeTruthy();
      expect(f.email).toBe('');
      expect(f.phone).toBeUndefined();
    }
  });

  it('keeps the office, the accountant and the family itself unchanged', () => {
    const db = createSeed();
    expect(q.families(db, who(db, 'u-admin')).every((f) => f.email)).toBe(true);
    expect(q.families(db, who(db, 'u-accountant'))).toHaveLength(db.families.length);
    const own = q.families(db, who(db, 'u-parent'));
    expect(own.map((f) => f.id)).toEqual(['f-mansoori']);
    expect(own[0].email).toBeTruthy();
  });

  it('drops a student once the tutor no longer teaches them', () => {
    const db = createSeed();
    const tutor = who(db, 'u-tutor');
    expect(visibleStudentIds(db, tutor).has('s-yasmin')).toBe(true);
    // The office moves Yasmin to another tutor; her lessons with Sarah are long past.
    db.enrolments = db.enrolments.map((e) => (e.studentId === 's-yasmin' && e.tutorId === 't-sarah' ? { ...e, tutorId: 't-nour' } : e));
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    db.lessons = db.lessons.map((l) =>
      l.tutorId === 't-sarah' && l.studentIds.includes('s-yasmin') ? { ...l, status: 'completed', start: old, end: old } : l,
    );
    db.reports = db.reports.filter((r) => !(r.studentId === 's-yasmin' && r.tutorId === 't-sarah'));
    expect(visibleStudentIds(db, tutor).has('s-yasmin')).toBe(false);
  });

  it('keeps a student for a week after a covered lesson, and while a report is being written', () => {
    const db = createSeed();
    const tutor = who(db, 'u-tutor');
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
    db.lessons.push({ ...db.lessons.find((l) => l.tutorId === 't-sarah')!, id: 'cover', studentIds: ['s-noor'], status: 'completed', start: recent, end: recent });
    expect(visibleStudentIds(db, tutor).has('s-noor')).toBe(true);
    const stale = new Date(Date.now() - 8 * 86_400_000).toISOString();
    db.lessons = db.lessons.map((l) => (l.id === 'cover' ? { ...l, start: stale, end: stale } : l));
    expect(visibleStudentIds(db, tutor).has('s-noor')).toBe(false);
    db.reports.push({ ...db.reports[0], id: 'rep-noor', studentId: 's-noor', tutorId: 't-sarah', status: 'draft' });
    expect(visibleStudentIds(db, tutor).has('s-noor')).toBe(true);
  });
});
