import { SYLLABUSES } from '@/data/curriculum';
import { formatInvoiceNumber, invoiceTotals, itemsFromCharges, newInvoiceDraft } from '@/domain/billing';
import { addDays, addMinutes, startOfWeek, toDateKey } from '@/domain/dates';
import { enrolmentFor, activeEnrolments } from '@/domain/enrolments';
import { round2 } from '@/domain/tax';
import { buildTopicLookup } from '@/domain/topics';
import type { Enrolment, Invoice, Lesson, Message, Profile, Settings, Topic, TopicList, TopicRating } from '@/domain/types';

import { seedClasswork } from './classwork';
import { sampleBusyBlocks } from './calendar';
import { applyCharges, DEMO_DB_VERSION, stampTaxDetails, type DemoDB } from './db';
import { ops } from './operations';
import { tax } from './tax';

const SUMMARIES = [
  'We worked through {t1} from first principles, followed by exam-style questions on {t2}. Engagement was excellent and understanding is now considerably more secure.',
  'We reviewed last week’s homework before concentrating on {t1}. There were a few careless slips on {t2}, so we agreed a short checklist to avoid them.',
  'A past-paper session focused on {t1} and {t2}. Timing is improving; the next step is to show fuller working to secure every available mark.',
  'We consolidated {t1} and began {t2}. Routine questions are now handled with confidence, and we are building towards the more demanding problems.',
];

/** For lessons whose subject has no topic list yet. */
const OPEN_SUMMARIES = [
  'We practised number bonds and mental arithmetic through short games. Concentration was excellent throughout and confidence is growing.',
  'We explored place value and early multiplication with practical resources. Every new idea was explained clearly and carefully.',
];

/** Shared topic lists for the subjects without a built-in syllabus. Ids are fixed so the demo is stable. */
const TOPIC_LISTS: { list: TopicList; units: [string | undefined, string[]][] }[] = [
  {
    list: { id: 'tl-igcse-chemistry', subject: 'Chemistry', curriculum: 'IGCSE', name: 'IGCSE Chemistry' },
    units: [
      ['States of matter', ['Kinetic particle theory', 'Diffusion']],
      ['Atoms, elements and compounds', ['Atomic structure', 'Ionic bonding', 'Covalent bonding']],
      ['Stoichiometry', ['The mole', 'Reacting masses']],
      ['Electrochemistry', ['Electrolysis']],
      ['Acids, bases and salts', ['pH and indicators', 'Making salts']],
      ['Organic chemistry', ['Alkanes and alkenes', 'Polymers']],
    ],
  },
  {
    list: { id: 'tl-igcse-english-literature', subject: 'English Literature', curriculum: 'IGCSE', name: 'IGCSE English Literature' },
    units: [
      ['Poetry', ['Unseen poetry', 'Anthology comparison']],
      ['Prose', ['Character and theme', 'Extract analysis']],
      ['Drama', ['Shakespeare']],
    ],
  },
  {
    list: { id: 'tl-ibdp-arabic-hl', subject: 'Arabic', curriculum: 'IB DP', level: 'HL', name: 'IB DP Arabic (HL)' },
    units: [
      ['Identities', ['Personal identity and language', 'Lifestyles and health']],
      ['Experiences', ['Travel and migration']],
      ['Human ingenuity', ['Media and communication', 'Technology and innovation']],
      ['Social organisation', ['Education and the workplace']],
      ['Sharing the planet', ['Environment and sustainability', 'Human rights']],
    ],
  },
  {
    list: { id: 'tl-british-english', subject: 'English', curriculum: 'British', name: 'British English' },
    units: [[undefined, ['Reading comprehension', 'Spelling', 'Grammar and punctuation', 'Creative writing']]],
  },
];

function seedTopics(createdAt: string): { lists: TopicList[]; topics: Topic[] } {
  const lists: TopicList[] = [];
  const topics: Topic[] = [];
  for (const { list, units } of TOPIC_LISTS) {
    lists.push({ ...list, createdAt });
    let sort = 0;
    for (const [unit, names] of units) {
      for (const name of names) {
        sort += 1;
        topics.push({ id: `${list.id.replace(/^tl-/, 'tp-')}-${sort}`, listId: list.id, unit, name, sort, createdAt });
      }
    }
  }
  return { lists, topics };
}

/** Deterministic pseudo-random numbers so the demo looks the same on every reset. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface SeriesSpec {
  key: string;
  tutorId: string;
  studentIds: string[];
  serviceId: string;
  /** 0 = Monday … 6 = Sunday, or 'today'. */
  weekday: number | 'today';
  hour: number;
  minute?: number;
  location: Lesson['location'];
  subject: string;
}

