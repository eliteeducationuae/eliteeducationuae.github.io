import {
  advisoryPeriodLabel,
  canManageCase,
  caseAccess,
  daysLeftLabel,
  feeDescription,
  FEE_PRESETS,
  invoicesForCase,
  keyDateTimeLabel,
  keyDateTitle,
  titleNamesInstitution,
  keyDateUrgency,
  keyDatesInRange,
  openTasks,
  overdueKeyDates,
  reminderDue,
  remindersAfterSave,
  remindersCovered,
  targetStatusEventTitle,
  targetSummary,
  targetSummaryLine,
  TASK_REMINDER_DAYS,
  TARGET_STATUS_LABELS,
  TARGET_STATUS_ORDER,
  templateAdvisoryUpdate,
  withKeyDatesInTimeOrder,
  keyDateHeading,
  upcomingKeyDates,
  urgencyTone,
  validateCaseInput,
  validateKeyDateInput,
  validateTargetInput,
  validateTaskInput,
  type AdmissionsCase,
  type AdmissionsKeyDate,
  type AdmissionsTarget,
  type AdmissionsTask,
  type TargetStatus,
} from '../admissions';
import { admissionsLetterInstructions, letterSignOff } from '../../../supabase/functions/_shared/admissions-letter';
import type { Invoice, Profile } from '../types';

const NOW = new Date('2026-10-04T08:00:00+04:00');

const date = (id: string, dueOn: string, extra: Partial<AdmissionsKeyDate> = {}): AdmissionsKeyDate => ({
  id,
  caseId: 'c1',
  kind: 'deadline',
  title: id,
  dueOn,
  done: false,
  ...extra,
});

const task = (id: string, extra: Partial<AdmissionsTask> = {}): AdmissionsTask => ({
  id,
  caseId: 'c1',
  title: id,
  owner: 'family',
  createdAt: '2026-09-01T10:00:00Z',
  ...extra,
});

const target = (id: string, institution: string, status: TargetStatus): AdmissionsTarget => ({
  id,
  caseId: 'c1',
  institution,
  status,
  sort: 0,
  updatedAt: '2026-09-01T10:00:00Z',
});

describe('reminders', () => {
  it('picks the smallest threshold at or above the days left', () => {
    expect(reminderDue(14, [])).toBe(14);
    expect(reminderDue(13, [])).toBe(14);
    expect(reminderDue(7, [])).toBe(7);
    expect(reminderDue(5, [])).toBe(7);
    expect(reminderDue(1, [])).toBe(1);
    expect(reminderDue(0, [])).toBe(0);
  });
  it('is null when past, too far off or already sent', () => {
    expect(reminderDue(-1, [])).toBeNull();
    expect(reminderDue(20, [])).toBeNull();
    expect(reminderDue(15, [])).toBeNull();
    expect(reminderDue(5, [14, 7])).toBeNull();
    expect(reminderDue(1, [14, 7])).toBe(1);
  });
  it('records every threshold covered', () => {
    expect(remindersCovered(5)).toEqual([14, 7]);
    expect(remindersCovered(14)).toEqual([14]);
    expect(remindersCovered(0)).toEqual([14, 7, 1, 0]);
    expect(remindersCovered(20)).toEqual([]);
  });
  it('supports task thresholds', () => {
    expect(reminderDue(3, [], TASK_REMINDER_DAYS)).toBe(3);
    expect(reminderDue(2, [], TASK_REMINDER_DAYS)).toBe(3);
    expect(reminderDue(2, [3], TASK_REMINDER_DAYS)).toBeNull();
    expect(reminderDue(4, [], TASK_REMINDER_DAYS)).toBeNull();
    expect(reminderDue(0, [3], TASK_REMINDER_DAYS)).toBe(0);
    expect(remindersCovered(2, TASK_REMINDER_DAYS)).toEqual([3]);
    expect(remindersCovered(0, TASK_REMINDER_DAYS)).toEqual([3, 0]);
  });
  it('starts reminders afresh when a date is moved', () => {
    expect(remindersAfterSave([14, 7], '2026-10-12', '2026-11-02')).toEqual([]);
    expect(reminderDue(14, remindersAfterSave([14, 7], '2026-10-12', '2026-11-02'))).toBe(14);
    expect(remindersAfterSave([14, 7], '2026-10-12', '2026-10-12')).toEqual([14, 7]);
    expect(remindersAfterSave([3, 0], '2026-10-12', null)).toEqual([]);
    expect(remindersAfterSave([], undefined, null)).toEqual([]);
  });
});

