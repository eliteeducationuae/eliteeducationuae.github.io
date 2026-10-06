import { guardAgainstFraming, type FrameWindow } from '../frame-guard';

function makeWindow(framed: boolean, topNavigates = true) {
  const style = { display: '' };
  const win = {
    location: { href: 'https://eliteeducationuae.github.io/app/' },
    document: { documentElement: { style } },
  } as FrameWindow & { self: unknown };
  win.self = win;
  if (!framed) win.top = win as unknown as FrameWindow['top'];
  else {
    const top = { location: {} as { href: string } };
    Object.defineProperty(top.location, 'href', {
      get: () => 'https://evil.example/',
      set: (v: string) => {
        if (!topNavigates) throw new Error('SecurityError');
        (top as { navigatedTo?: string }).navigatedTo = v;
      },
    });
    win.top = top;
  }
  return { win, style };
}

describe('guardAgainstFraming', () => {
  it('does nothing in a normal tab', () => {
    const { win, style } = makeWindow(false);
    expect(guardAgainstFraming(win)).toBe(false);
    expect(style.display).toBe('');
  });
  it('hides the app and breaks out when framed by another site', () => {
    const { win, style } = makeWindow(true);
    expect(guardAgainstFraming(win)).toBe(true);
    expect(style.display).toBe('none');
    expect((win.top as { navigatedTo?: string }).navigatedTo).toBe('https://eliteeducationuae.github.io/app/');
  });
  it('stays hidden when the browser refuses to navigate the top window', () => {
    const { win, style } = makeWindow(true, false);
    expect(guardAgainstFraming(win)).toBe(true);
    expect(style.display).toBe('none');
  });
  it('is safe without a window', () => {
    expect(guardAgainstFraming(undefined)).toBe(false);
  });
});
