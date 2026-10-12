import { normaliseMeetingUrl, safeMeetingUrl, safeWebUrl } from '../safe-url';

describe('safeWebUrl', () => {
  it('accepts ordinary web addresses', () => {
    expect(safeWebUrl('https://www.bbc.co.uk/bitesize')).toBe('https://www.bbc.co.uk/bitesize');
    expect(safeWebUrl('  HTTP://example.org:8080/a?b=c#d ')).toBe('http://example.org:8080/a?b=c#d');
    expect(safeWebUrl('https://tzahajbulieoalzuzclv.supabase.co/storage/v1/object/sign/x?token=abc')).toBeTruthy();
  });
  it('refuses script, data and other schemes, credentials and malformed hosts', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(document.cookie)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/x',
      'https://user:pass@evil.example',
      'https://good.example@evil.example',
      'https://evil.example\\@good.example',
      'https://exa mple.org',
      'https://',
      '',
      undefined,
      null,
    ]) {
      expect({ bad, url: safeWebUrl(bad) }).toEqual({ bad, url: null });
    }
  });
});

describe('meeting links', () => {
  it('must be https', () => {
    expect(safeMeetingUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(safeMeetingUrl('http://meet.google.com/abc-defg-hij')).toBeNull();
    expect(safeMeetingUrl('javascript:alert(1)')).toBeNull();
  });
  it('adds https:// to a typed address and refuses anything else', () => {
    expect(normaliseMeetingUrl('meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(normaliseMeetingUrl(' https://zoom.us/j/123 ')).toBe('https://zoom.us/j/123');
    expect(normaliseMeetingUrl('http://zoom.us/j/123')).toBeNull();
    expect(normaliseMeetingUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseMeetingUrl('meet')).toBeNull();
    expect(normaliseMeetingUrl('')).toBeNull();
  });
});
