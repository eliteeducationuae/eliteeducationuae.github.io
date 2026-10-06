// Calendar: is the test tutor's Google Calendar connected? If so, a lesson the admin books gets a Google event
// (lesson_calendar_events.google_event_id) and a Meet link that the app shows as "Join lesson".
// If not, the script says "NOT CONNECTED" clearly and skips the sync checks. Usage: node calendar.js
const { run } = require('./lib');
const { bookLesson } = require('./booking');

async function calendarStatus(h, role) {
  await h.go(h.accountPath(role));
  await h.waitText('Google Calendar', { exact: true, timeout: 20000 });
  await h.text('Google Calendar', true).first().scrollIntoViewIfNeeded();
  await h.page.waitForTimeout(1500);
  for (const s of ['Connected', 'Needs attention', 'Not connected']) if (await h.has(s, true)) return s;
  return 'Unknown';
}

run('calendar', { need: ['admin', 'tutor'] }, async (h) => {
  h.step('tutor: Google Calendar connection');
  await h.signIn('tutor');
  let status = await calendarStatus(h, 'tutor');
  await h.shot('tutor-calendar-card');
  h.ok(status !== 'Unknown', `the tutor's Account screen shows the Google Calendar status ("${status}")`);
  if (status === 'Needs attention') h.fail('the test tutor’s Google Calendar needs attention (reconnect it in the app as the tutor)');

  if (h.config.DEMO && process.env.E2E_DEMO_CALENDAR === 'not-connected' && status === 'Connected') {
    // Dry-run of the "not connected" report: disconnect the demo tutor first.
    await h.press('Disconnect', { wait: 1200 });
    status = await calendarStatus(h, 'tutor');
    h.note(`DEMO: disconnected the demo calendar to rehearse the not-connected report (now "${status}").`);
  } else if (status !== 'Connected' && h.config.DEMO) {
    // The demo pretends to connect, which exercises the connected path end to end without Google.
    h.note(`DEMO: the tutor starts "${status}"; connecting the demo calendar to exercise the connected path.`);
    await h.press('Connect Google Calendar', { wait: 1500 });
    status = await calendarStatus(h, 'tutor');
    h.ok(status === 'Connected', 'DEMO: the calendar now shows Connected');
  }
  await h.signOut('tutor');

  if (status !== 'Connected') {
    h.skip(`NOT CONNECTED: the test tutor (${h.config.roles.tutor.email}) has not connected Google Calendar, so no event or Meet link can be checked. Sign in as the tutor and press "Connect Google Calendar" on the Account screen once.`);
    return;
  }

  h.step('admin books an online lesson with no meeting link');
  await h.signIn('admin');
  const lesson = await bookLesson(h, { label: 'calendar sync test', days: 28, location: 'online' });
  h.ok(!!lesson.lessonId, `lesson ${lesson.lessonId} booked for ${lesson.date} ${lesson.time}`);

  if (h.config.DEMO) {
    // The demo adds Meet links when a calendar is connected, so reconnect after booking to give this lesson one.
    await h.signOut('admin');
    await h.signIn('tutor');
    await h.go(h.accountPath('tutor'));
    await h.text('Google Calendar', true).first().scrollIntoViewIfNeeded();
    await h.press('Disconnect', { wait: 1200 });
    await h.press('Connect Google Calendar', { wait: 1500 });
    h.skip('DEMO: there is no Google event id to read in the demo (lesson_calendar_events is live only).');
  } else {
    h.step('wait for calendar-sync to write the Google event');
    const row = await h.poll(
      async () => {
        const rows = await h.rest(`lesson_calendar_events?lesson_id=eq.${encodeURIComponent(lesson.lessonId)}&select=google_event_id,meet_url,calendar_id,synced_at`);
        return rows && rows.find((r) => r.google_event_id) ? rows.find((r) => r.google_event_id) : null;
      },
      { label: 'the Google event', every: 10000 },
    );
    h.ok(!!row, row ? `Google event ${row.google_event_id} written to ${row.calendar_id} at ${row.synced_at}` : 'a Google event was written for the lesson (none within the wait)');
    h.ok(!!(row && row.meet_url), row && row.meet_url ? `Meet link created: ${row.meet_url}` : 'a Meet link was created for the lesson');
  }

  h.step('the app shows the Meet link');
  const shown = await h.poll(
    async () => {
      await h.go(`/lesson/${encodeURIComponent(lesson.lessonId)}`);
      return (await h.button('Join lesson').count()) > 0;
    },
    { label: 'the Join lesson button', every: 10000 },
  );
  h.ok(shown, 'the lesson page shows "Join lesson" (the Meet link reached the app)');
  await h.shot('lesson-meet');
});
