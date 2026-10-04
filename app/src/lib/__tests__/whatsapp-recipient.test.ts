import { whatsappRecipient } from '../../../supabase/functions/_shared/whatsapp';

describe('whatsappRecipient', () => {
  it('sends a login’s message to the number they opted in with', () => {
    expect(
      whatsappRecipient({
        profile_id: 'p1',
        contact_id: null,
        whatsapp_to: '+971500000000',
        profiles: { whatsapp_opt_in: true, whatsapp_number: '+971501234567' },
        family_contacts: null,
      }),
    ).toBe('+971501234567');
  });

  it('skips a login who has opted out or has no number', () => {
    expect(
      whatsappRecipient({
        profile_id: 'p1',
        whatsapp_to: '+971501234567',
        profiles: { whatsapp_opt_in: false, whatsapp_number: '+971501234567' },
      }),
    ).toBeNull();
    expect(
      whatsappRecipient({ profile_id: 'p1', whatsapp_to: '+971501234567', profiles: { whatsapp_opt_in: true, whatsapp_number: null } }),
    ).toBeNull();
    expect(whatsappRecipient({ profile_id: 'p1', whatsapp_to: '+971501234567', profiles: null })).toBeNull();
  });

  it('never falls back to a contact’s consent for a login’s message', () => {
    expect(
      whatsappRecipient({
        profile_id: 'p1',
        contact_id: 'c1',
        whatsapp_to: '+971501234567',
        profiles: { whatsapp_opt_in: false, whatsapp_number: '+971501234567' },
        family_contacts: { receives_whatsapp: true, phone: '+971501234567' },
      }),
    ).toBeNull();
  });

  it('sends a contact without a login to the queued number while they still agree', () => {
    expect(
      whatsappRecipient({
        profile_id: null,
        contact_id: 'c1',
        whatsapp_to: '+971502223333',
        profiles: null,
        family_contacts: { receives_whatsapp: true, phone: '+971 (50) 222-3333' },
      }),
    ).toBe('+971502223333');
  });

  it('skips a contact whose consent was withdrawn after the message was queued', () => {
    expect(
      whatsappRecipient({
        profile_id: null,
        contact_id: 'c1',
        whatsapp_to: '+971502223333',
        family_contacts: { receives_whatsapp: false, phone: '+971502223333' },
      }),
    ).toBeNull();
  });

  it('skips a contact row with no number, or whose contact has been removed', () => {
    expect(
      whatsappRecipient({ profile_id: null, contact_id: 'c1', whatsapp_to: null, family_contacts: { receives_whatsapp: true } }),
    ).toBeNull();
    expect(whatsappRecipient({ profile_id: null, contact_id: 'c1', whatsapp_to: '+971502223333', family_contacts: null })).toBeNull();
    // A removed contact leaves contact_id null (on delete set null).
    expect(whatsappRecipient({ profile_id: null, contact_id: null, whatsapp_to: '+971502223333' })).toBeNull();
  });
});
