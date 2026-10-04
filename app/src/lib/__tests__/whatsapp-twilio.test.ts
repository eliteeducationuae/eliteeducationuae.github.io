import {
  buildTwilioMessage,
  cleanVariable,
  isWhatsAppTemplate,
  looksLikeBankDetails,
  readTwilioResult,
  renderWhatsApp,
  twilioConfigFromEnv,
  WHATSAPP_TEMPLATES,
  type TwilioConfig,
  type WhatsAppTemplate,
} from '../../../supabase/functions/_shared/whatsapp';

const KEYS = Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplate[];
const FOOTER = 'Elite Education | eliteeducation.me';

const ENV: Record<string, string> = {
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_WHATSAPP_FROM: 'whatsapp:+971500000000',
  TWILIO_TEMPLATE_LESSON_REMINDER: 'HX0001',
  TWILIO_TEMPLATE_LESSON_NOTES: 'HX0002',
  TWILIO_TEMPLATE_INVOICE_SENT: 'HX0003',
  TWILIO_TEMPLATE_INVOICE_OVERDUE: 'HX0004',
  TWILIO_TEMPLATE_HOMEWORK_DUE: 'HX0005',
};
const config = twilioConfigFromEnv((k) => ENV[k]) as TwilioConfig;
/** Decodes a Basic auth header back to 'user:password' (UTF-8). */
function decodeBasic(header: string): string {
  const binary = atob(header.replace(/^Basic /, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

const invoiceVars = { '1': 'Mona', '2': 'INV-0042', '3': 'AED 1,050.00', '4': '15 Oct 2026' };

describe('WhatsApp templates', () => {
  it('lists exactly the five approved templates', () => {
    expect(KEYS.sort()).toEqual(['homework_due', 'invoice_overdue', 'invoice_sent', 'lesson_notes', 'lesson_reminder']);
    expect(isWhatsAppTemplate('invoice_sent')).toBe(true);
    expect(isWhatsAppTemplate('marketing')).toBe(false);
    expect(isWhatsAppTemplate('toString')).toBe(false);
    expect(isWhatsAppTemplate(42)).toBe(false);
  });

  it('renders each sample to the exact approved wording', () => {
    expect(renderWhatsApp('lesson_reminder', { '1': 'Mona', '2': 'Omar', '3': 'Ms Sarah Khan', '4': 'Tue 7 Oct, 16:00' })).toBe(
      'Dear Mona, this is a reminder that Omar has a lesson with Ms Sarah Khan on Tue 7 Oct, 16:00 (UAE time). Elite Education | eliteeducation.me',
    );
    expect(renderWhatsApp('lesson_notes', { '1': 'Mona', '2': 'Omar', '3': '7 Oct' })).toBe(
      'Dear Mona, the lesson notes for Omar from 7 Oct are now ready in the Elite Education app. Elite Education | eliteeducation.me',
    );
    expect(renderWhatsApp('invoice_sent', invoiceVars)).toBe(
      'Dear Mona, invoice INV-0042 for AED 1,050.00 is now available in the Elite Education app and is due by 15 Oct 2026. Elite Education | eliteeducation.me',
    );
    expect(renderWhatsApp('invoice_overdue', invoiceVars)).toBe(
      'Dear Mona, invoice INV-0042 for AED 1,050.00 was due on 15 Oct 2026 and remains unpaid. You may view and pay it in the Elite Education app. If you have already paid, please disregard this message. Elite Education | eliteeducation.me',
    );
    expect(renderWhatsApp('homework_due', { '1': 'Mona', '2': 'Omar', '3': 'Wed 8 Oct', '4': 'Quadratic equations worksheet' })).toBe(
      'Dear Mona, this is a reminder that Omar has homework due on Wed 8 Oct: Quadratic equations worksheet. Elite Education | eliteeducation.me',
    );
  });

  it.each(KEYS)('%s has a clean, well-formed body and a complete sample', (key) => {
    const t = WHATSAPP_TEMPLATES[key];
    expect(t.body).not.toMatch(/['’]/);
    expect(t.body).not.toMatch(/\n/);
    expect(looksLikeBankDetails(t.body)).toBe(false);
    expect(t.body.endsWith(FOOTER)).toBe(true);
    const placeholders = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect(placeholders).toEqual(t.variables.map((_, i) => i + 1));
    expect(Object.keys(t.sample).sort()).toEqual(t.variables.map((_, i) => String(i + 1)).sort());
    expect(renderWhatsApp(key, t.sample)).not.toMatch(/\{\{/);
    expect(t.envVar).toMatch(/^TWILIO_TEMPLATE_[A-Z_]+$/);
  });
});

describe('cleanVariable', () => {
  it('makes a single tidy line', () => {
    expect(cleanVariable('  Fractions\nand\tdecimals  ')).toBe('Fractions and decimals');
    expect(cleanVariable('a     b')).toBe('a b');
    expect(cleanVariable('line one\r\n\r\nline two')).toBe('line one line two');
  });
  it('never sends an empty value', () => {
    expect(cleanVariable('')).toBe('-');
    expect(cleanVariable('   \n ')).toBe('-');
    expect(cleanVariable(undefined)).toBe('-');
  });
  it('caps long values at 300 characters', () => {
    expect(cleanVariable('x'.repeat(500))).toHaveLength(300);
  });
});

describe('looksLikeBankDetails', () => {
  it.each(['IBAN: AE07 0331 2345 6789 0123 456', 'our swift code', 'BIC ABCDAEAD', 'Account number 12345678', 'sort code 12-34-56', 'AE070331234567890123456'])(
    'flags %s',
    (text) => expect(looksLikeBankDetails(text)).toBe(true),
  );
  it.each(['INV-0042', 'AED 1,050.00', 'Quadratic equations worksheet', 'Biology revision', 'Tue 7 Oct, 16:00'])('allows %s', (text) =>
    expect(looksLikeBankDetails(text)).toBe(false),
  );
});

describe('twilioConfigFromEnv', () => {
  it('reads the secrets and strips the whatsapp: prefix', () => {
    expect(config).toEqual({
      accountSid: ENV.TWILIO_ACCOUNT_SID,
      authToken: 'test-token',
      from: '+971500000000',
      contentSids: { lesson_reminder: 'HX0001', lesson_notes: 'HX0002', invoice_sent: 'HX0003', invoice_overdue: 'HX0004', homework_due: 'HX0005' },
    });
    expect(twilioConfigFromEnv((k) => ({ ...ENV, TWILIO_WHATSAPP_FROM: '+971500000001' })[k])?.from).toBe('+971500000001');
  });
  it.each(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'])('is null without %s', (missing) => {
    expect(twilioConfigFromEnv((k) => (k === missing ? undefined : ENV[k]))).toBeNull();
    expect(twilioConfigFromEnv((k) => (k === missing ? '  ' : ENV[k]))).toBeNull();
  });
  it('leaves templates without a SID out', () => {
    const c = twilioConfigFromEnv((k) => (k === 'TWILIO_TEMPLATE_HOMEWORK_DUE' ? undefined : ENV[k]));
    expect(c?.contentSids.homework_due).toBeUndefined();
    expect(c?.contentSids.invoice_sent).toBe('HX0003');
  });
});

describe('buildTwilioMessage', () => {
  it('builds the Messages API request', () => {
    const msg = buildTwilioMessage(config, '+971501234567', 'invoice_sent', invoiceVars);
    if (!msg.ok) throw new Error(msg.reason);
    expect(msg.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ENV.TWILIO_ACCOUNT_SID}/Messages.json`);
    expect(msg.init.method).toBe('POST');
    expect(msg.init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const auth = msg.init.headers.Authorization;
    expect(auth.startsWith('Basic ')).toBe(true);
    expect(decodeBasic(auth)).toBe(`${ENV.TWILIO_ACCOUNT_SID}:test-token`);
    const form = new URLSearchParams(msg.init.body);
    expect(form.get('From')).toBe('whatsapp:+971500000000');
    expect(form.get('To')).toBe('whatsapp:+971501234567');
    expect(form.get('ContentSid')).toBe('HX0003');
    expect(JSON.parse(form.get('ContentVariables')!)).toEqual(invoiceVars);
    expect([...form.keys()].sort()).toEqual(['ContentSid', 'ContentVariables', 'From', 'To']);
  });

  it('encodes non-ASCII credentials correctly', () => {
    const msg = buildTwilioMessage({ ...config, authToken: 'tökén' }, '+971501234567', 'invoice_sent', invoiceVars);
    if (!msg.ok) throw new Error(msg.reason);
    expect(decodeBasic(msg.init.headers.Authorization)).toBe(`${ENV.TWILIO_ACCOUNT_SID}:tökén`);
  });

  it('cleans variables before sending', () => {
    const msg = buildTwilioMessage(config, '+971501234567', 'homework_due', { '1': ' Mona ', '2': 'Omar', '3': 'Wed 8 Oct', '4': 'Read\nchapter    3' });
    if (!msg.ok) throw new Error(msg.reason);
    expect(JSON.parse(new URLSearchParams(msg.init.body).get('ContentVariables')!)).toEqual({
      '1': 'Mona',
      '2': 'Omar',
      '3': 'Wed 8 Oct',
      '4': 'Read chapter 3',
    });
  });

  it('refuses when the template SID is not set', () => {
    const msg = buildTwilioMessage({ ...config, contentSids: {} }, '+971501234567', 'invoice_sent', invoiceVars);
    expect(msg).toEqual({ ok: false, reason: expect.stringContaining('TWILIO_TEMPLATE_INVOICE_SENT') });
  });

  it('refuses an unknown template', () => {
    expect(buildTwilioMessage(config, '+971501234567', 'promotion', invoiceVars).ok).toBe(false);
  });

  it.each(['0501234567', '971501234567', '+0501234567', '+97150', '', '+97150 123 4567'])('refuses the number %p', (to) => {
    const msg = buildTwilioMessage(config, to, 'invoice_sent', invoiceVars);
    expect(msg).toEqual({ ok: false, reason: expect.stringContaining('international format') });
  });

  it('refuses when a variable is missing or blank', () => {
    const missing = buildTwilioMessage(config, '+971501234567', 'invoice_sent', { '1': 'Mona', '2': 'INV-0042', '3': 'AED 1,050.00' });
    expect(missing).toEqual({ ok: false, reason: expect.stringContaining('missing variable 4') });
    const blank = buildTwilioMessage(config, '+971501234567', 'invoice_sent', { ...invoiceVars, '2': '  ' });
    expect(blank).toEqual({ ok: false, reason: expect.stringContaining('missing variable 2') });
    expect(buildTwilioMessage(config, '+971501234567', 'invoice_sent', null).ok).toBe(false);
  });

  it('refuses anything that looks like bank details', () => {
    const msg = buildTwilioMessage(config, '+971501234567', 'homework_due', { '1': 'Mona', '2': 'Omar', '3': 'Wed 8 Oct', '4': 'Pay to IBAN AE070331234567890123456' });
    expect(msg).toEqual({ ok: false, reason: expect.stringContaining('bank details') });
  });
});

describe('readTwilioResult', () => {
  it('reads the message SID from a 201', () => {
    expect(readTwilioResult(201, JSON.stringify({ sid: 'SM123', status: 'queued' }))).toEqual({ ok: true, sid: 'SM123' });
  });
  it('treats a 2xx without a SID as a permanent failure', () => {
    expect(readTwilioResult(201, 'not json')).toEqual({ ok: false, retry: false, error: expect.stringContaining('no message sid') });
  });
  it('reports a permanent 400 with the Twilio code and message', () => {
    const r = readTwilioResult(400, JSON.stringify({ code: 21211, message: "The 'To' number is not a valid phone number.", status: 400 }));
    expect(r).toEqual({ ok: false, retry: false, error: expect.stringContaining('21211') });
    if (!r.ok) expect(r.error).toContain('not a valid phone number');
  });
  it.each([63016, 21610])('treats code %d as permanent', (code) => {
    expect(readTwilioResult(400, JSON.stringify({ code, message: 'Refused' }))).toEqual({ ok: false, retry: false, error: expect.stringContaining(String(code)) });
  });
  it('retries 429 and 5xx', () => {
    expect(readTwilioResult(429, JSON.stringify({ code: 20429, message: 'Too Many Requests' }))).toMatchObject({ ok: false, retry: true });
    expect(readTwilioResult(500, '')).toMatchObject({ ok: false, retry: true });
    expect(readTwilioResult(503, '<html>Service Unavailable</html>')).toEqual({ ok: false, retry: true, error: expect.stringContaining('Service Unavailable') });
  });
  it('handles a non-JSON 4xx body', () => {
    expect(readTwilioResult(401, 'Unauthorized')).toEqual({ ok: false, retry: false, error: 'Twilio 401 Unauthorized' });
  });
});
