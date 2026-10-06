// Cleanup: as the test admin, through the app, undo what one run created (everything tagged "E2E-<runid>").
//   - Scheduled test lessons are cancelled (more than the notice period ahead, so no charge).
//   - Recorded test lessons cannot be cancelled or deleted: they stay on the E2E student as history.
//   - Their charges, if still uninvoiced, are invoiced to the E2E family and fully credited with a credit note
//     (lessons are not released to be invoiced again), so nothing is left waiting to be invoiced.
//   - Issued invoices can never be deleted (tax records). Unpaid ones are fully credited with a credit note;
//     paid ones have the rest of the payment refunded (Stripe TEST mode) with a credit note, so each nets to zero.
// Usage: node cleanup.js [runid]   (defaults to E2E_RUN_ID; run-all.sh passes it)
const { run, readLedger, config } = require('./lib');

const runIdArg = process.argv[2];
if (runIdArg) process.env.E2E_RUN_ID = runIdArg;

const money = (s) => parseFloat(String(s).replace(/[^\d.]/g, ''));

async function cancelLesson(h, lessonId) {
  await h.go(`/lesson/${encodeURIComponent(lessonId)}`, 2500);
  const body = await h.bodyText();
  if (!h.config.DEMO && !/Subject: E2E-/i.test(body)) return h.fail(`lesson ${lessonId} is not an E2E lesson; left untouched`);
  if ((await h.button('Cancel lesson').count()) === 0) {
    h.note(`lesson ${lessonId} was recorded (or already cancelled), so it stays on the E2E student as history.`);
    return;
  }
  await h.press('Cancel lesson');
  await h.fill('Reason', `${h.tag('cleanup')}: automated test lesson removed`);
  h.dialogs.length = 0;
  await h.press('Yes, cancel the lesson', { wait: 2000 });
  h.ok(h.dialogs.some((m) => /Lesson cancelled/.test(m)) || /cancelled/i.test(await h.bodyText()), `lesson ${lessonId} cancelled`);
  h.ok(!h.dialogs.some((m) => /late-cancellation charge has been added/.test(m)), `no charge for cancelling ${lessonId}`);
}

/** Credit whatever is left on an issued, unpaid invoice ("An amount", lessons not released). */
async function creditRest(h, invoiceId) {
  await h.go(`/credit-note/new?invoiceId=${encodeURIComponent(invoiceId)}`, 2500);
  const left = money(((await h.bodyText()).match(/AED [\d,.]+(?= left to credit)/i) || [])[0] || '0');
  if (!left) return h.note(`invoice ${invoiceId}: nothing left to credit`);
  await h.text('An amount', true).first().click();
  await h.fill('Amount to credit, including VAT (AED)', left.toFixed(2));
  await h.fill('Reason', `${h.tag('cleanup')}: automated test invoice credited in full`);
  h.dialogs.length = 0;
  await h.press(/^Issue credit note for/, { wait: 2500 });
  h.ok(/\/credit-note\/[^/]+$/.test(h.page.url()) && !/\/new/.test(h.page.url()), `invoice ${invoiceId}: credit note issued for AED ${left.toFixed(2)}`);
}

/** Refund the rest of every card or other payment on a paid invoice, with a credit note. */
async function refundRest(h, invoiceId) {
  for (let i = 0; i < 3; i++) {
    await h.go(`/invoice/${encodeURIComponent(invoiceId)}`, 2500);
    const btn = h.button('Refund');
    if ((await btn.count()) === 0) return;
    await btn.first().click();
    await h.box('Amount to refund (AED)').waitFor({ timeout: 20000 });
    const can = money(((await h.bodyText()).match(/Can be refunded\s*\n?\s*(AED [\d,.]+)/i) || [])[1] || '0');
    if (!can) return;
    await h.fill('Amount to refund (AED)', can.toFixed(2));
    await h.fill('Reason', `${h.tag('cleanup')}: automated test payment returned`);
    h.dialogs.length = 0;
    await h.press(/^Refund AED/, { wait: 3000 });
    h.ok(h.dialogs.some((m) => /Refund (recorded|requested)/.test(m)), `invoice ${invoiceId}: refunded the remaining AED ${can.toFixed(2)} with a credit note`);
  }
}

run('cleanup', { need: ['admin'] }, async (h) => {
  const ledger = readLedger(config.runId);
  h.log(`ledger for run ${config.runId}: ${ledger.length} entries`);
  if (!ledger.length) h.note('Nothing was recorded for this run id.');
  // Live: one pass over everything. Demo: each script's data lives in its own saved browser database.
  const groups = h.config.DEMO ? [...new Set(ledger.map((e) => e.script))].map((s) => [s, ledger.filter((e) => e.script === s)]) : [['all', ledger]];
  for (const [script, entries] of groups) {
    if (h.config.DEMO) {
      h.step(`DEMO: reopening the demo data saved by ${script}.js`);
      if (!(await h.loadDemoDb(script))) {
        h.skip(`DEMO: no saved demo data for ${script}.js`);
        continue;
      }
    }
    await clean(h, entries);
  }
  h.note('Kept by design: recorded lessons and their notes and homework, invoices and credit notes (permanent tax records), refunds, and the notification history.');
});

async function clean(h, ledger) {
  await h.signIn('admin');

  h.step('lessons');
  const lessons = [...new Set(ledger.filter((e) => e.kind === 'lesson').map((e) => e.lessonId))];
  for (const id of lessons) await cancelLesson(h, id);

  h.step('uninvoiced charges for the test family');
  await h.go('/admin/billing', 2500);
  const card = h.page
    .getByText(h.config.family, { exact: true })
    .filter({ visible: true })
    .first()
    .locator('xpath=ancestor::*[.//*[@role="button" or self::button][contains(., "Create invoice")]][1]');
  const invoices = ledger.filter((e) => e.kind === 'invoice').map((e) => e.invoiceId);
  const recorded = ledger.some((e) => e.kind === 'lesson-recorded');
  if ((await card.count()) && recorded) {
    await card.getByText('Create invoice', { exact: true }).click();
    await h.page.waitForURL(/\/invoice\/[^/]+$/, { timeout: 30000, waitUntil: 'commit' });
    const id = decodeURIComponent(new URL(h.page.url()).pathname.split('/').pop());
    h.record('invoice', { invoiceId: id, purpose: 'cleanup of uninvoiced test lessons' });
    invoices.push(id);
    h.ok(true, `invoiced the test family's uninvoiced test lessons (${id}) so they can be credited`);
  } else h.ok(true, 'nothing of the test family is waiting to be invoiced');

  h.step('invoices');
  for (const id of [...new Set(invoices)]) {
    await h.go(`/invoice/${encodeURIComponent(id)}`, 2500);
    const t = await h.bodyText();
    if (!h.config.DEMO && !t.includes(h.config.family)) {
      h.fail(`invoice ${id} is not for ${h.config.family}; left untouched`);
      continue;
    }
    if ((await h.button('Refund').count()) > 0) await refundRest(h, id);
    await h.go(`/invoice/${encodeURIComponent(id)}`, 2500);
    if ((await h.button('Issue credit note').count()) > 0) await creditRest(h, id);
    await h.go(`/invoice/${encodeURIComponent(id)}`, 2500);
    h.ok((await h.button('Issue credit note').count()) === 0 && (await h.button('Refund').count()) === 0, `invoice ${id} is fully credited and nothing is left to refund`);
  }
  await h.signOut('admin');
}
