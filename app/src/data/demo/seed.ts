import { getSyllabus, topicName } from '@/data/curriculum';
import { formatInvoiceNumber, itemsFromCharges, newInvoiceDraft } from '@/domain/billing';
import { addDays, addMinutes, startOfWeek, toDateKey } from '@/domain/dates';
import type { Invoice, Lesson, Message, Profile, Settings, TopicRating } from '@/domain/types';

import { seedClasswork } from './classwork';
import { sampleBusyBlocks } from './calendar';
import { applyCharges, DEMO_DB_VERSION, type DemoDB } from './db';
import { ops } from './operations';

const SUMMARIES = [
  'Worked through {t1} from first principles, then exam-style questions on {t2}. Good engagement — method is much more secure.',
  'Reviewed last week’s homework, then focused on {t1}. Some slips with notation on {t2}; we built a checklist to avoid them.',
  'Past-paper session targeting {t1} and {t2}. Timing is improving; needs to show more working for method marks.',
  'Consolidated {t1} and started {t2}. Confident on routine questions, still building towards the harder problem-solving parts.',
];

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
}

export function createSeed(now: Date = new Date()): DemoDB {
  const random = rng(42);
  const settings: Settings = {
    businessName: 'Elite Education',
    currency: 'AED',
    vatRate: 0,
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
  };

  const db: DemoDB = {
    version: DEMO_DB_VERSION,
    settings,
    profiles: [],
    // Tutor colours come from TUTOR_COLORS in src/lib/tutor-colors.ts (slate, bronze, forest).
    tutors: [
      { id: 't-craig', fullName: "Craig O'Brien", email: 'craig@eliteeducation.me', hourlyPay: 300, subjects: ['IB', 'A-Level', 'IGCSE'], color: '#3F4A56' },
      { id: 't-sarah', fullName: 'Sarah Khan', email: 'sarah@eliteeducation.me', hourlyPay: 200, subjects: ['IGCSE'], color: '#7A5C1E' },
      { id: 't-james', fullName: 'James Wilson', email: 'james@eliteeducation.me', hourlyPay: 220, subjects: ['IB', 'IGCSE'], color: '#3D6B4F' },
    ],
    families: [
      { id: 'f-mansoori', name: 'Al Mansoori', parentName: 'Fatima Al Mansoori', email: 'fatima@example.com', phone: '+971 50 000 0001' },
      { id: 'f-sharma', name: 'Sharma', parentName: 'Priya Sharma', email: 'priya@example.com', phone: '+971 50 000 0002' },
      { id: 'f-hughes', name: 'Hughes', parentName: 'Emma Hughes', email: 'emma@example.com', phone: '+971 50 000 0003' },
      { id: 'f-haddad', name: 'Haddad', parentName: 'Rami Haddad', email: 'rami@example.com', phone: '+971 50 000 0004' },
    ],
    students: [
      { id: 's-omar', familyId: 'f-mansoori', fullName: 'Omar Al Mansoori', curriculum: 'IB', syllabusId: 'ib-aa-hl', school: 'Dubai College', yearGroup: 'Year 12', currentGrade: '5', targetGrade: '7', examDate: '2027-05-04', notes: 'Strong algebra; rushes calculus. Prefers worked examples first.' },
      { id: 's-layla', familyId: 'f-mansoori', fullName: 'Layla Al Mansoori', curriculum: 'IGCSE', syllabusId: 'igcse-4ma1', school: 'Dubai College', yearGroup: 'Year 10', currentGrade: '7', targetGrade: '9' },
      { id: 's-arjun', familyId: 'f-sharma', fullName: 'Arjun Sharma', curriculum: 'A-Level', syllabusId: 'alevel-maths', school: 'GEMS Wellington', yearGroup: 'Year 13', currentGrade: 'A', targetGrade: 'A*', examDate: '2027-06-03' },
      { id: 's-charlotte', familyId: 'f-hughes', fullName: 'Charlotte Hughes', curriculum: 'IB', syllabusId: 'ib-ai-sl', school: 'Jumeirah English Speaking School', yearGroup: 'Year 12', currentGrade: '4', targetGrade: '6' },
      { id: 's-yasmin', familyId: 'f-haddad', fullName: 'Yasmin Haddad', curriculum: 'IGCSE', syllabusId: 'igcse-0580', school: 'Repton Dubai', yearGroup: 'Year 11', currentGrade: '6', targetGrade: '8' },
      { id: 's-karim', familyId: 'f-haddad', fullName: 'Karim Haddad', curriculum: 'IGCSE', syllabusId: 'igcse-0606', school: 'Repton Dubai', yearGroup: 'Year 11', currentGrade: 'B', targetGrade: 'A' },
    ],
    services: [
      { id: 'svc-ib', name: 'IB Maths 1:1', durationMin: 60, rate: 450 },
      { id: 'svc-igcse', name: 'IGCSE Maths 1:1', durationMin: 60, rate: 350 },
      { id: 'svc-alevel', name: 'A-Level Maths 1:1', durationMin: 90, rate: 550 },
      { id: 'svc-group', name: 'IGCSE Small Group', durationMin: 90, rate: 250 },
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
    submissions: [],
    resources: [],
  };

  const profiles: Profile[] = [
    { id: 'u-admin', role: 'admin', fullName: "Craig O'Brien", email: 'craig@eliteeducation.me', tutorId: 't-craig' },
    { id: 'u-tutor', role: 'tutor', fullName: 'Sarah Khan', email: 'sarah@eliteeducation.me', tutorId: 't-sarah' },
    { id: 'u-parent', role: 'parent', fullName: 'Fatima Al Mansoori', email: 'fatima@example.com', familyId: 'f-mansoori' },
    { id: 'u-student', role: 'student', fullName: 'Omar Al Mansoori', email: 'omar@example.com', studentId: 's-omar' },
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
    { key: 'omar', tutorId: 't-craig', studentIds: ['s-omar'], serviceId: 'svc-ib', weekday: 'today', hour: 18, location: 'online' },
    { key: 'charlotte', tutorId: 't-james', studentIds: ['s-charlotte'], serviceId: 'svc-ib', weekday: 'today', hour: 16, location: 'online' },
    { key: 'layla', tutorId: 't-sarah', studentIds: ['s-layla'], serviceId: 'svc-igcse', weekday: 1, hour: 17, location: 'in-person' },
    { key: 'arjun', tutorId: 't-craig', studentIds: ['s-arjun'], serviceId: 'svc-alevel', weekday: 2, hour: 17, minute: 30, location: 'online' },
    { key: 'haddad', tutorId: 't-sarah', studentIds: ['s-yasmin', 's-karim'], serviceId: 'svc-group', weekday: 5, hour: 10, location: 'in-person' },
    { key: 'layla-2', tutorId: 't-sarah', studentIds: ['s-layla'], serviceId: 'svc-igcse', weekday: 'today', hour: 15, location: 'in-person' },
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
      const student = db.students.find((s) => s.id === studentId)!;
      const syllabus = getSyllabus(student.syllabusId)!;
      const all = syllabus.units.flatMap((u) => u.topics);
      const cursor = topicCursor.get(studentId) ?? Math.floor(random() * 4);
      // Step through the syllabus so ratings spread across every unit.
      const picked = [all[cursor % all.length], all[(cursor + 1) % all.length]];
      topicCursor.set(studentId, cursor + 5);
      for (const topic of picked) {
        if (!topicIds.includes(topic.id)) topicIds.push(topic.id);
        const base = studentId === 's-charlotte' ? 2 : studentId === 's-omar' ? 3 : 3.5;
        const rating = Math.max(1, Math.min(5, Math.round(base + random() * 2 - 0.5))) as TopicRating['rating'];
        db.ratings.push({ id: `rat-${lesson.id}-${topic.id}`, studentId, topicId: topic.id, lessonId: lesson.id, rating, ratedAt: lesson.start });
      }
      const due = addDays(new Date(lesson.start), 6);
      db.homework.push({
        id: `hw-${lesson.id}-${studentId}`,
        studentId,
        lessonId: lesson.id,
        title: `Exercise set: ${picked[0].name}`,
        dueDate: toDateKey(due),
        done: due < addDays(now, -2) || random() > 0.6,
      });
    }
    const t1 = topicIds[0];
    const t2 = topicIds[1] ?? topicIds[0];
    db.notes.push({
      lessonId: lesson.id,
      summary: SUMMARIES[Math.floor(r * SUMMARIES.length)].replace('{t1}', topicName(t1)).replace('{t2}', topicName(t2)),
      privateNote: r > 0.7 ? 'Parent asked about extra sessions before mocks.' : undefined,
      topicIds,
      attendance,
      createdAt: lesson.end,
    });
    applyCharges(db, lesson, attendance);
  }

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
    db.settings.nextInvoiceNumber += 1;
    if (family.id !== 'f-hughes') {
      const total = invoice.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
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
    vatRate: 0,
    payments: [{ id: 'pay-pkg', invoiceId: 'inv-pkg-sharma', amount: pkg.price, method: 'card', paidAt: packageStart.toISOString() }],
  });
  db.settings.nextInvoiceNumber += 1;

  seedEngagement(db, now);
  seedOperations(db, now);
  seedClasswork(db, now);
  seedCalendar(db, now);
  return db;
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
    curriculum: 'A-Level', syllabusId: 'alevel-maths', enquiryId: 'enq-3', schedule: 'Tuesdays 5–6:30pm, from next week',
    location: 'Online', payRate: 260, closesOn: toDateKey(addDays(now, 4)), visibility: 'all', invitedTutorIds: [],
  }, daysAgo(2));
  ops.placeBid(db, as('t-james'), sophie.id, 'I’ve taught A-Level Pure and Stats for six years; four of last year’s students got A*. Tuesday evenings are free for me.', 'Tuesdays after 4pm', daysAgo(1));
  ops.placeBid(db, as('t-sarah'), sophie.id, 'Happy to take Hugo on — I’ve been building up my A-Level hours and have strong Stats experience.', 'Tue/Thu evenings', daysAgo(1));

  ops.saveOpportunity(db, admin, {
    title: 'IB Maths AA HL — Year 13 IA support',
    description: 'Six sessions to guide an Internal Assessment on modelling. Deadline mid-November.',
    curriculum: 'IB', syllabusId: 'ib-aa-hl', enquiryId: 'enq-2', schedule: 'Weekends, flexible',
    location: 'Online', payRate: 280, closesOn: toDateKey(addDays(now, 7)), visibility: 'all', invitedTutorIds: [],
  }, daysAgo(1));

  const filled = ops.saveOpportunity(db, admin, {
    title: 'IGCSE small group — Haddad twins',
    curriculum: 'IGCSE', schedule: 'Saturdays 10–11:30am', location: 'Al Barsha centre', payRate: 200, visibility: 'all', invitedTutorIds: [],
  }, daysAgo(40));
  ops.placeBid(db, as('t-sarah'), filled.id, 'I love group teaching and I’m at the centre on Saturdays.', 'Saturday mornings', daysAgo(39));
  ops.awardOpportunity(db, admin, db.bids.find((b) => b.opportunityId === filled.id)!.id, daysAgo(38));

  // Applications to join.
  db.applications.push(
    { id: 'app-1', createdAt: iso(daysAgo(1)), fullName: 'Hannah Clarke', email: 'hannah@example.com', phone: '+971 52 000 0011', curricula: ['IB', 'A-Level'], subjects: 'Maths, Further Maths', experience: 'Head of Maths at a British international school, 9 years. IB examiner for Paper 2.', qualifications: 'MSc Mathematics, PGCE', availability: 'Weekday evenings, Saturdays', status: 'applied' },
    { id: 'app-2', createdAt: iso(daysAgo(6)), fullName: 'Ravi Menon', email: 'ravi@example.com', curricula: ['IGCSE'], subjects: 'Maths, Additional Maths', experience: '3 years private tutoring, engineering graduate.', qualifications: 'BEng', availability: 'After 5pm', status: 'interview', notes: 'Strong on 0606. Interview Thursday 4pm.' },
    { id: 'app-3', createdAt: iso(daysAgo(20)), fullName: 'Lucy Grant', email: 'lucy@example.com', curricula: ['IGCSE', 'IB'], subjects: 'Maths', experience: 'Newly qualified teacher.', availability: 'Weekends only', status: 'rejected', notes: 'Not enough availability for now — revisit in spring.' },
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
  const layla = db.reports.find((r) => r.studentId === 's-layla')!;
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
    { id: 'enq-1', createdAt: iso(hoursAgo(5)), status: 'new', source: 'app', parentName: 'Rita Rahman', email: 'rita@example.com', phone: '+971 50 000 0005', studentName: 'Zara', curriculum: 'IGCSE', yearGroup: 'Year 10', message: 'Zara is predicted a 6 and wants an 8. Struggling with algebra and graphs.', preferredTimes: 'Weekday evenings', familyId: 'f-rahman' },
    { id: 'enq-2', createdAt: iso(hoursAgo(30)), status: 'new', source: 'website', parentName: 'Daniel Okafor', email: 'daniel@example.com', studentName: 'Ada', curriculum: 'IB', yearGroup: 'Year 13', message: 'IA help for Maths AA HL, due in November.', preferredTimes: 'Weekends' },
    { id: 'enq-3', createdAt: iso(hoursAgo(72)), status: 'contacted', source: 'referral', parentName: 'Sophie Laurent', phone: '+971 55 000 0007', studentName: 'Hugo', curriculum: 'A-Level', yearGroup: 'Year 12', message: 'Referred by the Sharmas.', nextActionAt: toDateKey(addDays(now, 1)), notes: 'Called — wants Tuesday evenings. Send trial options.' },
    { id: 'enq-4', createdAt: iso(hoursAgo(24 * 9)), status: 'enrolled', source: 'website', parentName: 'Rami Haddad', email: 'rami@example.com', studentName: 'Yasmin & Karim', curriculum: 'IGCSE', familyId: 'f-haddad' },
    { id: 'enq-5', createdAt: iso(hoursAgo(24 * 14)), status: 'lost', source: 'phone', parentName: 'Mark Evans', phone: '+971 50 000 0009', studentName: 'Lily', curriculum: 'IGCSE', lostReason: 'Went with a school-based tutor' },
  );

  // Fatima wants an extra lesson for Omar before his mocks.
  const omarNext = db.lessons.find((l) => l.studentIds.includes('s-omar') && l.status === 'scheduled' && new Date(l.start) > addDays(now, 2));
  if (omarNext) {
    const start = new Date(omarNext.start);
    start.setDate(start.getDate() + 1);
    start.setHours(17, 0, 0, 0);
    db.requests.push({
      id: 'req-1', createdAt: iso(hoursAgo(3)), familyId: 'f-mansoori', studentId: 's-omar', kind: 'new-lesson', tutorId: 't-craig',
      serviceId: 'svc-ib', start: iso(start), end: iso(new Date(start.getTime() + 3_600_000)), note: 'Extra session before his mocks please', status: 'pending',
    });
  }

  // A family conversation and an announcement.
  const msgs: [number, string, string, Message['senderRole'], string][] = [
    [50, 'u-parent', 'Fatima Al Mansoori', 'parent', 'Hi Craig, Omar has his mock exams in three weeks. Could we focus on calculus until then?'],
    [49, 'u-admin', "Craig O'Brien", 'admin', 'Absolutely. I’ll plan the next few sessions around differentiation and integration, with timed past-paper questions.'],
    [2, 'u-parent', 'Fatima Al Mansoori', 'parent', 'Thank you! I’ve also requested an extra lesson, if there’s space.'],
  ];
  for (const [h, senderId, senderName, senderRole, body] of msgs) {
    db.messages.push({ id: `msg-${h}`, familyId: 'f-mansoori', senderId, senderName, senderRole, body, createdAt: iso(hoursAgo(h)) });
  }
  db.reads['u-parent'] = { 'f-mansoori': iso(hoursAgo(2)) };
  db.messages.push({ id: 'msg-h1', familyId: 'f-haddad', senderId: 'u-tutor', senderName: 'Sarah Khan', senderRole: 'tutor', body: 'Great group session today. Yasmin and Karim both nailed simultaneous equations.', createdAt: iso(hoursAgo(20)) });
  db.announcements.push({
    id: 'ann-1', createdAt: iso(hoursAgo(26)), authorName: "Craig O'Brien", audience: 'everyone',
    title: 'Mock exam season', body: 'Mocks start soon for most schools. Ask your tutor for a personalised revision plan, and request extra sessions in the app.',
  });
}