export function createSeed(now: Date = new Date()): DemoDB {
  const random = rng(42);
  const settings: Settings = {
    businessName: 'Elite Education',
    currency: 'AED',
    vatRate: 0.05,
    cancellationHours: 24,
    lateCancelFee: 1,
    noShowFee: 1,
    payTutorForLateCancel: true,
    invoiceDueDays: 7,
    nextInvoiceNumber: 1001,
    bankDetails: 'Elite Education — IBAN AE00 0000 0000 0000 0000 000 (demo)',
    emailLessonNotes: true,
    emailInvoices: true,
    emailMessages: true,
    bookingNoticeHours: 24,
    // Tax: a VAT-registered business (demo details only).
    legalName: 'Elite Education (demo legal name)',
    trn: '100000000000003',
    registeredAddress: 'Office 0000, Demo Business Tower, Dubai, United Arab Emirates',
    invoiceFooter: undefined,
    vatQuarterStartMonth: 1,
    nextCreditNoteNumber: 1,
  };

  const db: DemoDB = {
    version: DEMO_DB_VERSION,
    settings,
    profiles: [],
    // Tutor colours come from TUTOR_COLORS in src/lib/tutor-colors.ts (slate, bronze, forest, plum).
    tutors: [
      {
        id: 't-craig', fullName: "Craig O'Brien", email: 'craig@eliteeducation.me', hourlyPay: 300, color: '#3F4A56',
        subjects: ['Maths', 'Further Maths'], curricula: ['IB DP', 'A-Level', 'IGCSE'], phases: ['GCSE and IGCSE', 'Sixth Form and IB Diploma'],
      },
      {
        id: 't-sarah', fullName: 'Sarah Khan', email: 'sarah@eliteeducation.me', hourlyPay: 200, color: '#7A5C1E',
        subjects: ['Maths', 'Chemistry', 'English Language'], curricula: ['IGCSE', 'GCSE', 'British'], phases: ['Lower Secondary', 'GCSE and IGCSE'],
      },
      {
        id: 't-james', fullName: 'James Wilson', email: 'james@eliteeducation.me', hourlyPay: 220, color: '#3D6B4F',
        subjects: ['Maths', 'Physics'], curricula: ['IB DP', 'IGCSE'], phases: ['GCSE and IGCSE', 'Sixth Form and IB Diploma'],
      },
      {
        id: 't-nour', fullName: 'Nour Al Hashimi', email: 'nour@eliteeducation.me', hourlyPay: 220, color: '#5E4660',
        subjects: ['Arabic', 'English', 'Primary (all subjects)'], curricula: ['British', 'UAE MoE', 'IB PYP', 'IB DP'], phases: ['Primary', 'Lower Secondary'],
      },
    ],
    families: [
      { id: 'f-mansoori', name: 'Al Mansoori', parentName: 'Fatima Al Mansoori', email: 'fatima@example.com', phone: '+971 50 000 0001' },
      { id: 'f-sharma', name: 'Sharma', parentName: 'Priya Sharma', email: 'priya@example.com', phone: '+971 50 000 0002' },
      { id: 'f-hughes', name: 'Hughes', parentName: 'Emma Hughes', email: 'emma@example.com', phone: '+971 50 000 0003' },
      // Tax: the Haddads' fees are paid by Rami's company, so its name, address and TRN appear on their tax invoices.
      {
        id: 'f-haddad', name: 'Haddad', parentName: 'Rami Haddad', email: 'rami@example.com', phone: '+971 50 000 0004',
        billingName: 'Haddad Trading LLC (demo)', billingAddress: 'PO Box 00000, Dubai, United Arab Emirates', trn: '100000000000012',
      },
    ],
    students: [
      { id: 's-omar', familyId: 'f-mansoori', fullName: 'Omar Al Mansoori', curriculum: 'IB', syllabusId: 'ib-aa-hl', phase: 'Sixth Form and IB Diploma', school: 'Dubai College', yearGroup: 'Year 12', currentGrade: '5', targetGrade: '7', examDate: '2027-05-04', notes: 'Strong algebra; rushes calculus. Prefers worked examples first.' },
      { id: 's-layla', familyId: 'f-mansoori', fullName: 'Layla Al Mansoori', curriculum: 'IGCSE', syllabusId: 'igcse-4ma1', phase: 'GCSE and IGCSE', school: 'Dubai College', yearGroup: 'Year 10', currentGrade: '7', targetGrade: '9' },
      { id: 's-arjun', familyId: 'f-sharma', fullName: 'Arjun Sharma', curriculum: 'A-Level', syllabusId: 'alevel-maths', phase: 'Sixth Form and IB Diploma', school: 'GEMS Wellington', yearGroup: 'Year 13', currentGrade: 'A', targetGrade: 'A*', examDate: '2027-06-03' },
      { id: 's-charlotte', familyId: 'f-hughes', fullName: 'Charlotte Hughes', curriculum: 'IB', syllabusId: 'ib-ai-sl', phase: 'Sixth Form and IB Diploma', school: 'Jumeirah English Speaking School', yearGroup: 'Year 12', currentGrade: '4', targetGrade: '6' },
      { id: 's-yasmin', familyId: 'f-haddad', fullName: 'Yasmin Haddad', curriculum: 'IGCSE', syllabusId: 'igcse-0580', phase: 'GCSE and IGCSE', school: 'Repton Dubai', yearGroup: 'Year 11', currentGrade: '6', targetGrade: '8' },
      { id: 's-karim', familyId: 'f-haddad', fullName: 'Karim Haddad', curriculum: 'IGCSE', syllabusId: 'igcse-0606', phase: 'GCSE and IGCSE', school: 'Repton Dubai', yearGroup: 'Year 11', currentGrade: 'B', targetGrade: 'A' },
      { id: 's-noor', familyId: 'f-haddad', fullName: 'Noor Haddad', phase: 'Primary', school: 'Repton Dubai', yearGroup: 'Year 4', notes: 'An avid reader. Responds well to short, varied activities.' },
    ],
    services: [
      { id: 'svc-ib', name: 'IB Diploma 1:1', durationMin: 60, rate: 450, phase: 'Sixth Form and IB Diploma' },
      { id: 'svc-igcse', name: 'IGCSE and GCSE 1:1', durationMin: 60, rate: 350, phase: 'GCSE and IGCSE' },
      { id: 'svc-alevel', name: 'A-Level 1:1', durationMin: 90, rate: 550, phase: 'Sixth Form and IB Diploma' },
      { id: 'svc-group', name: 'IGCSE Small Group', durationMin: 90, rate: 250, phase: 'GCSE and IGCSE' },
      { id: 'svc-primary', name: 'Primary 1:1', durationMin: 45, rate: 300, phase: 'Primary' },
    ],
    lessons: [],
    notes: [],
    homework: [],
    ratings: [],
    packages: [],
    charges: [],
    invoices: [],
    availability: [],
    closures: [],
    absences: [],
    enquiries: [],
    requests: [],
    messages: [],
    reads: {},
    announcements: [],
    opportunities: [],
    bids: [],
    applications: [],
    paymentDetails: [],
    tutorInvoices: [],
    reportCycles: [],
    reports: [],
    expenses: [],
    enrolments: [],
    topicLists: [],
    topics: [],
    outbox: [],
    submissions: [],
    resources: [],
  };

  // Subjects: each student's Maths enrolment from their legacy syllabus, plus their other subjects.
  const shared = seedTopics(addDays(now, -120).toISOString());
  db.topicLists = shared.lists;
  db.topics = shared.topics;
  const enrolment = (id: string, studentId: string, e: Omit<Enrolment, 'id' | 'studentId' | 'active'>): Enrolment => ({
    id, studentId, active: true, createdAt: addDays(now, -120).toISOString(), ...e,
  });
  const maths = (studentId: string, tutorId: string): Enrolment => {
    const st = db.students.find((x) => x.id === studentId)!;
    const syl = SYLLABUSES.find((x) => x.id === st.syllabusId)!;
    return enrolment(`enr-${studentId.slice(2)}-maths`, studentId, {
      subject: syl.subject ?? 'Maths', curriculum: syl.curriculum, level: syl.level, examBoard: syl.examBoard, syllabusId: syl.id, tutorId,
    });
  };
  db.enrolments = [
    maths('s-omar', 't-craig'),
    enrolment('enr-omar-arabic', 's-omar', { subject: 'Arabic', curriculum: 'IB DP', level: 'HL', tutorId: 't-nour', topicListId: 'tl-ibdp-arabic-hl' }),
    maths('s-layla', 't-sarah'),
    enrolment('enr-layla-chemistry', 's-layla', { subject: 'Chemistry', curriculum: 'IGCSE', examBoard: 'Cambridge', tutorId: 't-sarah', topicListId: 'tl-igcse-chemistry' }),
    maths('s-arjun', 't-craig'),
    maths('s-charlotte', 't-james'),
    maths('s-yasmin', 't-sarah'),
    enrolment('enr-yasmin-english-literature', 's-yasmin', {
      subject: 'English Literature', curriculum: 'IGCSE', examBoard: 'Cambridge', tutorId: 't-sarah', topicListId: 'tl-igcse-english-literature',
    }),
    maths('s-karim', 't-sarah'),
    enrolment('enr-noor-english', 's-noor', { subject: 'English', curriculum: 'British', tutorId: 't-nour', topicListId: 'tl-british-english' }),
    // No list yet: tutors add the first topics from the lesson screen.
    enrolment('enr-noor-maths', 's-noor', { subject: 'Maths', curriculum: 'British', tutorId: 't-nour' }),
  ];
  const lookup = buildTopicLookup(SYLLABUSES, db.topicLists, db.topics);

  const profiles: Profile[] = [
    { id: 'u-admin', role: 'admin', fullName: "Craig O'Brien", email: 'craig@eliteeducation.me', tutorId: 't-craig' },
    { id: 'u-tutor', role: 'tutor', fullName: 'Sarah Khan', email: 'sarah@eliteeducation.me', tutorId: 't-sarah' },
    { id: 'u-parent', role: 'parent', fullName: 'Fatima Al Mansoori', email: 'fatima@example.com', familyId: 'f-mansoori' },
    { id: 'u-student', role: 'student', fullName: 'Omar Al Mansoori', email: 'omar@example.com', studentId: 's-omar' },
    // Tax: the accountant reads the books only.
    { id: 'u-accountant', role: 'accountant', fullName: 'Amira Haddad', email: 'accounts@example.com' },
  ];
  db.profiles = profiles;

  // Arjun's family pre-pays with a 10-lesson package.
  const packageStart = addDays(now, -40);
  db.packages.push({
    id: 'pkg-sharma',
    familyId: 'f-sharma',
    name: 'A-Level 10-lesson bundle',
    serviceId: 'svc-alevel',
    lessonsTotal: 10,
    lessonsUsed: 0,
    price: 5000,
    purchasedAt: toDateKey(packageStart),
  });

  const series: SeriesSpec[] = [
    { key: 'omar', tutorId: 't-craig', studentIds: ['s-omar'], serviceId: 'svc-ib', weekday: 'today', hour: 18, location: 'online', subject: 'Maths' },
    { key: 'charlotte', tutorId: 't-james', studentIds: ['s-charlotte'], serviceId: 'svc-ib', weekday: 'today', hour: 16, location: 'online', subject: 'Maths' },
    { key: 'layla', tutorId: 't-sarah', studentIds: ['s-layla'], serviceId: 'svc-igcse', weekday: 1, hour: 17, location: 'in-person', subject: 'Maths' },
    { key: 'arjun', tutorId: 't-craig', studentIds: ['s-arjun'], serviceId: 'svc-alevel', weekday: 2, hour: 17, minute: 30, location: 'online', subject: 'Maths' },
    { key: 'haddad', tutorId: 't-sarah', studentIds: ['s-yasmin', 's-karim'], serviceId: 'svc-group', weekday: 5, hour: 10, location: 'in-person', subject: 'Maths' },
    { key: 'layla-chem', tutorId: 't-sarah', studentIds: ['s-layla'], serviceId: 'svc-igcse', weekday: 3, hour: 16, location: 'in-person', subject: 'Chemistry' },
    { key: 'yasmin-lit', tutorId: 't-sarah', studentIds: ['s-yasmin'], serviceId: 'svc-igcse', weekday: 4, hour: 15, location: 'online', subject: 'English Literature' },
    { key: 'omar-arabic', tutorId: 't-nour', studentIds: ['s-omar'], serviceId: 'svc-ib', weekday: 0, hour: 16, location: 'online', subject: 'Arabic' },
    { key: 'noor-english', tutorId: 't-nour', studentIds: ['s-noor'], serviceId: 'svc-primary', weekday: 0, hour: 14, minute: 30, location: 'in-person', subject: 'English' },
    { key: 'noor-maths', tutorId: 't-nour', studentIds: ['s-noor'], serviceId: 'svc-primary', weekday: 2, hour: 14, minute: 30, location: 'in-person', subject: 'Maths' },
  ];

  const weekStart = startOfWeek(now);
  const todayOffset = (now.getDay() + 6) % 7;
  const WEEKS_BACK = 6;
  const WEEKS_AHEAD = 6;

  for (const spec of series) {
    const service = db.services.find((s) => s.id === spec.serviceId)!;
    const weekday = spec.weekday === 'today' ? todayOffset : spec.weekday;
    for (let w = -WEEKS_BACK; w < WEEKS_AHEAD; w++) {
      const start = addDays(weekStart, w * 7 + weekday);
      start.setHours(spec.hour, spec.minute ?? 0, 0, 0);
      const lesson: Lesson = {
        id: `les-${spec.key}-${w + WEEKS_BACK}`,
        tutorId: spec.tutorId,
        studentIds: spec.studentIds,
        serviceId: spec.serviceId,
        subject: spec.subject,
        start: start.toISOString(),
        end: addMinutes(start, service.durationMin).toISOString(),
        location: spec.location,
        meetingUrl: spec.location === 'online' ? 'https://meet.google.com/elite-demo' : undefined,
        address: spec.location === 'in-person' ? 'Elite Education Centre, Al Barsha' : undefined,
        status: 'scheduled',
        seriesId: `series-${spec.key}`,
      };
      db.lessons.push(lesson);
    }
  }
  // Layla's Chemistry lesson that began about two hours ago and is waiting to be recorded. Anything of Sarah's or
  // Layla's that would overlap it is dropped from the series.
  const chemStart = new Date(now.getTime() - 2 * 3_600_000);
  chemStart.setMinutes(Math.floor(chemStart.getMinutes() / 15) * 15, 0, 0);
  const chemEnd = addMinutes(chemStart, 60);
  const chemNow: Lesson = {
    id: 'les-layla-chem-now',
    tutorId: 't-sarah',
    studentIds: ['s-layla'],
    serviceId: 'svc-igcse',
    subject: 'Chemistry',
    start: chemStart.toISOString(),
    end: chemEnd.toISOString(),
    location: 'in-person',
    address: 'Elite Education Centre, Al Barsha',
    status: 'scheduled',
  };
  db.lessons = db.lessons.filter(
    (l) =>
      !((l.tutorId === 't-sarah' || l.studentIds.includes('s-layla')) && new Date(l.start) < chemEnd && new Date(l.end) > chemStart),
  );
  db.lessons.sort((a, b) => a.start.localeCompare(b.start));

  // Record past lessons (anything that ended before today) as taught, with notes, ratings and homework.
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const topicCursor = new Map<string, number>();
  // Leave Craig's most recent past lesson unrecorded so "needs notes" has something to show.
  const awaitingNotes = db.lessons.filter((l) => l.tutorId === 't-craig' && new Date(l.end) < todayStart).at(-1)?.id;
  for (const lesson of db.lessons) {
    if (new Date(lesson.end) >= todayStart || lesson.id === awaitingNotes) continue;
    const r = random();
    if (lesson.id === 'les-charlotte-3') {
      lesson.status = 'late-cancel';
      lesson.cancelReason = 'Unwell on the day';
      lesson.cancelledAt = addMinutes(new Date(lesson.start), -180).toISOString();
      applyCharges(db, lesson);
      continue;
    }
    if (lesson.id === 'les-charlotte-4') {
      lesson.status = 'no-show';
      applyCharges(db, lesson);
      continue;
    }
    if (lesson.id === 'les-layla-2' || lesson.id === 'les-haddad-1') {
      lesson.status = 'cancelled';
      lesson.cancelReason = 'School trip';
      lesson.cancelledAt = addDays(new Date(lesson.start), -3).toISOString();
      continue;
    }
    lesson.status = 'completed';
    const attendance: Record<string, 'present' | 'late' | 'absent'> = {};
    const topicIds: string[] = [];
    for (const studentId of lesson.studentIds) {
      attendance[studentId] = r > 0.93 ? 'late' : 'present';
      // The enrolment this lesson counts for: its subject, or the student's only subject (Karim in the group).
      const active = activeEnrolments(db.enrolments, studentId);
      const enr = enrolmentFor(db.enrolments, studentId, lesson.subject) ?? (active.length === 1 ? active[0] : undefined);
      const all = enr ? lookup.treeFor(enr).units.flatMap((u) => u.topics) : [];
      const cursor = topicCursor.get(`${studentId}|${enr?.id}`) ?? Math.floor(random() * 4);
      topicCursor.set(`${studentId}|${enr?.id}`, cursor + 5);
      const due = addDays(new Date(lesson.start), 6);
      if (!all.length) {
        db.homework.push({
          id: `hw-${lesson.id}-${studentId}`, studentId, lessonId: lesson.id, title: 'Ten minutes of times-tables practice each day',
          dueDate: toDateKey(due), done: due < addDays(now, -2) || random() > 0.6,
        });
        continue;
      }
      // Step through the topic tree so ratings spread across every unit.
      const picked = [all[cursor % all.length], all[(cursor + 1) % all.length]];
      for (const topic of picked) {
        if (!topicIds.includes(topic.id)) topicIds.push(topic.id);
        const base = studentId === 's-charlotte' ? 2 : studentId === 's-omar' ? 3 : 3.5;
        const rating = Math.max(1, Math.min(5, Math.round(base + random() * 2 - 0.5))) as TopicRating['rating'];
        if (db.ratings.some((x) => x.id === `rat-${lesson.id}-${topic.id}-${studentId}`)) continue;
        db.ratings.push({ id: `rat-${lesson.id}-${topic.id}-${studentId}`, studentId, topicId: topic.id, lessonId: lesson.id, rating, ratedAt: lesson.start });
      }
      db.homework.push({
        id: `hw-${lesson.id}-${studentId}`,
        studentId,
        lessonId: lesson.id,
        title: `Practice questions: ${picked[0].name}`,
        dueDate: toDateKey(due),
        done: due < addDays(now, -2) || random() > 0.6,
      });
    }
    const t1 = topicIds[0];
    const t2 = topicIds[1] ?? topicIds[0];
    db.notes.push({
      lessonId: lesson.id,
      summary: t1
        ? SUMMARIES[Math.floor(r * SUMMARIES.length)].replace('{t1}', lookup.name(t1)).replace('{t2}', lookup.name(t2))
        : OPEN_SUMMARIES[Math.floor(r * OPEN_SUMMARIES.length)],
      privateNote: r > 0.7 ? 'The parent asked about additional sessions before the mock examinations.' : undefined,
      topicIds,
      attendance,
      createdAt: lesson.end,
    });
    applyCharges(db, lesson, attendance);
  }

  // Added after the history is recorded, so it stays waiting for its notes.
  db.lessons.push(chemNow);
  db.lessons.sort((a, b) => a.start.localeCompare(b.start));

  // Charlotte is drifting: two missed lessons and most homework not done, so she shows up as "worth a conversation".
  db.homework.filter((h) => h.studentId === 's-charlotte').forEach((h, i) => (h.done = i % 3 === 0));

  // Bill everything up to a fortnight ago; recent lessons stay "ready to invoice" for the admin.
  const issued = addDays(todayStart, -14);
  for (const family of db.families) {
    const charges = db.charges.filter((c) => c.familyId === family.id && c.status === 'unbilled' && c.date < issued.toISOString());
    if (charges.length === 0) continue;
    const invoice: Invoice = {
      ...newInvoiceDraft(family.id, itemsFromCharges(charges), db.settings, issued),
      id: `inv-${family.id}`,
      status: 'sent',
    };
    stampTaxDetails(db, invoice);
    db.settings.nextInvoiceNumber += 1;
    if (family.id !== 'f-hughes') {
      const { total } = invoiceTotals(invoice);
      invoice.payments.push({ id: `pay-${family.id}`, invoiceId: invoice.id, amount: total, method: 'bank-transfer', paidAt: addDays(issued, 2).toISOString(), reference: 'Bank transfer' });
      invoice.status = 'paid';
    }
    // The Hughes invoice is left unpaid (and now overdue) so there is something to chase.
    db.invoices.push(invoice);
    for (const c of charges) {
      c.status = 'invoiced';
      c.invoiceId = invoice.id;
    }
  }

  // The package itself was invoiced and paid up front.
  const pkg = db.packages[0];
  db.invoices.push({
    id: 'inv-pkg-sharma',
    number: formatInvoiceNumber(db.settings.nextInvoiceNumber),
    familyId: 'f-sharma',
    issueDate: pkg.purchasedAt,
    dueDate: pkg.purchasedAt,
    status: 'paid',
    items: [{ description: `${pkg.name} (${pkg.lessonsTotal} lessons)`, quantity: 1, unitPrice: pkg.price, packageId: pkg.id }],
    vatRate: db.settings.vatRate,
    payments: [],
  });
  const pkgInvoice = db.invoices[db.invoices.length - 1];
  stampTaxDetails(db, pkgInvoice);
  // Paid by card through Stripe, so it can be refunded to the card.
  pkgInvoice.payments.push({
    id: 'pay-pkg', invoiceId: 'inv-pkg-sharma', amount: invoiceTotals(pkgInvoice).total, method: 'card', paidAt: packageStart.toISOString(), viaStripe: true,
  });
  db.settings.nextInvoiceNumber += 1;

  seedEngagement(db, now);
  seedOperations(db, now);
  seedClasswork(db, now);
  seedCalendar(db, now);
  seedPayments(db);
  seedTax(db, now);
  return db;
}

