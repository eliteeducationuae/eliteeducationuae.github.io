// WhatsApp message templates and Twilio request/response mapping.
// Pure module: no imports and no Deno globals, so it runs in Edge Functions and in the app's Jest tests
// (src/lib/__tests__/whatsapp-twilio.test.ts).
//
// Every body below must match the template approved in Twilio's Content Template Builder exactly,
// and the database preview of the same template. Bank details are never sent.

export type WhatsAppTemplate =
  | 'lesson_reminder'
  | 'lesson_notes'
  | 'invoice_sent'
  | 'invoice_autopay'
  | 'invoice_overdue'
  | 'homework_due';

export interface WhatsAppTemplateInfo {
  /** Human name, also used in the README. */
  label: string;
  /** Supabase secret holding the approved Twilio Content SID (HX…). */
  envVar: string;
  /** Approved body with {{1}}..{{n}} placeholders. */
  body: string;
  /** What each variable holds, in order ({{1}} first). */
  variables: string[];
  /** Sample values submitted with the template for approval. */
  sample: Record<string, string>;
}

const FOOTER = 'Elite Education | eliteeducation.me';

export const WHATSAPP_TEMPLATES: Record<WhatsAppTemplate, WhatsAppTemplateInfo> = {
  lesson_reminder: {
    label: 'Lesson reminder',
    envVar: 'TWILIO_TEMPLATE_LESSON_REMINDER',
    body: `Dear {{1}}, this is a reminder of the lesson for {{2}} with {{3}} on {{4}} (UAE time). ${FOOTER}`,
    variables: ['Recipient first name', 'Student first names', 'Tutor name (or "you" for the tutor)', 'Lesson day and time'],
    sample: { '1': 'Mona', '2': 'Omar', '3': 'Ms Sarah Khan', '4': 'Tue 7 Oct, 16:00' },
  },
  lesson_notes: {
    label: 'Lesson notes ready',
    envVar: 'TWILIO_TEMPLATE_LESSON_NOTES',
    body: `Dear {{1}}, the lesson notes for {{2}} from {{3}} are now ready in the Elite Education app. ${FOOTER}`,
    variables: ['Recipient first name', 'Student first names', 'Lesson date'],
    sample: { '1': 'Mona', '2': 'Omar', '3': '7 Oct' },
  },
  invoice_sent: {
    label: 'Invoice sent',
    envVar: 'TWILIO_TEMPLATE_INVOICE_SENT',
    body: `Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app and is due by {{4}}. ${FOOTER}`,
    variables: ['Recipient first name', 'Invoice number', 'Amount', 'Due date'],
    sample: { '1': 'Mona', '2': 'INV-0042', '3': 'AED 1,050.00', '4': '15 Oct 2026' },
  },
  invoice_autopay: {
    label: 'Invoice sent (autopay)',
    envVar: 'TWILIO_TEMPLATE_INVOICE_AUTOPAY',
    body:
      `Dear {{1}}, invoice {{2}} for {{3}} is now available in the Elite Education app. ` +
      `As autopay is on, it will be paid automatically from your saved {{4}}. ${FOOTER}`,
    variables: ['Recipient first name', 'Invoice number', 'Amount', 'Saved card, e.g. "Visa ending 4242"'],
    sample: { '1': 'Mona', '2': 'INV-0042', '3': 'AED 1,050.00', '4': 'Visa ending 4242' },
  },
  invoice_overdue: {
    label: 'Invoice overdue',
    envVar: 'TWILIO_TEMPLATE_INVOICE_OVERDUE',
    body:
      `Dear {{1}}, invoice {{2}} for {{3}} was due on {{4}} and remains unpaid. ` +
      `You may view and pay it in the Elite Education app. If you have already paid, please disregard this message. ${FOOTER}`,
    variables: ['Recipient first name', 'Invoice number', 'Amount', 'Due date'],
    sample: { '1': 'Mona', '2': 'INV-0042', '3': 'AED 1,050.00', '4': '15 Oct 2026' },
  },
  homework_due: {
    label: 'Homework due',
    envVar: 'TWILIO_TEMPLATE_HOMEWORK_DUE',
    body: `Dear {{1}}, this is a reminder that {{2}} has homework due on {{3}}: {{4}}. ${FOOTER}`,
    variables: ['Recipient first name', 'Student first name', 'Due date', 'Homework title'],
    sample: { '1': 'Mona', '2': 'Omar', '3': 'Wed 8 Oct', '4': 'Quadratic equations worksheet' },
  },
};

export function isWhatsAppTemplate(x: unknown): x is WhatsAppTemplate {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(WHATSAPP_TEMPLATES, x);
}

const MAX_VARIABLE_LENGTH = 300;

