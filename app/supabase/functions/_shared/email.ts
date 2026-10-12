// Pure helpers for the notification emails sent through Resend, unit-tested with Jest.
// No imports and no Deno globals: this file is also compiled by the app's TypeScript and Jest.

/** Escapes text for HTML element content and double- or single-quoted attributes. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * A subject line that is one line only. Line breaks and other control characters (which could add email headers in a
 * careless mail system) become spaces, and it is kept to a sensible length.
 */
export function emailSubject(subject: unknown): string {
  const clean = String(subject ?? '')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean || 'Elite Education').slice(0, 200);
}

/** True for one plain email address (no display name, list or line break), as the outbox should hold. */
export function isSingleEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@,;<>"()\\]+@[^\s@,;<>"()\\]+\.[^\s@,;<>"()\\]+$/.test(email);
}

/**
 * The full link for a notification's in-app path, e.g. '/invoice/<id>' under APP_URL. Only a path inside the app is
 * linked (it must start with a single '/'), so a stored value can never point an email button somewhere else.
 */
export function appLink(appUrl: string, path: unknown): string | undefined {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\s\\]/.test(path)) return undefined;
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/** The branded HTML email. Every piece of text, including the link, is escaped. */
export function emailHtml(subject: string, body: string, link?: string): string {
  const paragraphs = escapeHtml(body ?? '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  // Brand palette (matches src/lib/pdf-brand.ts): Noir Black, Champagne Gold as a hairline only, Ivory Cream, Georgia and Calibri.
  const serif = "Georgia,'Times New Roman',serif";
  const sans = "Calibri,Carlito,'Segoe UI',Arial,sans-serif";
  return `<!doctype html><html><body style="margin:0;background:#F9F8F5;font-family:${sans};color:#0A0A0A">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#0A0A0A;color:#FFFFFF;padding:20px 24px;border-bottom:2px solid #C9A84C;font-family:${serif};font-size:20px;letter-spacing:0.5px">Elite Education</div>
    <div style="background:#FFFFFF;border:1px solid #E5E0D4;border-top:0;padding:24px;font-size:15px;line-height:1.6">
      <h2 style="margin:0 0 16px;font-family:${serif};font-weight:700;font-size:19px;color:#0A0A0A">${escapeHtml(subject)}</h2>
      ${paragraphs}
      ${link ? `<p style="margin:20px 0 0"><a href="${escapeHtml(link)}" style="background:#0A0A0A;color:#FFFFFF;border:1px solid #C9A84C;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:700">Open in the app</a></p>` : ''}
    </div>
    <p style="color:#6B6B6B;font-size:12px;text-align:center;letter-spacing:0.5px">Elite Education | eliteeducation.me</p>
  </div></body></html>`;
}
