// "Continue with Google" check, shared by auth.js and public.js. The harness never signs in to Google: the
// request to accounts.google.com is caught and answered with a stub page, and only its address is checked.

/** On the sign-in screen (signed out): press Continue with Google and check where it sends the browser. */
async function checkGoogleRedirect(h) {
  const { config, page } = h;
  if (config.DEMO) {
    await h.press('Continue with Google', { wait: 2500 });
    h.ok(/\/parent(\/|$)/.test(new URL(page.url()).pathname), 'DEMO: Continue with Google signs in as the sample parent');
    h.skip('DEMO: the demo build does not redirect to Google, so the client id and redirect URI were not checked.');
    return;
  }
  let authorize = null;
  let authorizeAnswer = null;
  let google = null;
  const onRequest = (req) => {
    const u = req.url();
    if (!authorize && u.startsWith(`${config.supabaseUrl}/auth/v1/authorize`)) authorize = u;
  };
  const onResponse = async (res) => {
    if (!res.url().startsWith(`${config.supabaseUrl}/auth/v1/authorize`) || authorizeAnswer) return;
    authorizeAnswer = { status: res.status(), body: res.status() >= 400 ? await res.text().catch(() => '') : '' };
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  await h.context.route('https://accounts.google.com/**', async (route) => {
    if (!google) google = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Google sign-in (stubbed by the E2E harness)</p>' });
  });
  await h.button('Continue with Google').last().click();
  for (let i = 0; i < 40 && !google; i++) await page.waitForTimeout(500);
  page.off('request', onRequest);
  page.off('response', onResponse);
  await h.context.unroute('https://accounts.google.com/**');

  h.ok(!!authorize, authorize ? `the app went to the Supabase authorize endpoint (${authorize.split('?')[0]})` : 'the app went to the Supabase authorize endpoint');
  if (authorize) {
    const a = new URL(authorize);
    h.ok(a.searchParams.get('provider') === 'google', 'authorize asks for provider=google');
    const back = a.searchParams.get('redirect_to') || '';
    h.ok(back === `${config.base}/`, `authorize returns to the app (redirect_to=${back})`);
  }
  if (authorizeAnswer && authorizeAnswer.status >= 400) {
    h.fail(`Supabase refused the Google sign-in with HTTP ${authorizeAnswer.status}: ${authorizeAnswer.body.slice(0, 200)} (enable the Google provider under Authentication > Sign In / Providers in the Supabase dashboard)`);
    return;
  }
  h.ok(!!google, google ? 'the browser was redirected to accounts.google.com' : 'the browser was redirected to accounts.google.com (no redirect seen)');
  if (!google) return;
  const g = new URL(google);
  // Google sometimes wraps the OAuth request (e.g. /v3/signin/identifier?...&continue=...); unwrap it.
  let params = g.searchParams;
  if (!params.get('client_id')) {
    for (const k of ['continue', 'followup']) {
      const inner = params.get(k);
      if (inner && inner.includes('client_id')) params = new URL(inner).searchParams;
    }
  }
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  h.ok(/\.apps\.googleusercontent\.com$/.test(clientId), `Google client id looks right (${clientId || 'missing'})`);
  if (config.googleClientId) h.ok(clientId === config.googleClientId, 'Google client id matches E2E_GOOGLE_CLIENT_ID');
  else h.note('E2E_GOOGLE_CLIENT_ID is not set, so the client id was only checked for shape.');
  h.ok(redirectUri === `${config.supabaseUrl}/auth/v1/callback`, `Google redirect URI is the Supabase callback (${redirectUri || 'missing'})`);
  h.ok(params.get('response_type') === 'code', 'Google is asked for an authorisation code');
  h.ok(/email/.test(params.get('scope') || ''), `scope includes email (${params.get('scope')})`);
}

module.exports = { checkGoogleRedirect };
