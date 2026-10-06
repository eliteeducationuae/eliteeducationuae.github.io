// Smoke: every main screen for each test role loads at 390px and 1280px with no console errors, no error
// screen and no sideways scrolling; System health shows working jobs and the database version that matches the
// newest migration file in this repository. Read-only. Usage: node smoke.js
const { run } = require('./lib');
const { expectedDbVersion } = require('./config');

const SCREENS = {
  admin: ['/admin', '/admin/calendar', '/admin/students', '/admin/billing', '/admin/money', '/admin/insights', '/admin/reports', '/admin/more', '/messages', '/manage/system-health'],
  tutor: ['/tutor', '/tutor/calendar', '/tutor/students', '/tutor/messages', '/tutor/account'],
  parent: ['/parent', '/parent/progress', '/parent/messages', '/parent/billing', '/parent/account'],
};
const BROKEN = /Something went wrong|This screen could not be shown|Unmatched Route|Page not found/i;

run('smoke', { need: ['admin', 'tutor', 'parent'] }, async (h) => {
  for (const width of [390, 1280]) {
    for (const role of Object.keys(SCREENS)) {
      h.step(`${role} at ${width}px`);
      await h.open(width);
      await h.signIn(role);
      for (const path of SCREENS[role]) {
        const before = h.consoleErrors.length;
        await h.go(path, 3000);
        const text = await h.bodyText();
        const errs = h.errorsSince(before);
        const wide = await h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const ok = !BROKEN.test(text) && !errs.length && wide <= 1 && text.trim().length > 40;
        h.ok(ok, `${role} ${path} @${width}${ok ? '' : `: ${BROKEN.test(text) ? 'error screen; ' : ''}${errs.length ? `${errs.length} console error(s): ${errs[0].text.slice(0, 160)}; ` : ''}${wide > 1 ? `scrolls sideways by ${wide}px; ` : ''}${text.trim().length <= 40 ? 'blank page' : ''}`}`);
        if (!ok) await h.shot(`${role}${path.replace(/\//g, '_')}-${width}`);
      }
      await h.signOut(role);
    }
  }

  h.step('System health');
  await h.open(1280);
  await h.signIn('admin');
  await h.go('/manage/system-health', 4000);
  await h.waitText('Scheduled jobs', { timeout: 30000 });
  const text = await h.bodyText();
  await h.shot('system-health');

  // Jobs: each listed job's badge follows its name and one-line summary.
  const jobsBlock = (text.split(/Scheduled jobs/i)[1] || '').split(/Database version/i)[0];
  const jobLines = jobsBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  const badges = jobLines.filter((l) => /^(Working|Failing|Not run yet|Needs attention)$/i.test(l));
  h.ok(badges.length > 0, `System health lists ${badges.length} scheduled job(s)`);
  for (let i = 0; i < jobLines.length; i++) {
    if (!/^(Failing|Not run yet|Needs attention)$/i.test(jobLines[i])) continue;
    h.fail(`job "${jobLines[i - 2] || jobLines[i - 1]}" is ${jobLines[i]}: ${jobLines[i - 1]}`);
  }
  if (badges.length && badges.every((b) => /^Working$/i.test(b))) h.ok(true, 'every scheduled job is Working (green)');

  // Checks are reported; a Failing check fails the run, "Needs attention" is a note.
  const checksBlock = (text.split(/\bChecks\b/i)[1] || '').split(/Scheduled jobs/i)[0];
  const checkLines = checksBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < checkLines.length; i++) {
    if (/^Failing$/i.test(checkLines[i])) h.fail(`check "${checkLines[i - 2]}" is Failing: ${checkLines[i - 1]}`);
    if (/^Needs attention$/i.test(checkLines[i])) h.note(`check "${checkLines[i - 2]}" needs attention: ${checkLines[i - 1]}`);
  }
  h.note(`Overall: ${(text.match(/All systems are working normally|\d+ items? needs? your attention/) || ['(headline not found)'])[0]}`);

  const want = expectedDbVersion();
  const shown = (text.split(/Latest migration/i)[1] || '').match(/\d{14}/);
  h.ok(shown && shown[0] === want.version, `database version is ${shown ? shown[0] : 'not shown'}; the newest migration in the repo is ${want.version}_${want.name}`);
  await h.signOut('admin');
});