/**
 * Tax: a partial credit note with a bank-transfer refund on a paid lesson invoice, a partial card refund with a credit
 * note on the package invoice, and the accountant's accepted invitation. The Hughes invoice stays unpaid and uncredited.
 */
function seedTax(db: DemoDB, now: Date) {
  const admin = db.profiles.find((p) => p.role === 'admin')!;
  const lessons = db.invoices.find((i) => i.id === 'inv-f-mansoori' && i.status === 'paid' && i.items.length > 0);
  if (lessons) {
    const line = lessons.items[0];
    const gross = round2(round2(line.quantity * line.unitPrice) * (1 + lessons.vatRate));
    tax.refundPayment(
      db,
      admin,
      {
        paymentId: `pay-${lessons.familyId}`,
        amount: gross,
        reason: 'Lesson cancelled by Elite Education. One lesson refunded.',
        reference: 'FT-DEMO-0001',
        withCreditNote: true,
        requestKey: 'seed-refund-mansoori',
      },
      addDays(now, -5),
    );
  }
  if (db.invoices.some((i) => i.id === 'inv-pkg-sharma')) {
    tax.refundPayment(
      db,
      admin,
      {
        paymentId: 'pay-pkg',
        amount: 1050,
        reason: 'Two lessons of the package were no longer needed. Partial refund.',
        withCreditNote: true,
        requestKey: 'seed-refund-sharma',
      },
      addDays(now, -3),
    );
  }
  db.accountantInvites = [
    { email: 'accounts@example.com', fullName: 'Amira Haddad', invitedAt: addDays(now, -20).toISOString(), acceptedAt: addDays(now, -19).toISOString() },
  ];
}