describe('key date urgency', () => {
  it('classifies by days left', () => {
    expect(keyDateUrgency({ dueOn: '2026-10-01', done: true }, NOW)).toBe('done');
    expect(keyDateUrgency({ dueOn: '2026-10-03', done: false }, NOW)).toBe('overdue');
    expect(keyDateUrgency({ dueOn: '2026-10-04', done: false }, NOW)).toBe('today');
    expect(keyDateUrgency({ dueOn: '2026-10-05', done: false }, NOW)).toBe('this-week');
    expect(keyDateUrgency({ dueOn: '2026-10-11', done: false }, NOW)).toBe('this-week');
    expect(keyDateUrgency({ dueOn: '2026-10-12', done: false }, NOW)).toBe('this-month');
    expect(keyDateUrgency({ dueOn: '2026-11-04', done: false }, NOW)).toBe('this-month');
    expect(keyDateUrgency({ dueOn: '2026-11-05', done: false }, NOW)).toBe('later');
  });
  it('maps to badge tones', () => {
    expect(urgencyTone('done')).toBe('success');
    expect(urgencyTone('overdue')).toBe('danger');
    expect(urgencyTone('today')).toBe('warning');
    expect(urgencyTone('this-week')).toBe('warning');
    expect(urgencyTone('this-month')).toBe('gold');
    expect(urgencyTone('later')).toBe('neutral');
  });
  it('labels days left', () => {
    expect(daysLeftLabel('2026-10-04', NOW)).toBe('Today');
    expect(daysLeftLabel('2026-10-05', NOW)).toBe('Tomorrow');
    expect(daysLeftLabel('2026-10-09', NOW)).toBe('In 5 days');
    expect(daysLeftLabel('2026-10-03', NOW)).toBe('Yesterday');
    expect(daysLeftLabel('2026-10-01', NOW)).toBe('3 days ago');
  });
});

describe('key date lists', () => {
  const dates = [
    date('later', '2026-12-20'),
    date('timed', '2026-10-10', { time: '09:00' }),
    date('untimed', '2026-10-10'),
    date('today', '2026-10-04'),
    date('done', '2026-10-06', { done: true }),
    date('old', '2026-09-01'),
    date('older', '2026-08-01'),
    date('far', '2027-02-01'),
  ];
  it('lists upcoming dates within the window, untimed first', () => {
    expect(upcomingKeyDates(dates, NOW).map((d) => d.id)).toEqual(['today', 'untimed', 'timed']);
    expect(upcomingKeyDates(dates, NOW, 90).map((d) => d.id)).toEqual(['today', 'untimed', 'timed', 'later']);
  });
  it('lists overdue dates oldest first', () => {
    expect(overdueKeyDates(dates, NOW).map((d) => d.id)).toEqual(['older', 'old']);
  });
  it('lists every date in a range, done or not', () => {
    expect(keyDatesInRange(dates, '2026-10-04', '2026-10-10').map((d) => d.id)).toEqual(['today', 'done', 'untimed', 'timed']);
  });
  it('ignores possessives when deciding whether a title already names its institution', () => {
    const targets = [target('k', "King's College London", 'applying'), target('j', 'St John\u2019s College', 'applying')];
    expect(keyDateTitle(date('a', '2026-10-10', { kind: 'interview', title: "Omar's interview", targetId: 'k' }), targets)).toBe(
      "Omar's interview · King's College London",
    );
    expect(keyDateTitle(date('b', '2026-10-10', { kind: 'interview', title: "King's interview day", targetId: 'k' }), targets)).toBe(
      "King's interview day",
    );
    expect(keyDateTitle(date('c', '2026-10-10', { kind: 'interview', title: 'Omar\u2019s interview', targetId: 'j' }), targets)).toBe(
      'Omar\u2019s interview · St John\u2019s College',
    );
  });
  it('titles a date with its kind and institution, without repeating either', () => {
    const targets = [target('t1', 'University of Oxford', 'researching'), target('t2', 'Benenden School', 'applying')];
    expect(keyDateTitle(date('a', '2026-10-10', { kind: 'open-day', title: 'Visit', targetId: 't1' }), targets)).toBe(
      'Open day: Visit · University of Oxford',
    );
    expect(keyDateTitle(date('b', '2026-10-10', { kind: 'test', title: 'TSA' }), targets)).toBe('Entrance test: TSA');
    expect(keyDateTitle(date('c', '2026-10-10', { kind: 'deadline', title: 'Common App Early Decision deadline' }), targets)).toBe(
      'Common App Early Decision deadline',
    );
    expect(keyDateTitle(date('d', '2026-10-10', { kind: 'open-day', title: 'Oxford open day', targetId: 't1' }), targets)).toBe('Oxford open day');
    expect(keyDateTitle(date('e', '2026-10-10', { kind: 'test', title: 'Mathematics admissions test practice paper' }), targets)).toBe(
      'Mathematics admissions test practice paper',
    );
    expect(keyDateTitle(date('f', '2026-10-10', { kind: 'deadline', title: 'Registration deadline', targetId: 't2' }), targets)).toBe(
      'Registration deadline · Benenden School',
    );
    expect(keyDateTitle(date('g', '2026-10-10', { kind: 'interview', title: 'Benenden interview', targetId: 't2' }), targets)).toBe(
      'Benenden interview',
    );
  });
  it('knows when a title already names its institution', () => {
    expect(titleNamesInstitution('Oxford open day', 'University of Oxford')).toBe(true);
    expect(titleNamesInstitution('School visit', 'Benenden School')).toBe(false);
    expect(titleNamesInstitution('UCL offer holder day', 'University College London')).toBe(false);
    expect(titleNamesInstitution('LSE deadline', 'LSE')).toBe(true);
  });
  it('gives times in UAE time', () => {
    expect(keyDateTimeLabel('10:30')).toBe('10:30 (UAE time)');
  });
});

