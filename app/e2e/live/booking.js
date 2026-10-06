// Booking helpers shared by lessons.js, calendar.js and payments.js: the admin books a one-off lesson for the
// test student with the test tutor, with the subject set to "E2E-<runid> ..." so it is easy to spot and clean up.

/** A quiet, unlikely-to-clash slot: `days` ahead, early in the morning, minutes from the run id. */
function slot(h, days, attempt = 0) {
  const { dateKey } = require('./lib');
  const n = parseInt(h.config.runId.replace(/\D/g, '').slice(-4) || '0', 10) + attempt * 5;
  const hour = 6 + (n % 3);
  const minute = [0, 15, 30, 45][n % 4];
  return { date: dateKey(days), time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

/** Choose a chip whose label starts with `name`, refusing anything that is not a test record on the live app. */
async function chooseChip(h, name, what) {
  const chip = h.text(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( · .*)?$`)).first();
  await chip.waitFor({ timeout: 20000 });
  const label = (await chip.innerText()).trim();
  if (!h.config.DEMO && !/e2e/i.test(label)) throw new Error(`Refusing to choose ${what} "${label}": it is not an E2E test record.`);
  await chip.click();
  await h.page.waitForTimeout(500);
  return label;
}

/**
 * Admin (already signed in) books one lesson. Returns { subject, date, time, lessonId }.
 * `location` is 'online' (no link given, so Google Calendar can add a Meet link) or 'in-person'.
 */
async function bookLesson(h, { label, days = 21, location = 'online' }) {
  const subject = h.tag(label);
  let when = slot(h, days);
  await h.go('/lesson/new');
  await h.box('Find student').waitFor({ timeout: 20000 });
  await h.fill('Find student', h.config.student);
  await chooseChip(h, h.config.student, 'student');
  await h.click('Other subject…', true);
  await h.text('Other…', true).first().click();
  await h.page.waitForTimeout(300);
  await h.fill('Other subject, please specify', subject);
  const tutorLabel = await chooseChip(h, h.config.tutor, 'tutor');
  if (/checks needed/i.test(tutorLabel)) h.note(`The test tutor shows "${tutorLabel}"; booking may be refused until their checks are complete.`);
  const serviceName = process.env.E2E_SERVICE_NAME;
  const services = h.page.getByText(/ · \d+m · AED /).filter({ visible: true });
  if (serviceName) await h.text(new RegExp(`^${serviceName}`)).first().click();
  else await services.first().click();
  await h.page.waitForTimeout(300);
  await h.text('One-off', true).first().click();
  await h.text(location === 'online' ? 'Online' : 'In person', true).first().click();
  if (location === 'in-person') await h.fill('Address', `${subject}: test lesson, not a real visit`);
  // Never book over another lesson or a Google busy time: move on to another early-morning slot instead.
  for (let attempt = 0; ; attempt++) {
    when = slot(h, days + attempt, attempt);
    await h.fill('First lesson date', when.date);
    await h.fill('Start time', when.time);
    await h.page.waitForTimeout(1200);
    if (await h.has('No clashes with existing lessons.')) break;
    if (attempt >= 6) throw new Error('Could not find a free slot for the test lesson in seven tries.');
  }
  await h.button(/^Schedule 1 lesson$/).last().click();
  // The form goes back when the lesson is saved. Opened directly (no history), it stays put, so the check is
  // that no refusal is shown; findLesson below proves the lesson exists.
  await h.page.waitForURL((u) => !/\/lesson\/new/.test(u.pathname), { timeout: 8000, waitUntil: 'commit' }).catch(() => undefined);
  if (/\/lesson\/new/.test(h.page.url())) {
    const refusal = (await h.bodyText()).match(/[^\n]*(could not|cannot|refused|not allowed|before they can teach)[^\n]*/i);
    if (refusal) throw new Error(`Booking was refused: ${refusal[0]}`);
  }
  await h.page.waitForTimeout(1200);
  const lessonId = await findLesson(h, subject);
  h.record('lesson', { lessonId, subject, ...when, location });
  return { subject, lessonId, ...when };
}

/** Open the test student's page and click the lesson with this subject; returns its id (from the address). */
async function findLesson(h, subject) {
  await h.go('/admin/students');
  await h.text(h.config.student, true).first().click();
  await h.page.waitForTimeout(1500);
  const card = h.text(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).first();
  await card.waitFor({ timeout: 20000 });
  await card.click();
  await h.page.waitForURL(/\/lesson\/[^/]+$/, { timeout: 20000, waitUntil: 'commit' });
  const id = decodeURIComponent(new URL(h.page.url()).pathname.split('/').pop());
  await h.page.waitForTimeout(800);
  return id;
}

module.exports = { bookLesson, findLesson, chooseChip, slot };