// Google Calendar
/**
 * Sarah has connected Google Calendar and has busy times; Craig (the admin) has not, so connecting can be tried.
 * Craig has no busy times until he connects, as in production, where only a connected calendar supplies them.
 */
function seedCalendar(db: DemoDB, now: Date) {
  db.calendarConnections = [
    {
      profileId: 'u-tutor',
      provider: 'google',
      googleEmail: 'sarah.khan@gmail.com',
      calendarId: 'primary',
      status: 'connected',
      lastSyncedAt: new Date(now.getTime() - 4 * 60_000).toISOString(),
    },
  ];
  db.busyBlocks = sampleBusyBlocks(db, 't-sarah', now, 2, 'busy-');
  // Craig's upcoming A-level lessons with Arjun have no video link yet: connecting his calendar adds Google Meet links.
  for (const l of db.lessons) {
    if (l.seriesId === 'series-arjun' && l.status === 'scheduled' && new Date(l.start) > now) l.meetingUrl = undefined;
  }
}

/** Card payments: Fatima has a card on file (autopay off), and parents can top up from a few lesson packages. */
function seedPayments(db: DemoDB) {
  const mansoori = db.families.find((f) => f.id === 'f-mansoori');
  if (mansoori) {
    mansoori.savedCard = { brand: 'Visa', last4: '4242', expires: '08/29' };
    mansoori.autopay = false;
  }
  db.packageOffers = [
    { id: 'offer-ib-10', name: 'IB Maths: ten lessons', serviceId: 'svc-ib', lessons: 10, price: 4050, active: true, sort: 1 },
    { id: 'offer-igcse-10', name: 'IGCSE Maths: ten lessons', serviceId: 'svc-igcse', lessons: 10, price: 3150, active: true, sort: 2 },
    { id: 'offer-igcse-20', name: 'IGCSE Maths: twenty lessons', serviceId: 'svc-igcse', lessons: 20, price: 5950, active: true, sort: 3 },
    { id: 'offer-any-5', name: 'Any lesson: five lessons', lessons: 5, price: 2000, active: false, sort: 4 },
  ];
}