describe('openTasks', () => {
  it('sorts dated first, then by creation', () => {
    const tasks = [
      task('undated-new', { createdAt: '2026-09-05T00:00:00Z' }),
      task('undated-old', { createdAt: '2026-09-02T00:00:00Z' }),
      task('late', { dueOn: '2026-10-20' }),
      task('soon', { dueOn: '2026-10-06' }),
      task('done', { dueOn: '2026-10-01', doneAt: '2026-10-02T00:00:00Z' }),
      task('adviser', { dueOn: '2026-10-05', owner: 'adviser' }),
    ];
    expect(openTasks(tasks).map((t) => t.id)).toEqual(['adviser', 'soon', 'late', 'undated-old', 'undated-new']);
    expect(openTasks(tasks, 'family').map((t) => t.id)).toEqual(['soon', 'late', 'undated-old', 'undated-new']);
    expect(openTasks(tasks, 'adviser').map((t) => t.id)).toEqual(['adviser']);
  });
});

describe('target summaries', () => {
  const targets = [
    target('a', 'A', 'researching'),
    target('b', 'B', 'submitted'),
    target('c', 'C', 'offer'),
    target('d', 'D', 'rejected'),
    target('e', 'E', 'interview'),
  ];
  it('counts statuses', () => {
    expect(targetSummary(targets)).toEqual({ total: 5, applied: 4, offers: 1, accepted: 0, awaiting: 2 });
  });
  it('words the line per case kind', () => {
    expect(targetSummaryLine(targets, 'uk-university')).toBe('5 universities shortlisted · 4 applications submitted · 1 offer');
    expect(targetSummaryLine([target('a', 'A', 'submitted')], 'boarding')).toBe('1 school shortlisted · 1 application submitted');
    expect(targetSummaryLine([target('a', 'A', 'researching'), target('b', 'B', 'researching')], 'school-entry')).toBe('2 schools shortlisted');
    expect(targetSummaryLine([target('a', 'A', 'accepted'), target('b', 'B', 'offer')], 'other')).toBe(
      '2 institutions shortlisted · 2 applications submitted · 2 offers · place accepted',
    );
    expect(targetSummaryLine([], 'us-university')).toBe('No universities shortlisted yet');
  });
  it('labels every status in order and titles status events', () => {
    expect(TARGET_STATUS_ORDER).toEqual(Object.keys(TARGET_STATUS_LABELS));
    expect(targetStatusEventTitle('submitted', 'UCL')).toBe('Application submitted to UCL');
    expect(targetStatusEventTitle('rejected', 'UCL')).toBe('UCL did not offer a place');
    expect(targetStatusEventTitle('researching', 'UCL')).toBeNull();
  });
});

