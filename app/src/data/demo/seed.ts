import { getSyllabus, topicName } from '@/data/curriculum';
import { formatInvoiceNumber, itemsFromCharges, newInvoiceDraft } from '@/domain/billing';
import { addDays, addMinutes, startOfWeek, toDateKey } from '@/domain/dates';
import type { Invoice, Lesson, Profile, Settings, TopicRating } from '@/domain/types';

import { applyCharges, DEMO_DB_VERSION, type DemoDB } from './db';

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
  };

  const db: DemoDB = {
    version: DEMO_DB_VERSION,
    settings,
    profiles: [],
    tutors: [
      { id: 't-craig', fullName: "Craig O'Brien", email: 'craig@eliteeducation.me', hourlyPay: 300, subjects: ['IB', 'A-Level', 'IGCSE'], color: '#2b6cb0' },
      { id: 't-sarah', fullName: 'Sarah Khan', email: 'sarah@eliteeducation.me', hourlyPay: 200, subjects: ['IGCSE'], color: '#c05621' },
      { id: 't-james', fullName: 'James Wilson', email: 'james@eliteeducation.me', hourlyPay: 220, subjects: ['IB', 'IGCSE'], color: '#2f855a' },
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

  return db;
}
