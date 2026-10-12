// Email: the harness cannot read inboxes, so it checks the sending side instead. As the test admin it reads the
// notification outbox rows queued for the test accounts since this run started (lessons recorded, invoices,
// refunds...) and waits for each to be sent without an error, then checks System health's "Emails and push
// notifications" check and the send-notifications job. Run it after the other scripts (run-all.sh does).
// Usage: node email.js
const { run } = require('./lib');

run('email', { need: ['admin'] }, async (h) => {
  const { config } = h;
  await h.signIn('admin');

  h.step('outbox rows for the test accounts since the run started');
  if (config.DEMO) {
    h.skip('DEMO: the demo build has no notification outbox (notification_outbox is live only).');
  } else {
    const emails = ['admin', 'tutor', 'parent'].map((r) => config.roles[r].email).filter(Boolean);
    const list = emails.map((e) => `"${e}"`).join(',');
    const profiles = (await h.rest(`profiles?select=id,email,role&email=in.(${encodeURIComponent(list)})`)) || [];
    h.ok(profiles.length === emails.length, `found ${profiles.length} of ${emails.length} test profiles`);
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const ids = profiles.map((p) => p.id).join(',');
    const since = encodeURIComponent(config.runStartedAt);
    const query = `notification_outbox?select=id,created_at,profile_id,email,subject,send_email,sent_at,attempts,error&created_at=gte.${since}&or=(profile_id.in.(${ids}),email.in.(${encodeURIComponent(list)}))&order=created_at`;
    let rows = (await h.rest(query)) || [];
    h.ok(rows.length > 0, `${rows.length} notification(s) were queued for the test accounts since ${config.runStartedAt}`);
    const parentRows = rows.filter((r) => (byId[r.profile_id] || {}).role === 'parent' || r.email === config.roles.parent.email);
    h.ok(parentRows.length > 0, `the test parent was sent ${parentRows.length} notification(s) (lesson notes, invoice, refund…)`);

    // Wait for the send-notifications job to deliver everything that was queued.
    const done = await h.poll(
      async () => {
        rows = (await h.rest(query)) || [];
        return rows.every((r) => r.sent_at || r.error) ? rows : null;
      },
      { label: 'every outbox row to be sent', every: 15000 },
    );
    for (const r of rows) {
      const who = (byId[r.profile_id] || {}).role || r.email || 'unknown';
      const state = r.error ? `FAILED after ${r.attempts} attempt(s): ${r.error}` : r.sent_at ? `sent ${r.sent_at}${r.send_email ? '' : ' (push only)'}` : 'still waiting';
      h.ok(!!r.sent_at && !r.error, `to ${who}: "${r.subject}" ${state}`);
    }
    if (!done) h.note('Some notifications were still waiting when the harness stopped watching.');
  }

  h.step('System health: notifications');
  await h.go('/manage/system-health', 4000);
  await h.waitText('Scheduled jobs', { timeout: 30000 });
  const text = await h.bodyText();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const at = (label, from = 0) => lines.findIndex((l, i) => i >= from && l.toLowerCase() === label.toLowerCase());
  const check = at('Emails and push notifications');
  h.ok(check >= 0 && /^working$/i.test(lines[check + 2]), `check "Emails and push notifications": ${check >= 0 ? `${lines[check + 2]} · ${lines[check + 1]}` : 'not listed'}`);
  const jobs = at('Scheduled jobs');
  const job = at('Emails and push notifications', jobs);
  h.ok(job >= 0 && /^working$/i.test(lines[job + 2]), `job "Emails and push notifications": ${job >= 0 ? `${lines[job + 2]} · ${lines[job + 1]}` : 'not listed'}`);
  await h.shot('system-health-notifications');
  await h.signOut('admin');
});
