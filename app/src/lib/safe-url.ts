/**
 * Checks for web addresses that come from people (meeting links, resource links, attachments) before the app opens
 * them. Only ordinary web pages are opened; javascript:, data:, file: and similar addresses are refused, as are
 * addresses with a user name or password in them.
 */

/** The address as an absolute http(s) URL, or null. With `httpsOnly`, plain http is refused too. */
export function safeWebUrl(input: string | null | undefined, options: { httpsOnly?: boolean } = {}): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const match = /^(https?):\/\/([^/?#\\]+)([/?#].*)?$/i.exec(trimmed);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  if (options.httpsOnly && scheme !== 'https') return null;
  const authority = match[2];
  if (authority.includes('@')) return null;
  const host = authority.replace(/:\d{1,5}$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(host) && !/^\[[0-9a-f:.]+\]$/i.test(host)) return null;
  return `${scheme}://${authority}${match[3] ?? ''}`;
}

/** An online lesson's meeting link, which must be https (Google Meet, Zoom, Teams and the like). */
export function safeMeetingUrl(input: string | null | undefined): string | null {
  return safeWebUrl(input, { httpsOnly: true });
}

/**
 * A meeting link as typed by a tutor or the office: https:// is added when no scheme is given. Returns null when
 * it is not a usable https address.
 */
export function normaliseMeetingUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hostWithPort = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(trimmed);
  const hasScheme = !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  const url = safeMeetingUrl(candidate);
  // A host without a dot ("meet") is almost certainly a typing slip.
  if (!url || !/^https:\/\/[^/?#]*\./i.test(url)) return null;
  return url;
}
