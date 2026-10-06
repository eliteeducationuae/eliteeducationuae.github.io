import {
  keyDateRow,
  targetRow,
  taskRow,
  toAdmissionsCase,
  toAdmissionsDocument,
  toAdmissionsEvent,
  toAdmissionsKeyDate,
  toAdmissionsTarget,
  toAdmissionsTask,
  toAdvisoryUpdate,
} from '../admissions-mapping';

describe('admissions rows to app types', () => {
  it('maps a case, dropping nulls', () => {
    expect(
      toAdmissionsCase({
        id: 'c1',
        student_id: 's1',
        family_id: 'f1',
        kind: 'uk-university',
        title: 'UCAS',
        entry_year: null,
        status: 'active',
        adviser_tutor_id: 't1',
        summary: null,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z',
      }),
    ).toEqual({
      id: 'c1',
      studentId: 's1',
      familyId: 'f1',
      kind: 'uk-university',
      title: 'UCAS',
      status: 'active',
      adviserTutorId: 't1',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    });
  });

  it('maps a target', () => {
    const t = toAdmissionsTarget({
      id: 't1',
      case_id: 'c1',
      institution: 'UCL',
      country: 'United Kingdom',
      programme: null,
      entry_year: '2028',
      requirements: null,
      status: 'offer',
      decision_date: '2027-03-31',
      notes: null,
      sort: '2',
      created_at: 'x',
      updated_at: 'y',
    });
    expect(t).toEqual({
      id: 't1',
      caseId: 'c1',
      institution: 'UCL',
      country: 'United Kingdom',
      entryYear: '2028',
      status: 'offer',
      decisionDate: '2027-03-31',
      sort: 2,
      updatedAt: 'y',
    });
  });

  it('maps a key date with time text and ignores reminders_sent', () => {
    const d = toAdmissionsKeyDate({
      id: 'd1',
      case_id: 'c1',
      target_id: null,
      kind: 'interview',
      title: 'Interview',
      due_on: '2026-10-20',
      time_of_day: '10:00',
      done: false,
      enrolment_id: 'e1',
      lesson_id: null,
      notes: null,
      reminders_sent: [14],
      created_at: 'x',
    });
    expect(d).toEqual({ id: 'd1', caseId: 'c1', kind: 'interview', title: 'Interview', dueOn: '2026-10-20', time: '10:00', done: false, enrolmentId: 'e1' });
    expect(toAdmissionsKeyDate({ id: 'd2', case_id: 'c1', kind: 'test', title: 'T', due_on: '2026-10-20', time_of_day: '09:30:00', done: true }).time).toBe('09:30');
    expect(toAdmissionsKeyDate({ id: 'd3', case_id: 'c1', kind: 'test', title: 'T', due_on: '2026-10-20', time_of_day: null, done: null }))
      .toEqual({ id: 'd3', caseId: 'c1', kind: 'test', title: 'T', dueOn: '2026-10-20', done: false });
  });

  it('maps tasks, documents, updates and events', () => {
    expect(
      toAdmissionsTask({ id: 'k1', case_id: 'c1', target_id: null, title: 'Send', details: null, due_on: null, owner: 'family', done_at: '2026-10-01T00:00:00Z', done_by_name: 'Fatima', created_at: 'x' }),
    ).toEqual({ id: 'k1', caseId: 'c1', title: 'Send', owner: 'family', doneAt: '2026-10-01T00:00:00Z', doneByName: 'Fatima', createdAt: 'x' });
    expect(
      toAdmissionsDocument({ id: 'doc', case_id: 'c1', target_id: 't1', category: 'reference', name: 'Ref.pdf', path: 'cases/c1/ref.pdf', mime_type: null, family_visible: false, uploaded_by: 'u1', uploaded_by_name: null, created_at: 'x' }),
    ).toEqual({ id: 'doc', caseId: 'c1', targetId: 't1', category: 'reference', name: 'Ref.pdf', path: 'cases/c1/ref.pdf', familyVisible: false, uploadedBy: 'u1', createdAt: 'x' });
    expect(
      toAdvisoryUpdate({ id: 'u1', case_id: 'c1', kind: 'monthly', title: 'October 2026 advisory update', period: 'October 2026', body: null, status: 'draft', ai_assisted: true, author_id: 'p1', author_name: 'Sarah', created_at: 'x', submitted_at: null, approved_at: null, published_at: null }),
    ).toEqual({ id: 'u1', caseId: 'c1', kind: 'monthly', title: 'October 2026 advisory update', period: 'October 2026', body: '', status: 'draft', aiAssisted: true, authorName: 'Sarah', createdAt: 'x' });
    expect(toAdmissionsEvent({ id: 'e1', case_id: 'c1', at: 'x', kind: 'milestone', title: 'Interview passed', detail: null, family_visible: true })).toEqual({
      id: 'e1',
      caseId: 'c1',
      at: 'x',
      kind: 'milestone',
      title: 'Interview passed',
      familyVisible: true,
    });
  });
});

describe('admissions upsert rows', () => {
  it('builds a target row with blanks as null and no id when new', () => {
    const row = targetRow({ caseId: 'c1', institution: ' UCL ', country: '', programme: 'Economics', status: 'researching', decisionDate: null });
    expect(row).toEqual({
      case_id: 'c1',
      institution: 'UCL',
      country: null,
      programme: 'Economics',
      entry_year: null,
      requirements: null,
      status: 'researching',
      decision_date: null,
      notes: null,
    });
    expect(targetRow({ id: 't1', caseId: 'c1', institution: 'UCL', status: 'offer', sort: 3 })).toMatchObject({ id: 't1', sort: 3 });
  });

  it('builds a key date row without reminders_sent', () => {
    const row = keyDateRow({ caseId: 'c1', kind: 'deadline', title: 'Deadline', dueOn: '2026-10-15', time: '', targetId: undefined });
    expect(row).toEqual({
      case_id: 'c1',
      target_id: null,
      kind: 'deadline',
      title: 'Deadline',
      due_on: '2026-10-15',
      time_of_day: null,
      enrolment_id: null,
      lesson_id: null,
      notes: null,
    });
    expect(row).not.toHaveProperty('reminders_sent');
    expect(keyDateRow({ id: 'd1', caseId: 'c1', kind: 'test', title: 'T', dueOn: '2026-10-15', time: '09:00', done: true })).toMatchObject({
      id: 'd1',
      time_of_day: '09:00',
      done: true,
    });
  });

  it('builds a task row', () => {
    expect(taskRow({ caseId: 'c1', title: 'Send report', owner: 'family', dueOn: '', details: ' ' })).toEqual({
      case_id: 'c1',
      target_id: null,
      title: 'Send report',
      details: null,
      due_on: null,
      owner: 'family',
    });
    expect(taskRow({ id: 'k1', caseId: 'c1', title: 'X', owner: 'adviser' })).toHaveProperty('id', 'k1');
  });
});
