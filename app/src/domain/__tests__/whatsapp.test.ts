import {
  canUseWhatsApp,
  formatWhatsAppNumber,
  isLikelyWhatsAppMobile,
  normaliseWhatsAppNumber,
  WHATSAPP_NUMBER_RE,
  whatsAppMessageKinds,
} from '../whatsapp';

describe('normaliseWhatsAppNumber', () => {
  it.each([
    ['050 123 4567', '+971501234567'],
    ['0501234567', '+971501234567'],
    ['+971 50 123 4567', '+971501234567'],
    ['00971501234567', '+971501234567'],
    ['971501234567', '+971501234567'],
    ['501234567', '+971501234567'],
    ['+44 7700 900123', '+447700900123'],
    ['(050) 123-4567', '+971501234567'],
    ['04 123 4567', '+97141234567'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseWhatsAppNumber(input)).toBe(expected);
    expect(WHATSAPP_NUMBER_RE.test(expected)).toBe(true);
  });

  it.each(['', '   ', '12345', '+0123', 'abc', '+97150abc4567'])('rejects %p', (input) => {
    expect(normaliseWhatsAppNumber(input)).toBeNull();
  });

  it('uses another default country code for local numbers', () => {
    expect(normaliseWhatsAppNumber('07700 900123', '44')).toBe('+447700900123');
  });
});

describe('formatWhatsAppNumber', () => {
  it('groups UAE mobiles and landlines', () => {
    expect(formatWhatsAppNumber('+971501234567')).toBe('+971 50 123 4567');
    expect(formatWhatsAppNumber('+97141234567')).toBe('+971 4 123 4567');
  });
  it('groups other numbers lightly after the country code', () => {
    expect(formatWhatsAppNumber('+447700900123')).toBe('+44 770 090 0123');
    expect(formatWhatsAppNumber('+12025550123')).toBe('+1 202 555 0123');
    expect(formatWhatsAppNumber('+966501234567')).toBe('+966 50 123 4567');
    expect(formatWhatsAppNumber('+33612345678')).toBe('+33 61 234 5678');
    expect(formatWhatsAppNumber('not a number')).toBe('not a number');
  });
});

describe('role helpers', () => {
  it('lets parents, tutors and teaching admins use WhatsApp, but not students', () => {
    expect(canUseWhatsApp('parent')).toBe(true);
    expect(canUseWhatsApp('tutor')).toBe(true);
    expect(canUseWhatsApp('admin', 't-craig')).toBe(true);
    expect(canUseWhatsApp('admin')).toBe(false);
    expect(canUseWhatsApp('student')).toBe(false);
  });

  it('pre-fills only numbers that can take WhatsApp', () => {
    expect(isLikelyWhatsAppMobile('+971501234567')).toBe(true);
    expect(isLikelyWhatsAppMobile('+97141234567')).toBe(false);
    expect(isLikelyWhatsAppMobile('+447700900123')).toBe(true);
  });
  it('lists the messages each role receives', () => {
    expect(whatsAppMessageKinds('parent')).toHaveLength(4);
    expect(whatsAppMessageKinds('parent')).toContain('Homework due the next day');
    expect(whatsAppMessageKinds('tutor')).toEqual(['Lesson reminders the day before each of your lessons']);
    expect(whatsAppMessageKinds('admin')).toEqual(whatsAppMessageKinds('tutor'));
    expect(whatsAppMessageKinds('student')).toEqual([]);
  });
});