describe('access', () => {
  const c: AdmissionsCase = {
    id: 'c1',
    studentId: 's-omar',
    familyId: 'f-mansoori',
    kind: 'uk-university',
    title: 'UCAS',
    status: 'active',
    adviserTutorId: 't-sarah',
    createdAt: '',
    updatedAt: '',
  };
  const admin: Profile = { id: 'u-admin', role: 'admin', fullName: 'Admin', email: 'a@x' };
  const adviser: Profile = { id: 'u-tutor', role: 'tutor', fullName: 'Sarah', email: 's@x', tutorId: 't-sarah' };
  const teacher: Profile = { id: 'u-t2', role: 'tutor', fullName: 'Nour', email: 'n@x', tutorId: 't-nour' };
  const parent: Profile = { id: 'u-parent', role: 'parent', fullName: 'Fatima', email: 'f@x', familyId: 'f-mansoori' };
  const otherParent: Profile = { id: 'u-p2', role: 'parent', fullName: 'Rami', email: 'r@x', familyId: 'f-haddad' };

  it('gives admin, adviser and family their access', () => {
    expect(caseAccess(admin, c, [])).toBe('admin');
    expect(caseAccess(adviser, c, [])).toBe('adviser');
    expect(caseAccess(parent, c, ['s-omar', 's-layla'])).toBe('family');
    expect(caseAccess(otherParent, c, ['s-yasmin'])).toBeNull();
  });
  it('does not give a teaching tutor access', () => {
    expect(caseAccess(teacher, c, ['s-omar'])).toBeNull();
    expect(caseAccess(adviser, { ...c, adviserTutorId: undefined }, ['s-omar'])).toBeNull();
  });
  it('lets only admin and the adviser manage', () => {
    expect(canManageCase(admin, c)).toBe(true);
    expect(canManageCase(adviser, c)).toBe(true);
    expect(canManageCase(teacher, c)).toBe(false);
    expect(canManageCase(parent, c)).toBe(false);
    expect(canManageCase({ ...adviser, tutorId: undefined }, { adviserTutorId: undefined })).toBe(false);
  });
});

describe('fees', () => {
  const inv = (id: string, items: Record<string, unknown>[]): Invoice =>
    ({ id, number: id, familyId: 'f', issueDate: '', dueDate: '', status: 'sent', items, vatRate: 0, payments: [] }) as unknown as Invoice;
  it('finds invoices carrying the case id', () => {
    const invoices = [
      inv('a', [{ description: 'x', quantity: 1, unitPrice: 1, admissionsCaseId: 'c1' }]),
      inv('b', [{ description: 'y', quantity: 1, unitPrice: 1 }]),
      inv('c', [{ description: 'z', quantity: 1, unitPrice: 1, admissionsCaseId: 'c2' }]),
    ];
    expect(invoicesForCase(invoices, 'c1').map((i) => i.id)).toEqual(['a']);
  });
  it('describes fees', () => {
    expect(FEE_PRESETS.map((p) => p.key)).toEqual(['package', 'fixed', 'hourly']);
    expect(feeDescription('package', 'UCAS 2028 entry')).toBe('Admissions advisory package — UCAS 2028 entry');
    expect(feeDescription('fixed', 'UCAS 2028 entry', 'Personal statement review')).toBe(
      'Admissions advisory service: Personal statement review — UCAS 2028 entry',
    );
  });
});

