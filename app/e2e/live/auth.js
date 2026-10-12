// Auth: email and password sign-in and sign-out for each test role through the real sign-in screen, a wrong
// password is refused, and "Continue with Google" goes to accounts.google.com with the right client id and
// redirect URI (Google itself is never signed in to). Usage: node auth.js
const { run } = require('./lib');
const { checkGoogleRedirect } = require('./google');

const HOME = { admin: /\/admin(\/|$)/, tutor: /\/tutor(\/|$)/, parent: /\/parent(\/|$)/ };

run('auth', { need: ['admin', 'tutor', 'parent'] }, async (h) => {
  const { page, config } = h;

  for (const role of ['admin', 'tutor', 'parent']) {
    h.step(`${role}: sign in and out`);
    await h.signIn(role);
    h.ok(HOME[role].test(new URL(page.url()).pathname), `${role} lands on their home (${new URL(page.url()).pathname})`);
    await h.go(h.accountPath(role));
    const who = config.DEMO ? config.roles[role].name : config.roles[role].email;
    h.ok((await h.bodyText()).toLowerCase().includes(String(who).toLowerCase()) || (await h.has(config.roles[role].name || '___')), `the account screen belongs to ${who}`);
    await h.signOut(role);
    h.ok(/sign-in/.test(new URL(page.url()).pathname), `${role} is signed out and back on the sign-in screen`);
    await h.go('/', 2500);
    h.ok(!HOME[role].test(new URL(page.url()).pathname), `after signing out, ${role}'s home is no longer reachable`);
  }

  h.step('a wrong password is refused');
  if (config.DEMO) h.skip('DEMO: the demo build has no passwords.');
  else {
    await h.go('/sign-in');
    await h.fill('Email', config.roles.parent.email);
    await h.fill('Password', `wrong-${config.runId}`);
    await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).last().click();
    await page.waitForTimeout(4000);
    h.ok(/sign-in/.test(new URL(page.url()).pathname), 'the wrong password keeps the parent on the sign-in screen');
    h.ok(await h.has(/password|credentials|not recognised|incorrect/i), 'an explanation is shown');
  }

  h.step('Continue with Google');
  await h.open();
  await h.go(config.DEMO ? '/' : '/sign-in', 2500);
  await checkGoogleRedirect(h);
});