/** Roles with bids, applications, bank details, tutor invoices, a report round and expenses. */
function seedOperations(db: DemoDB, now: Date) {
  const admin = db.profiles.find((p) => p.role === 'admin')!;
  const as = (tutorId: string): Profile => ({ ...admin, role: 'tutor', tutorId });
  const iso = (d: Date) => d.toISOString();
  const daysAgo = (n: number) => addDays(now, -n);

  // Roles tutors can express interest in.
  const sophie = ops.saveOpportunity(db, admin, {
    title: 'Year 12 A-Level Maths — Hugo',
    description: 'Referred by an existing family. Hugo is predicted an A and wants an A*. Pure and Statistics focus.',
    curriculum: 'A-Level', syllabusId: 'alevel-maths', subject: 'Maths', phase: 'Sixth Form and IB Diploma', enquiryId: 'enq-3',
    schedule: 'Tuesdays 5–6:30pm, from next week',
    location: 'Online', payRate: 260, closesOn: toDateKey(addDays(now, 4)), visibility: 'all', invitedTutorIds: [],
  }, daysAgo(2));
  ops.placeBid(db, as('t-james'), sophie.id, 'I have taught A-Level Pure Mathematics and Statistics for six years, and four of last year’s students achieved an A*. I am available on Tuesday evenings.', 'Tuesdays after 4pm', daysAgo(1));
  ops.placeBid(db, as('t-sarah'), sophie.id, 'I would be delighted to teach Hugo. I have been building my A-Level hours and have particular strength in Statistics.', 'Tuesday and Thursday evenings', daysAgo(1));

  ops.saveOpportunity(db, admin, {
    title: 'IGCSE Physics — Year 10',
    description: 'Weekly lessons for a conscientious Year 10 student who would like to strengthen electricity and forces ahead of the mock examinations.',
    curriculum: 'IGCSE', subject: 'Physics', phase: 'GCSE and IGCSE', enquiryId: 'enq-5', schedule: 'Wednesdays after school',
    location: 'Online', payRate: 220, closesOn: toDateKey(addDays(now, 7)), visibility: 'all', invitedTutorIds: [],
  }, daysAgo(1));

  const filled = ops.saveOpportunity(db, admin, {
    title: 'IGCSE small group — Haddad twins',
    curriculum: 'IGCSE', subject: 'Maths', phase: 'GCSE and IGCSE', schedule: 'Saturdays 10–11:30am', location: 'Al Barsha centre', payRate: 200, visibility: 'all', invitedTutorIds: [],
  }, daysAgo(40));
  ops.placeBid(db, as('t-sarah'), filled.id, 'I very much enjoy group teaching and am at the centre on Saturdays.', 'Saturday mornings', daysAgo(39));
  ops.awardOpportunity(db, admin, db.bids.find((b) => b.opportunityId === filled.id)!.id, daysAgo(38));

  // Applications to join.
  db.applications.push(
    { id: 'app-1', createdAt: iso(daysAgo(1)), fullName: 'Hannah Clarke', email: 'hannah@example.com', phone: '+971 52 000 0011', curricula: ['IB DP', 'A-Level'], subjects: 'Chemistry, Biology', phases: ['Sixth Form and IB Diploma'], experience: 'Head of Science at a British international school for nine years, and an IB Chemistry examiner.', qualifications: 'MSc Chemistry, PGCE', availability: 'Weekday evenings, Saturdays', status: 'applied' },
    { id: 'app-2', createdAt: iso(daysAgo(6)), fullName: 'Ravi Menon', email: 'ravi@example.com', curricula: ['IGCSE'], subjects: 'Maths, Additional Maths', phases: ['GCSE and IGCSE'], experience: 'Three years of private tutoring; engineering graduate.', qualifications: 'BEng', availability: 'After 5pm', status: 'interview', notes: 'Strong on 0606. Interview on Thursday at 4pm.' },
    { id: 'app-3', createdAt: iso(daysAgo(20)), fullName: 'Lucy Grant', email: 'lucy@example.com', curricula: ['IGCSE', 'IB MYP'], subjects: 'English Literature', phases: ['Lower Secondary', 'GCSE and IGCSE'], experience: 'Newly qualified teacher of English.', availability: 'Weekends only', status: 'rejected', notes: 'Not enough availability at present; to be revisited in the spring.' },
  );

  // Bank details (Sarah has filled hers in; James hasn't yet).
  ops.savePaymentDetails(db, as('t-sarah'), { tutorId: 't-sarah', accountName: 'Sarah Khan', bankName: 'Emirates NBD', iban: 'AE070331234567890123456', swift: 'EBILAEAD' });
  ops.savePaymentDetails(db, admin, { tutorId: 't-craig', accountName: "Craig O'Brien", bankName: 'Mashreq', iban: 'GB82WEST12345698765432' });

  // Last month's tutor invoices: James paid, Sarah waiting for approval. Two months ago everyone paid.
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonths = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const plan: [string, Date, string[]][] = [
    ['t-sarah', twoMonths, ['submit', 'approve', 'pay']],
    ['t-james', twoMonths, ['submit', 'approve', 'pay']],
    ['t-james', lastMonth, ['submit', 'approve', 'pay']],
    ['t-sarah', lastMonth, ['submit']],
  ];
  for (const [tutorId, month, steps] of plan) {
    const id = ops.createTutorInvoice(db, as(tutorId), tutorId, toDateKey(month), month);
    if (tutorId === 't-sarah' && month === lastMonth) {
      ops.updateTutorInvoice(db, as(tutorId), id, [{ description: 'Mock exam marking (Layla)', quantity: 2, unitPrice: 150 }], 'Includes marking Layla’s mock paper.');
    }
    if (steps.includes('submit')) ops.submitTutorInvoice(db, as(tutorId), id, addDays(month, 32));
    if (steps.includes('approve')) ops.reviewTutorInvoice(db, admin, id, true, undefined, addDays(month, 33));
    if (steps.includes('pay')) ops.markTutorInvoicePaid(db, admin, id, `FT${toDateKey(month).replace(/-/g, '').slice(2, 6)}${tutorId.slice(2, 5).toUpperCase()}`, addDays(month, 35));
  }

  // A report round in progress: some written, one waiting for approval.
  ops.openReportCycle(db, admin, 'Autumn half-term 2026', toDateKey(daysAgo(45)), toDateKey(addDays(now, 10)), daysAgo(3));
  const layla = db.reports.find((r) => r.studentId === 's-layla' && r.subject === 'Maths')!;
  ops.saveReport(db, admin, layla.id, {
    attainment: '7', effort: 5, progress: 4,
    strengths: 'Layla is now confident with algebraic manipulation and simultaneous equations, and her written working is clear and well organised.',
    nextSteps: 'Focus next on circle theorems and vectors, with timed past-paper practice to build exam speed.',
    comment: 'Layla has worked hard all half-term and her homework has been excellent. She asks thoughtful questions and is on track for her target grade.',
    aiAssisted: true,
  });
  ops.submitReport(db, admin, layla.id, daysAgo(1));

  // Expenses for the months the demo has lessons in.
  const months = [0, 1].map((n) => new Date(now.getFullYear(), now.getMonth() - n, 1));
  for (const m of months) {
    db.expenses.push({ id: `exp-rent-${toDateKey(m)}`, date: toDateKey(m), category: 'Rent', description: 'Al Barsha centre room', amount: 2500, vatAmount: 125 });
    db.expenses.push({ id: `exp-sw-${toDateKey(m)}`, date: toDateKey(addDays(m, 4)), category: 'Software', description: 'Zoom, Google Workspace', amount: 180, vatAmount: 0 });
  }
  db.expenses.push({ id: 'exp-ads', date: toDateKey(daysAgo(10)), category: 'Marketing', description: 'Instagram ads — mock exam season', amount: 600, vatAmount: 0 });
}