describe('advisory updates', () => {
  it('labels the period', () => {
    expect(advisoryPeriodLabel(NOW)).toBe('October 2026');
  });
  it('writes the template as a formal letter built from the case records only', () => {
    const { title, body } = templateAdvisoryUpdate({
      studentName: 'Omar',
      kind: 'monthly',
      caseKind: 'uk-university',
      addressee: 'Mona Ahmed',
      adviser: 'Sarah Khan',
      targets: [
        target('t1', 'University of Oxford', 'researching'),
        target('t2', 'University College London', 'applying'),
        target('t3', 'London School of Economics', 'researching'),
        target('t4', 'University of Warwick', 'researching'),
        target('t5', 'Imperial College London', 'offer'),
      ],
      dates: [
        date('d1', '2026-10-17', { title: 'Personal statement first draft' }),
        date('d3', '2026-10-24', { kind: 'open-day', title: 'Oxford open day', time: '10:30' }),
        date('d2', '2026-10-01', { title: 'Missed' }),
      ],
      tasks: [
        task('Send the latest school report', { dueOn: '2026-10-09' }),
        task('Confirm summer school preferences'),
        task('Adviser only', { owner: 'adviser' }),
        task('Already done', { doneAt: '2026-10-01T00:00:00Z' }),
      ],
      events: [],
      now: NOW,
    });
    expect(title).toBe('October 2026 advisory update');
    expect(body.split('\n\n')).toEqual([
      'Dear Mona,',
      'We are pleased to share our advisory update on Omar’s admissions for October 2026.',
      'Omar’s shortlist currently comprises five universities. We are preparing Omar’s application to University College London, ' +
        'and continue to research the University of Oxford, the London School of Economics and the University of Warwick. ' +
        'We are delighted to report that Omar has received an offer from Imperial College London.',
      'Looking ahead, there are two key dates to note. The personal statement first draft is due on Saturday 17 October 2026. ' +
        'The Oxford open day takes place on Saturday 24 October 2026 at 10:30 (UAE time).',
      'In the meantime, we should be grateful if you could send the latest school report by Friday 9 October 2026 and confirm summer school preferences.',
      'Please do not hesitate to contact us should you have any questions.',
      'With kind regards,\nSarah Khan\nAdmissions Adviser, Elite Education',
    ]);
    expect(body).not.toMatch(/Adviser only|Already done|Missed|\(researching\)|Oct 2026|;/);
  });
  it('names a single key date in one sentence and keeps proper names capitalised', () => {
    const { body } = templateAdvisoryUpdate({
      studentName: 'Layla',
      kind: 'ad-hoc',
      caseKind: 'school-entry',
      targets: [target('t1', 'Repton School Dubai', 'interview')],
      dates: [date('d1', '2026-10-12', { kind: 'interview', title: 'Sixth Form panel interview', targetId: 't1', time: '10:30' })],
      tasks: [],
      events: [],
      now: NOW,
    });
    expect(body).toContain('Dear Parents,');
    expect(body).toContain("Layla’s shortlist currently comprises one school. Layla has been invited to interview at Repton School Dubai.");
    expect(body).toContain(
      'Looking ahead, the Sixth Form panel interview with Repton School Dubai is scheduled for Monday 12 October 2026 at 10:30 (UAE time).',
    );
    expect(body).toContain('With kind regards,\nThe Admissions Team\nElite Education');
  });
  it('addresses a titled parent formally and keeps test names capitalised', () => {
    const { body } = templateAdvisoryUpdate({
      studentName: 'Omar',
      kind: 'ad-hoc',
      addressee: 'Mrs Fatima Al Mansoori',
      targets: [],
      dates: [date('d1', '2026-10-20', { kind: 'test', title: 'Mathematics admissions test practice paper' })],
      tasks: [],
      events: [],
      now: NOW,
    });
    expect(body.startsWith('Dear Mrs Al Mansoori,\n\n')).toBe(true);
    expect(body).toContain('the Mathematics Admissions Test practice paper takes place on Tuesday 20 October 2026.');
    expect(body).not.toContain("'");
  });
  it('signs off exactly as the AI draft is told to', () => {
    const office = templateAdvisoryUpdate({ studentName: 'Layla', kind: 'ad-hoc', targets: [], dates: [], tasks: [], events: [], now: NOW });
    expect(office.body.endsWith(letterSignOff(undefined))).toBe(true);
    const named = templateAdvisoryUpdate({ studentName: 'Layla', kind: 'ad-hoc', adviser: 'Sarah Khan', targets: [], dates: [], tasks: [], events: [], now: NOW });
    expect(named.body.endsWith(letterSignOff('Sarah Khan'))).toBe(true);
    expect(admissionsLetterInstructions({ kind: 'monthly', studentFirstName: 'Layla', parentName: 'Mona Ahmed', adviser: 'Sarah Khan' })).toContain(
      `"Dear Mona," on its own line and close it with exactly this sign-off, line for line:\n${letterSignOff('Sarah Khan')}`,
    );
  });
  it('titles ad-hoc updates simply and copes with an empty case', () => {
    const out = templateAdvisoryUpdate({ studentName: 'Layla', kind: 'ad-hoc', targets: [], dates: [], tasks: [], events: [], now: NOW });
    expect(out.title).toBe('Advisory update');
    expect(out.body).toContain('nothing outstanding');
  });
});

