import { q } from '../demo/db';
import { createSeed } from '../demo/seed';

// Mirrors supabase/migrations/20261113001200_tutorpay_fix.sql and supabase/tests/tutorpay_fix_test.sql.
describe('demo tutors: pay, email and phone', () => {
  const db = createSeed(new Date(2026, 9, 4, 12, 0));
  const who = (id: string) => db.profiles.find((p) => p.id === id)!;

  it('gives the admin every tutor in full', () => {
    const tutors = q.tutors(db, who('u-admin'));
    expect(tutors).toHaveLength(db.tutors.length);
    expect(tutors.every((t) => typeof t.hourlyPay === 'number' && t.email)).toBe(true);
  });

  it('gives a tutor their own row in full and only names for everyone else', () => {
    const tutors = q.tutors(db, who('u-tutor'));
    expect(tutors).toHaveLength(db.tutors.length);
    expect(tutors.find((t) => t.id === 't-sarah')).toMatchObject({ hourlyPay: 200, email: 'sarah@eliteeducation.me' });
    for (const t of tutors.filter((x) => x.id !== 't-sarah')) {
      expect(t.hourlyPay).toBeUndefined();
      expect(t.email).toBe('');
      expect(t.phone).toBeUndefined();
      expect(t.fullName).toBeTruthy();
    }
  });

  it.each(['u-parent', 'u-student', 'u-accountant'])('gives %s names but never pay, email or phone', (id) => {
    const tutors = q.tutors(db, who(id));
    expect(tutors.map((t) => t.fullName)).toEqual(db.tutors.map((t) => t.fullName));
    expect(tutors.some((t) => t.hourlyPay !== undefined || t.email || t.phone)).toBe(false);
  });
});
