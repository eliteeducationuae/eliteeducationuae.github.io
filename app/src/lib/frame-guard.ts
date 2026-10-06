/**
 * Clickjacking protection for the web app. GitHub Pages cannot send X-Frame-Options or a CSP frame-ancestors header,
 * and frame-ancestors is ignored in a <meta> policy, so the app refuses to run inside another site's frame itself:
 * it tries to take over the top window and, when the browser does not allow that, blanks the page.
 */
export interface FrameWindow {
  self: unknown;
  top: { location: { href: string } } | null;
  location: { href: string };
  document: { documentElement: { style: { display: string } } };
}

/** Returns true when the page was framed (and has been broken out of or hidden). */
export function guardAgainstFraming(win: FrameWindow | undefined): boolean {
  if (!win) return false;
  let framed: boolean;
  try {
    framed = win.top !== win.self;
  } catch {
    framed = true;
  }
  if (!framed) return false;
  // Hide first, so nothing is clickable even if the top window cannot be redirected.
  win.document.documentElement.style.display = 'none';
  try {
    if (win.top) win.top.location.href = win.location.href;
  } catch {
    // A cross-origin parent usually refuses the navigation; the page simply stays hidden.
  }
  return true;
}