describe('validators', () => {
  it('checks targets', () => {
    expect(validateTargetInput({ caseId: 'c1', institution: ' ', status: 'researching' })).toMatch(/school or university/);
    expect(validateTargetInput({ caseId: 'c1', institution: 'x'.repeat(201), status: 'researching' })).toMatch(/200/);
    expect(validateTargetInput({ caseId: 'c1', institution: 'UCL', status: 'researching', decisionDate: '2026-13-01' })).toMatch(/YYYY-MM-DD/);
    expect(validateTargetInput({ caseId: 'c1', institution: 'UCL', status: 'researching', decisionDate: '2027-03-31' })).toBeNull();
  });
  it('checks key dates', () => {
    const base = { caseId: 'c1', kind: 'deadline' as const, title: 'Deadline', dueOn: '2026-10-15' };
    expect(validateKeyDateInput(base)).toBeNull();
    expect(validateKeyDateInput({ ...base, title: '' })).toMatch(/title/);
    expect(validateKeyDateInput({ ...base, dueOn: '15/10/2026' })).toMatch(/YYYY-MM-DD/);
    expect(validateKeyDateInput({ ...base, dueOn: '2026-02-30' })).toMatch(/YYYY-MM-DD/);
    expect(validateKeyDateInput({ ...base, time: '9:30' })).toMatch(/HH:MM/);
    expect(validateKeyDateInput({ ...base, time: '24:00' })).toMatch(/HH:MM/);
    expect(validateKeyDateInput({ ...base, time: '09:30' })).toBeNull();
  });
  it('checks tasks and cases', () => {
    expect(validateTaskInput({ caseId: 'c1', title: 'Send report', owner: 'family' })).toBeNull();
    expect(validateTaskInput({ caseId: 'c1', title: 'Send report', owner: 'family', dueOn: 'soon' })).toMatch(/YYYY-MM-DD/);
    expect(validateTaskInput({ caseId: 'c1', title: '', owner: 'adviser' })).toMatch(/title/);
    expect(validateCaseInput({ studentId: 's1', kind: 'boarding', title: 'Boarding', status: 'active' })).toBeNull();
    expect(validateCaseInput({ studentId: '', kind: 'boarding', title: 'Boarding', status: 'active' })).toMatch(/student/);
    expect(validateCaseInput({ studentId: 's1', kind: 'boarding', title: ' ', status: 'active' })).toMatch(/title/);
  });
});

describe('calendar lines', () => {
  it('weaves timed key dates in among lessons and closes the day with untimed ones', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m).toISOString();
    const entries = [{ start: at(9), id: 'l1' }, { start: at(17, 30), id: 'l2' }];
    const out = withKeyDatesInTimeOrder(entries, [
      date('untimed', '2026-10-12'),
      date('evening', '2026-10-12', { time: '18:00' }),
      date('interview', '2026-10-12', { time: '10:30' }),
    ]);
    expect(out.map((x) => (x.kind === 'entry' ? x.entry.id : x.date.id))).toEqual(['l1', 'interview', 'l2', 'evening', 'untimed']);
  });
  it('heads a key date without repeating its kind', () => {
    expect(keyDateHeading({ kind: 'deadline', title: 'Common App Early Decision deadline' })).toBe('Common App Early Decision deadline');
    expect(keyDateHeading({ kind: 'deadline', title: 'Personal statement first draft' })).toBe('Deadline: Personal statement first draft');
    expect(keyDateHeading({ kind: 'interview', title: 'Sixth Form panel interview' })).toBe('Sixth Form panel interview');
    expect(keyDateHeading({ kind: 'open-day', title: 'Oxford open day' })).toBe('Oxford open day');
    expect(keyDateHeading({ kind: 'test', title: 'UCAT' })).toBe('Entrance test: UCAT');
  });
});