/** Meta rejects empty, multi-line and 4+ space variables: make every value a tidy single line. */
export function cleanVariable(v: unknown): string {
  const s = String(v ?? '')
    // Template braces never pass through, so a value cannot add a placeholder of its own.
    .replace(/\{\{|\}\}/g, '')
    .replace(/[\r\n\t\v\f]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const capped = s.length > MAX_VARIABLE_LENGTH ? s.slice(0, MAX_VARIABLE_LENGTH).trimEnd() : s;
  return capped || '-';
}

/** The message as the recipient will read it (for logs and tests). */
export function renderWhatsApp(template: WhatsAppTemplate, vars: Record<string, unknown>): string {
  return WHATSAPP_TEMPLATES[template].body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => cleanVariable(vars?.[n]));
}

const BANK_WORDS = /\b(?:IBAN|SWIFT|BIC|account\s+number|sort\s+code)\b/i;
const UAE_IBAN = /\bAE\d{2}(?:\s?\d){10,}/i;

/** Guard: never send anything that looks like bank details over WhatsApp. */
export function looksLikeBankDetails(text: string): boolean {
  return BANK_WORDS.test(text) || UAE_IBAN.test(text);
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Business WhatsApp number in E.164, without the "whatsapp:" prefix. */
  from: string;
  contentSids: Partial<Record<WhatsAppTemplate, string>>;
}

/** Reads the Twilio secrets; null when the account or sender is not configured. */
export function twilioConfigFromEnv(get: (name: string) => string | undefined): TwilioConfig | null {
  const accountSid = get('TWILIO_ACCOUNT_SID')?.trim();
  const authToken = get('TWILIO_AUTH_TOKEN')?.trim();
  const from = get('TWILIO_WHATSAPP_FROM')?.trim().replace(/^whatsapp:/i, '').trim();
  if (!accountSid || !authToken || !from) return null;
  const contentSids: Partial<Record<WhatsAppTemplate, string>> = {};
  for (const key of Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplate[]) {
    const sid = get(WHATSAPP_TEMPLATES[key].envVar)?.trim();
    if (sid) contentSids[key] = sid;
  }
  return { accountSid, authToken, from, contentSids };
}

const E164 = /^\+[1-9]\d{7,14}$/;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of a UTF-8 string (no dependency on btoa's Latin-1 limit). */
function base64(text: string): string {
  const bytes = Array.from(new TextEncoder().encode(text));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63]);
  }
  return out;
}

export type TwilioMessage =
  | { ok: true; url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } }
  | { ok: false; reason: string };

/** Builds the Twilio Messages API request for an approved template, or explains why it must not be sent. */
export function buildTwilioMessage(config: TwilioConfig, to: string, template: string, vars: Record<string, unknown> | null | undefined): TwilioMessage {
  if (!isWhatsAppTemplate(template)) return { ok: false, reason: `Unknown WhatsApp template "${template}"` };
  const info = WHATSAPP_TEMPLATES[template];
  const contentSid = config.contentSids[template];
  if (!contentSid) return { ok: false, reason: `WhatsApp template ${template} is not set up (${info.envVar} is missing)` };
  const number = (to ?? '').replace(/^whatsapp:/i, '').trim();
  if (!E164.test(number)) return { ok: false, reason: 'WhatsApp number is not in international format (for example +971501234567)' };

  const cleaned: Record<string, string> = {};
  for (let i = 1; i <= info.variables.length; i++) {
    const raw = vars?.[String(i)];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return { ok: false, reason: `WhatsApp template ${template} is missing variable ${i} (${info.variables[i - 1]})` };
    }
    cleaned[String(i)] = cleanVariable(raw);
  }
  if (Object.values(cleaned).some(looksLikeBankDetails)) {
    return { ok: false, reason: 'WhatsApp message refused: it appears to contain bank details' };
  }

  const body = new URLSearchParams({
    From: `whatsapp:${config.from}`,
    To: `whatsapp:${number}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(cleaned),
  }).toString();
  return {
    ok: true,
    url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Basic ${base64(`${config.accountSid}:${config.authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  };
}

export type TwilioResult = { ok: true; sid: string } | { ok: false; retry: boolean; error: string };

/** Interprets Twilio's reply: 2xx gives the message SID; 429 and 5xx are worth retrying; other 4xx are permanent. */
export function readTwilioResult(status: number, text: string): TwilioResult {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  if (status >= 200 && status < 300) {
    const sid = typeof parsed?.sid === 'string' ? parsed.sid : '';
    if (sid) return { ok: true, sid };
    return { ok: false, retry: false, error: `Twilio ${status}: reply had no message sid` };
  }
  const retry = status === 429 || status >= 500;
  const code = parsed?.code;
  const message = typeof parsed?.message === 'string' ? parsed.message : (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const detail = [code !== undefined && code !== null ? `code ${String(code)}` : '', message].filter(Boolean).join(': ');
  return { ok: false, retry, error: `Twilio ${status}${detail ? ` ${detail}` : ''}` };
}
