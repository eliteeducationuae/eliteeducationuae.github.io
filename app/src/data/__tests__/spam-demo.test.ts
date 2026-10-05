import { mergeMessage, RATE_LIMIT_MESSAGE } from '@/domain/spam';

import { AccessError } from '../demo/db';
import { eq } from '../demo/engagement';
import { ops } from '../demo/operations';
import { createSeed } from '../demo/seed';

const NOW = new Date(2026, 9, 2, 12, 0); // Fri 2 Oct 2026
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const who = (db: ReturnType<typeof createSeed>, role: string) => db.profiles.find((p) => p.role === role)!;

const layla = { parentName: 'Layla Haddad', email: 'layla@example.com', message: 'We would like help with IB Maths for our daughter', source: 'website' as const };

describe('public enquiries (mirrors submit_enquiry spam protection)', () => {
  it('keeps very fast submissions but marks them as possible spam', () => {
    const db = createSeed(NOW);
    eq.submitEnquiry(db, null, { parentName: 'Quick Bot', email: 'bot@example.com', message: 'Hello', elapsedMs: 900 }, NOW);
    const e = db.enquiries[db.enquiries.length - 1];
    expect(e.spamStatus).toBe('suspected');
    expect(e.spamReasons).toEqual(['too-fast']);
    expect(e).not.toHaveProperty('elapsedMs');

    eq.submitEnquiry(db, null, { ...layla, elapsedMs: 8000 }, NOW);
    expect(db.enquiries[db.enquiries.length - 1].spamStatus).toBe('clean');
  });

  it('merges repeats into one enquiry and pauses the fourth within an hour', () => {
    const db = createSeed(NOW);
    const before = db.enquiries.length;
    eq.submitEnquiry(db, null, { ...layla, elapsedMs: 5000 }, at(0));
    eq.submitEnquiry(db, null, { ...layla, phone: '+971 50 000 0000', elapsedMs: 5000 }, at(5));
    eq.submitEnquiry(db, null, { ...layla, message: `${layla.message} and Physics`, elapsedMs: 5000 }, at(10));
    expect(db.enquiries.length).toBe(before + 1);
    const e = db.enquiries[db.enquiries.length - 1];
    expect(e.repeatCount).toBe(2);
    expect(e.phone).toBe('+971 50 000 0000');
    // The earlier message is kept; the different one is added underneath.
    expect(e.message).toBe(mergeMessage(layla.message, `${layla.message} and Physics`, at(10)));
    expect(e.message).toMatch(/^We would like help with IB Maths for our daughter\n\nRe-sent on \d+ October 2026: We would like help with IB Maths for our daughter and Physics$/);
    expect(e.lastSubmittedAt).toBe(at(10).toISOString());
    expect(() => eq.submitEnquiry(db, null, { ...layla, elapsedMs: 5000 }, at(15))).toThrow(RATE_LIMIT_MESSAGE);
    // An hour after the first, there is room again.
    expect(() => eq.submitEnquiry(db, null, { ...layla, elapsedMs: 5000 }, at(61))).not.toThrow();
  });

  it('never flags a signed-in family, whose form arrives pre-filled', () => {
    const db = createSeed(NOW);
    const parent = who(db, 'parent');
    eq.submitEnquiry(db, parent, { parentName: parent.fullName, email: 'family@example.com', message: 'Consultation please', elapsedMs: 400 }, NOW);
    const e = db.enquiries[db.enquiries.length - 1];
    expect(e.spamStatus).toBe('clean');
    expect(e.familyId).toBe(parent.familyId);
  });

  it('keeps a repeat that looks automated apart from the genuine enquiry', () => {
    const db = createSeed(NOW);
    const before = db.enquiries.length;
    eq.submitEnquiry(db, null, { ...layla, elapsedMs: 5000 }, at(0));
    eq.submitEnquiry(db, null, { ...layla, message: `${layla.message} http://a.example http://b.example http://c.example`, elapsedMs: 5000 }, at(1));
    expect(db.enquiries.length).toBe(before + 2);
    const [first, second] = db.enquiries.slice(before);
    expect(first.message).toBe(layla.message);
    expect(first.spamStatus).toBe('clean');
    expect(first.repeatCount).toBe(0);
    expect(second.spamStatus).toBe('suspected');
  });

  it('keeps enquiries about different children apart', () => {
    const db = createSeed(NOW);
    const before = db.enquiries.length;
    eq.submitEnquiry(db, null, { ...layla, studentName: 'Omar' }, at(0));
    eq.submitEnquiry(db, null, { ...layla, studentName: 'Sara' }, at(1));
    expect(db.enquiries.length).toBe(before + 2);
  });

  it('refuses answers that are far too long', () => {
    const db = createSeed(NOW);
    expect(() => eq.submitEnquiry(db, null, { ...layla, message: 'x'.repeat(4001) }, NOW)).toThrow('Please shorten your message to 4,000 characters or fewer');
  });

  it('lets admins add enquiries without limits or flags', () => {
    const db = createSeed(NOW);
    const admin = who(db, 'admin');
    const before = db.enquiries.length;
    for (let i = 0; i < 5; i++) eq.submitEnquiry(db, admin, { ...layla, source: 'phone', elapsedMs: 100 }, at(i));
    expect(db.enquiries.length).toBe(before + 5);
    expect(db.enquiries.slice(before).every((e) => e.spamStatus === 'clean')).toBe(true);
  });

  it('lets only admins mark something as spam or not spam', () => {
    const db = createSeed(NOW);
    eq.submitEnquiry(db, null, { parentName: 'Quick Bot', email: 'bot@example.com', elapsedMs: 100 }, NOW);
    const e = db.enquiries[db.enquiries.length - 1];
    expect(() => eq.setSpamStatus(db, who(db, 'parent'), 'enquiry', e.id, false)).toThrow(AccessError);
    expect(() => eq.setSpamStatus(db, who(db, 'tutor'), 'enquiry', e.id, true)).toThrow(AccessError);
    eq.setSpamStatus(db, who(db, 'admin'), 'enquiry', e.id, false);
    expect(e.spamStatus).toBe('clean');
    eq.setSpamStatus(db, who(db, 'admin'), 'enquiry', e.id, true);
    expect(e.spamStatus).toBe('spam');
    expect(() => eq.setSpamStatus(db, who(db, 'admin'), 'enquiry', 'nope', true)).toThrow('Enquiry not found');
  });
});

