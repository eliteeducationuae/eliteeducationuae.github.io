import {
  reviewDocumentParams,
  submitDocumentParams,
  toHandbookAck,
  toHandbookVersion,
  toTutorCompliance,
  toTutorDocument,
  toVettingOverride,
} from '../vetting-mapping';

describe('vetting row mapping', () => {
  it('maps tutor documents', () => {
    expect(
      toTutorDocument({
        id: 'd1', created_at: '2026-10-01T08:00:00+00:00', tutor_id: 't1', doc_type: 'police_clearance', title: null,
        file_path: 'tutors/t1/a.pdf', file_name: 'a.pdf', issue_date: '2026-01-04', expiry_date: '2027-01-04', status: 'verified',
        review_note: null, uploaded_by: 'u1', verified_by: 'u2', verified_by_name: "Craig O'Brien", verified_at: '2026-10-02T08:00:00+00:00',
      }),
    ).toEqual({
      id: 'd1', tutorId: 't1', type: 'police_clearance', title: undefined, filePath: 'tutors/t1/a.pdf', fileName: 'a.pdf',
      issueDate: '2026-01-04', expiryDate: '2027-01-04', status: 'verified', reviewNote: undefined,
      createdAt: '2026-10-01T08:00:00.000Z', verifiedAt: '2026-10-02T08:00:00.000Z', verifiedByName: "Craig O'Brien",
    });
  });

  it('maps overrides', () => {
    expect(
      toVettingOverride({
        id: 'o1', tutor_id: 't1', reason: 'Certificate in the post', created_at: '2026-10-01T08:00:00Z', created_by: 'u1',
        created_by_name: "Craig O'Brien", expires_at: '2026-10-15T08:00:00Z', revoked_at: null, revoked_by: null, revoked_by_name: null,
      }),
    ).toEqual({
      id: 'o1', tutorId: 't1', reason: 'Certificate in the post', createdAt: '2026-10-01T08:00:00.000Z', createdByName: "Craig O'Brien",
      expiresAt: '2026-10-15T08:00:00.000Z', revokedAt: undefined, revokedByName: undefined,
    });
  });

  it('maps compliance rows, with and without an override', () => {
    const row = {
      tutor_id: 't1', vetting_status: 'expiring', clearance_expiry: '2026-10-29', documents_pending: '1', bank_details: true,
      availability_set: false, calendar_connected: null, whatsapp_opt_in: true, handbook_version: 2, handbook_acknowledged_version: null,
      onboarding_started_at: null, override_id: null, override_reason: null, override_until: null, enforced: true,
    };
    expect(toTutorCompliance(row)).toEqual({
      tutorId: 't1', vettingStatus: 'expiring', clearanceExpiry: '2026-10-29', documentsPending: 1, bankDetails: true,
      availabilitySet: false, calendarConnected: false, whatsappOptIn: true, handbookVersion: 2, handbookAcknowledgedVersion: undefined,
      onboardingStartedAt: undefined, override: undefined, enforced: true,
    });
    expect(
      toTutorCompliance({ ...row, vetting_status: 'missing', override_id: 'o1', override_reason: 'In the post', override_until: '2026-10-15T08:00:00Z' }),
    ).toMatchObject({ vettingStatus: 'missing', override: { id: 'o1', reason: 'In the post', until: '2026-10-15T08:00:00.000Z' } });
  });

  it('maps handbook versions and acknowledgements', () => {
    expect(
      toHandbookVersion({ id: 'h1', version: 3, title: 'Handbook', body: '# Hi', published_at: '2026-10-01T08:00:00Z', published_by: null, published_by_name: null }),
    ).toEqual({ id: 'h1', version: 3, title: 'Handbook', body: '# Hi', publishedAt: '2026-10-01T08:00:00.000Z', publishedByName: undefined });
    expect(toHandbookAck({ tutor_id: 't1', version: 3, profile_id: 'u1', acknowledged_at: '2026-10-02T08:00:00Z' })).toEqual({
      tutorId: 't1', version: 3, acknowledgedAt: '2026-10-02T08:00:00.000Z',
    });
  });

  it('builds RPC parameters with nulls for blanks', () => {
    expect(submitDocumentParams({ tutorId: 't1', type: 'qualification', filePath: 'tutors/t1/b.pdf', fileName: 'b.pdf', title: '  ', issueDate: '' })).toEqual({
      p_tutor_id: 't1', p_doc_type: 'qualification', p_file_path: 'tutors/t1/b.pdf', p_file_name: 'b.pdf', p_title: null, p_issue_date: null, p_expiry_date: null,
    });
    expect(reviewDocumentParams('d1', { approve: true, expiryDate: '2027-01-04' })).toEqual({
      p_id: 'd1', p_approve: true, p_issue_date: null, p_expiry_date: '2027-01-04', p_note: null,
    });
  });
});