/** Availability, holidays, enquiries, a pending request, messages and an announcement. */
function seedEngagement(db: DemoDB, now: Date) {
  const iso = (d: Date) => d.toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  // Weekday afternoons/evenings, Saturday mornings.
  const blocks: [string, number[], string, string][] = [
    ['t-craig', [0, 1, 2, 3, 4], '15:00', '20:00'],
    ['t-sarah', [0, 1, 3, 4], '14:00', '19:00'],
    ['t-sarah', [5], '09:00', '13:00'],
    ['t-james', [0, 2, 3, 4], '15:00', '19:00'],
    ['t-nour', [0, 1, 2, 3], '14:00', '19:00'],
  ];
  for (const [tutorId, days, start, end] of blocks) {
    for (const weekday of days) db.availability.push({ id: `av-${tutorId}-${weekday}-${start}`, tutorId, weekday, start, end });
  }

  // A long weekend about three weeks out, and the winter break.
  const holiday = addDays(startOfWeek(now), 21 + 3);
  db.closures.push(
    { id: 'clo-1', name: 'National Day long weekend', startDate: toDateKey(holiday), endDate: toDateKey(addDays(holiday, 3)) },
    { id: 'clo-2', name: 'Winter break', startDate: `${now.getFullYear()}-12-20`, endDate: `${now.getFullYear() + 1}-01-04` },
  );
  db.absences.push({ id: 'abs-1', tutorId: 't-james', startDate: toDateKey(addDays(now, 7)), endDate: toDateKey(addDays(now, 8)), reason: 'Conference' });

  // A prospect who signed up in the app, plus enquiries at different stages.
  db.families.push({ id: 'f-rahman', name: 'Rahman', parentName: 'Rita Rahman', email: 'rita@example.com', phone: '+971 50 000 0005', status: 'prospect', createdAt: iso(hoursAgo(5)) });
  db.enquiries.push(
    { id: 'enq-1', createdAt: iso(hoursAgo(5)), status: 'new', source: 'app', parentName: 'Rita Rahman', email: 'rita@example.com', phone: '+971 50 000 0005', studentName: 'Zara', curriculum: 'IGCSE', subject: 'English Language', phase: 'GCSE and IGCSE', yearGroup: 'Year 10', message: 'Zara is predicted a 6 and is aiming for an 8. She would like support with essay structure and timed writing.', preferredTimes: 'Weekday evenings', familyId: 'f-rahman' },
    { id: 'enq-2', createdAt: iso(hoursAgo(30)), status: 'new', source: 'website', parentName: 'Daniel Okafor', email: 'daniel@example.com', studentName: 'Ada', curriculum: 'IB DP', subject: 'Maths', phase: 'Sixth Form and IB Diploma', yearGroup: 'Year 13', message: 'Ada would welcome guidance on her Mathematics Internal Assessment, which is due in November.', preferredTimes: 'Weekends' },
    { id: 'enq-3', createdAt: iso(hoursAgo(72)), status: 'contacted', source: 'referral', parentName: 'Sophie Laurent', phone: '+971 55 000 0007', studentName: 'Hugo', curriculum: 'A-Level', subject: 'Maths', phase: 'Sixth Form and IB Diploma', yearGroup: 'Year 12', message: 'Referred by the Sharma family.', nextActionAt: toDateKey(addDays(now, 1)), notes: 'Spoke by telephone; Tuesday evenings preferred. Send consultation options.' },
    { id: 'enq-4', createdAt: iso(hoursAgo(24 * 9)), status: 'enrolled', source: 'website', parentName: 'Rami Haddad', email: 'rami@example.com', studentName: 'Yasmin and Karim', curriculum: 'IGCSE', subject: 'Maths', phase: 'GCSE and IGCSE', familyId: 'f-haddad' },
    { id: 'enq-5', createdAt: iso(hoursAgo(24 * 14)), status: 'lost', source: 'phone', parentName: 'Mark Evans', phone: '+971 50 000 0009', studentName: 'Lily', curriculum: 'IGCSE', subject: 'Physics', phase: 'GCSE and IGCSE', yearGroup: 'Year 10', lostReason: 'Chose a school-based tutor' },
  );

  // Fatima wants an extra lesson for Omar before his mocks.
  const omarNext = db.lessons.find((l) => l.studentIds.includes('s-omar') && l.status === 'scheduled' && new Date(l.start) > addDays(now, 2));
  if (omarNext) {
    const start = new Date(omarNext.start);
    start.setDate(start.getDate() + 1);
    start.setHours(17, 0, 0, 0);
    db.requests.push({
      id: 'req-1', createdAt: iso(hoursAgo(3)), familyId: 'f-mansoori', studentId: 's-omar', kind: 'new-lesson', tutorId: 't-craig',
      serviceId: 'svc-ib', start: iso(start), end: iso(new Date(start.getTime() + 3_600_000)), subject: 'Maths', note: 'An additional session before his mock examinations, if possible.', status: 'pending',
    });
  }

  // A family conversation and an announcement.
  const msgs: [number, string, string, Message['senderRole'], string][] = [
    [50, 'u-parent', 'Fatima Al Mansoori', 'parent', 'Dear Craig, Omar has his mock examinations in three weeks. Could we focus on calculus until then?'],
    [49, 'u-admin', "Craig O'Brien", 'admin', 'Certainly. I will plan the next few sessions around differentiation and integration, with timed past-paper questions.'],
    [2, 'u-parent', 'Fatima Al Mansoori', 'parent', 'Thank you. I have also requested an additional lesson, should there be availability.'],
  ];
  for (const [h, senderId, senderName, senderRole, body] of msgs) {
    db.messages.push({ id: `msg-${h}`, familyId: 'f-mansoori', senderId, senderName, senderRole, body, createdAt: iso(hoursAgo(h)) });
  }
  db.reads['u-parent'] = { 'f-mansoori': iso(hoursAgo(2)) };
  db.messages.push({ id: 'msg-h1', familyId: 'f-haddad', senderId: 'u-tutor', senderName: 'Sarah Khan', senderRole: 'tutor', body: 'A productive group session today. Yasmin and Karim are now both confident with simultaneous equations.', createdAt: iso(hoursAgo(20)) });
  db.announcements.push({
    id: 'ann-1', createdAt: iso(hoursAgo(26)), authorName: "Craig O'Brien", audience: 'everyone',
    title: 'Mock examination season', body: 'Mock examinations begin shortly at most schools. Please ask your tutor for a personalised revision plan; additional sessions may be requested in the app.',
  });
}
