// Public: signed-out, read-only checks that need no test accounts. The sign-in screen and the website pages load
// at 390px and 1280px with no console errors or sideways scrolling, a deep link while signed out lands on the
// sign-in screen, Apple and Google buttons appear only for providers the live project has switched on, "Continue
// with Google" (when switched on) goes through the Supabase authorize endpoint to accounts.google.com, and the app
// talks to the live Supabase project. Nothing is submitted and nobody signs in. Usage: node public.js
const { run } = require('./lib');
const { checkGoogleRedirect, checkProviderButtons, readProviders } = require('./google');

const SITE = (process.env.SITE || process.env.LIVE_SITE || (process.env.DEMO === '1' ? '' : 'https://eliteeducationuae.github.io')).replace(/\/+$/, '');
const SITE_PAGES = ['/', '/privacy/', '/terms/', '/support/'];

run('public', { need: [] }, async (h) => {
  const { config } = h;
  const supabaseHost = new URL(config.supabaseUrl).host;
  const supabase = [];
  const watch = () =>
    h.page.on('response', (r) => {
      if (new URL(r.url()).host === supabaseHost) supabase.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    });

  for (const width of [390, 1280]) {
    h.step(`sign-in screen at ${width}px`);
    await h.open(width);
    watch();
    const before = h.consoleErrors.length;
    await h.go('/sign-in', 4000);
    const text = await h.bodyText();
    h.ok(/Private tutoring of distinction/.test(text), 'the sign-in screen shows');
    h.ok(config.DEMO ? /Demo mode/.test(text) : !/Demo mode/.test(text), config.DEMO ? 'DEMO: the demo banner shows' : 'this is the live build (no demo banner)');
    if (config.DEMO) h.ok((await h.button('Continue with Google').count()) > 0 && (await h.button('Continue with Apple').count()) > 0, 'DEMO: Apple and Google buttons are offered');
    else await checkProviderButtons(h, await readProviders(h), `@${width}: `);
    if (!config.DEMO) h.ok((await h.box('Email').count()) > 0 && (await h.box('Password').count()) > 0, 'email and password fields are offered');
    const wide = await h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    h.ok(wide <= 1, `no sideways scrolling (${wide}px)`);
    const errs = h.errorsSince(before);
    h.ok(!errs.length, `no console errors${errs.length ? `: ${errs.map((e) => e.text).join(' | ').slice(0, 300)}` : ''}`);
    await h.shot(`sign-in-${width}`);

    const beforeDeep = h.consoleErrors.length;
    await h.go('/parent/billing', 4000);
    h.ok(/sign-in/.test(new URL(h.page.url()).pathname), `a deep link while signed out lands on the sign-in screen (${new URL(h.page.url()).pathname})`);
    const deepErrs = h.errorsSince(beforeDeep);
    h.ok(!deepErrs.length, `no console errors on the deep link${deepErrs.length ? `: ${deepErrs[0].text.slice(0, 200)}` : ''}`);
  }

  h.step('website pages');
  if (!SITE) h.skip('SITE is not set, so the website pages were not checked.');
  for (const width of SITE ? [390, 1280] : []) {
    await h.open(width);
    for (const p of SITE_PAGES) {
      const before = h.consoleErrors.length;
      // The local test server does not map a folder to its index.html the way GitHub Pages does.
      const res = await h.goto(SITE + p + (/localhost|127\.0\.0\.1/.test(SITE) && p.endsWith('/') && p !== '/' ? 'index.html' : ''));
      await h.page.waitForTimeout(1500);
      const wide = await h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const errs = h.errorsSince(before);
      const title = await h.page.title();
      h.ok(res && res.status() < 400 && !errs.length && wide <= 1, `${SITE}${p} @${width}: HTTP ${res && res.status()}, "${title}"${errs.length ? `, ${errs.length} console error(s): ${errs[0].text.slice(0, 160)}` : ''}${wide > 1 ? `, scrolls sideways by ${wide}px` : ''}`);
    }
  }

  h.step('Continue with Google');
  await h.open(1280);
  watch();
  await h.go(config.DEMO ? '/' : '/sign-in', 3000);
  await checkGoogleRedirect(h);

  h.step('the app talks to the live Supabase project');
  if (config.DEMO) h.skip('DEMO: the demo build never contacts Supabase.');
  else {
    // The public auth settings say which sign-in methods the live project has switched on (read-only).
    // The app hides a switched-off provider's button (checked above), so a provider being off is reported, not failed.
    const settings = await readProviders(h);
    h.ok(settings.status === 200, `auth settings answered HTTP ${settings.status}`);
    if (settings.status === 200) {
      h.ok(settings.email === true, 'email and password sign-in is enabled');
      h.note(`Google sign-in is ${settings.google ? 'enabled' : 'NOT enabled'} in the live Supabase project`);
      h.note(`Apple sign-in is ${settings.apple ? 'enabled' : 'NOT enabled'} in the live Supabase project`);
      supabase.push('200 GET /auth/v1/settings');
    }
    const reached = supabase.filter((s) => !/^5/.test(s));
    h.ok(reached.length > 0, `${supabaseHost} answered ${supabase.length} request(s): ${[...new Set(supabase)].slice(0, 6).join('; ')}`);
  }
});
