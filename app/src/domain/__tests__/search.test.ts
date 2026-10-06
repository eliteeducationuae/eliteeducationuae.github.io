import { buildContactIndex, familiesByContact, matchesSearch, normSearch, viaContact } from '../search';
import type { FamilyContact } from '../types';

const contact = (over: Partial<FamilyContact>): FamilyContact => ({
  id: 'c',
  familyId: 'f-1',
  name: 'Someone',
  relationship: 'other',
  preferredChannel: 'email',
  canLogIn: false,
  receivesInvoices: false,
  receivesReports: false,
  receivesLessonNotes: false,
  receivesWhatsApp: false,
  emergencyContact: false,
  isPrimary: false,
  hasLogin: false,
  ...over,
});

const contacts = [
  contact({ id: 'c-main', familyId: 'f-mansoori', name: 'Fatima Al Mansoori', relationship: 'mother', email: 'fatima@example.com', isPrimary: true }),
  contact({ id: 'c-raj', familyId: 'f-mansoori', name: 'Raj Patel', relationship: 'driver', phone: '+971 50 555 0101' }),
  contact({ id: 'c-grace', familyId: 'f-mansoori', name: 'Grace Fernandes', relationship: 'pa', email: 'grace@office.ae' }),
  contact({ id: 'c-zoe', familyId: 'f-hughes', name: 'Zoë Hughes', relationship: 'family_office', email: 'zoe@hughes-office.com' }),
];

describe('search helpers', () => {
  it('ignores case and accents', () => {
    expect(normSearch('Zoë ÉLAN')).toBe('zoe elan');
    expect(matchesSearch('zoe', undefined, 'Zoë')).toBe(true);
    expect(matchesSearch('zoe', undefined, '')).toBe(false);
  });

  it('finds a family by its other contacts’ names, emails and telephones', () => {
    const index = buildContactIndex(contacts);
    expect(familiesByContact(index, 'raj').get('f-mansoori')?.id).toBe('c-raj');
    expect(familiesByContact(index, '555 01').get('f-mansoori')?.id).toBe('c-raj');
    expect(familiesByContact(index, 'office.ae').get('f-mansoori')?.id).toBe('c-grace');
    expect(familiesByContact(index, 'zoe').get('f-hughes')?.id).toBe('c-zoe');
    expect(familiesByContact(index, 'nobody').size).toBe(0);
    expect(familiesByContact(index, '').size).toBe(0);
  });

  it('leaves out the main contact, whose details are on the family already', () => {
    const index = buildContactIndex(contacts);
    expect(index.map((e) => e.contact.id)).not.toContain('c-main');
    expect(familiesByContact(index, 'fatima').size).toBe(0);
  });

  it('keeps the first matching contact for each family', () => {
    const hits = familiesByContact(buildContactIndex(contacts), 'e');
    expect([...hits.entries()].map(([f, c]) => [f, c.id])).toEqual([
      ['f-mansoori', 'c-raj'],
      ['f-hughes', 'c-zoe'],
    ]);
  });

  it('says why a family was found', () => {
    expect(viaContact(contacts[1])).toBe('via Raj Patel (driver)');
    expect(viaContact(contacts[2])).toBe('via Grace Fernandes (personal assistant)');
    expect(viaContact(contacts[3])).toBe('via Zoë Hughes (family office)');
  });
});
