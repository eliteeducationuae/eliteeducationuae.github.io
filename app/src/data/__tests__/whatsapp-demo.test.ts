import { setWhatsAppPrefs } from '../demo/whatsapp';
import { createSeed } from '../demo/seed';

const who = (db: ReturnType<typeof createSeed>, role: string) => db.profiles.find((p) => p.role === role)!;

describe('setWhatsAppPrefs (mirrors set_whatsapp)', () => {
  it('stores a parent’s opt-in and number', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    const updated = setWhatsAppPrefs(db, parent, { optIn: true, number: '+971501234567' });
    expect(updated.whatsappOptIn).toBe(true);
    expect(updated.whatsappNumber).toBe('+971501234567');
    expect(who(db, 'parent').whatsappNumber).toBe('+971501234567');
  });

  it('lets tutors opt in too', () => {
    const db = createSeed();
    expect(setWhatsAppPrefs(db, who(db, 'tutor'), { optIn: true, number: '+447700900123' }).whatsappOptIn).toBe(true);
  });

  it('rejects a bad number and a missing number with the database’s messages', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    expect(() => setWhatsAppPrefs(db, parent, { optIn: true, number: '0501234567' })).toThrow(
      'Please enter your WhatsApp number with its country code, for example +971 50 123 4567.',
    );
    expect(() => setWhatsAppPrefs(db, parent, { optIn: true, number: null })).toThrow('Please enter your WhatsApp number.');
    expect(() => setWhatsAppPrefs(db, parent, { optIn: true, number: '  ' })).toThrow('Please enter your WhatsApp number.');
  });

  it('turns students away', () => {
    const db = createSeed();
    expect(() => setWhatsAppPrefs(db, who(db, 'student'), { optIn: true, number: '+971501234567' })).toThrow(
      'WhatsApp reminders are available to parents and tutors.',
    );
  });

  it('keeps the number when opting out', () => {
    const db = createSeed();
    const parent = who(db, 'parent');
    setWhatsAppPrefs(db, parent, { optIn: true, number: '+971501234567' });
    const updated = setWhatsAppPrefs(db, parent, { optIn: false, number: null });
    expect(updated.whatsappOptIn).toBe(false);
    expect(updated.whatsappNumber).toBe('+971501234567');
  });
});