describe('tutor applications (mirrors submit_tutor_application spam protection)', () => {
  const sam = { fullName: 'Sam Tutor', email: 'Sam@Example.com', curricula: ['IB'], phases: ['Secondary'], experience: 'Five years' };

  it('flags, merges repeats and pauses the third within an hour', () => {
    const db = createSeed(NOW);
    const before = db.applications.length;
    ops.submitApplication(db, { ...sam, elapsedMs: 1000 }, at(0));
    const a = db.applications[db.applications.length - 1];
    expect(a.spamStatus).toBe('suspected');
    expect(a.spamReasons).toEqual(['too-fast']);
    expect(a).not.toHaveProperty('elapsedMs');

    ops.submitApplication(db, { ...sam, curricula: ['A Level'], phases: ['Sixth form'], experience: 'Five years of IB and A Level teaching', qualifications: 'PGCE' }, at(5));
    expect(db.applications.length).toBe(before + 1);
    expect(a.repeatCount).toBe(1);
    expect(a.curricula).toEqual(['IB', 'A Level']);
    expect(a.phases).toEqual(['Secondary', 'Sixth form']);
    // Only blanks are filled: the experience already given is kept.
    expect(a.experience).toBe('Five years');
    expect(a.qualifications).toBe('PGCE');
    expect(a.spamStatus).toBe('suspected');

    expect(() => ops.submitApplication(db, sam, at(10))).toThrow(RATE_LIMIT_MESSAGE);
  });

  it('never replaces an existing CV or experience, and keeps a link-laden repeat apart', () => {
    const db = createSeed(NOW);
    const before = db.applications.length;
    ops.submitApplication(db, { ...sam, cvPath: 'cv/sam.pdf' }, at(0));
    ops.submitApplication(db, { ...sam, cvPath: 'cv/other.pdf', experience: 'Something much longer written by somebody else' }, at(1));
    const a = db.applications[before];
    expect(db.applications.length).toBe(before + 1);
    expect(a.cvPath).toBe('cv/sam.pdf');
    expect(a.experience).toBe('Five years');
    db.formSubmissions = [];
    ops.submitApplication(db, { ...sam, experience: 'http://a.example http://b.example http://c.example' }, at(2));
    expect(db.applications.length).toBe(before + 2);
    expect(db.applications[before + 1].spamReasons).toEqual(['links']);
    expect(a.experience).toBe('Five years');
  });

  it('lets admins mark applications as spam', () => {
    const db = createSeed(NOW);
    ops.submitApplication(db, { ...sam, fullName: 'Visit www.example.com' }, NOW);
    const a = db.applications[db.applications.length - 1];
    expect(a.spamReasons).toEqual(['link-in-name']);
    eq.setSpamStatus(db, who(db, 'admin'), 'application', a.id, true);
    expect(a.spamStatus).toBe('spam');
    expect(() => eq.setSpamStatus(db, who(db, 'tutor'), 'application', a.id, false)).toThrow(AccessError);
  });
});
