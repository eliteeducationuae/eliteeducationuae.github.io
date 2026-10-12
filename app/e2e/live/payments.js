// Payments: the admin invoices the test family for a recorded test lesson, the parent pays it through Stripe
// Checkout in TEST MODE with card 4242 4242 4242 4242, then the admin refunds part of it with a credit note.
// Aborts at once if Stripe shows live mode. Usage: node payments.js
const { run } = require('./lib');
const { bookLesson } = require('./booking');

const money = (s) => parseFloat(String(s).replace(/[^\d.]/g, ''));
const aed = (n) => `AED ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** Admin: book and record a test lesson, then invoice the test family. Returns { id, number }. */
async function createTestInvoice(h) {
  const lesson = await bookLesson(h, { label: 'payment test lesson', days: 35, location: 'in-person' });
  h.ok(!!lesson.lessonId, `test lesson ${lesson.lessonId} booked`);
  await h.press(/^Record the lesson/);
  await h.box('What we covered').waitFor({ timeout: 20000 });
  await h.fill('What we covered', `${h.tag('payment test')}: automated lesson recorded so that it can be invoiced.`);
  await h.press('Save and send to the family', { wait: 2500 });
  h.record('lesson-recorded', { lessonId: lesson.lessonId });

  await h.go('/admin/billing');
  await h.waitText('Ready to invoice');
  const card = h.page
    .getByText(h.config.family, { exact: true })
    .filter({ visible: true })
    .first()
    .locator('xpath=ancestor::*[.//*[@role="button" or self::button][contains(., "Create invoice")]][1]');
  if ((await card.count()) === 0) {
    throw new Error(`"${h.config.family}" is not under Ready to invoice after recording a lesson. Does the test family hold prepaid lessons? Use a test family without a package.`);
  }
  await card.getByText('Create invoice', { exact: true }).click();
  await h.page.waitForURL(/\/invoice\/[^/]+$/, { timeout: 30000, waitUntil: 'commit' });
  await h.page.waitForTimeout(1500);
  const id = decodeURIComponent(new URL(h.page.url()).pathname.split('/').pop());
  const number = (await h.page.getByText(/^(INV|E2E|[A-Z]{2,4})[-\d/]+/).filter({ visible: true }).first().innerText().catch(() => '')) || id;
  if (await h.has('Send to family', true)) await h.press('Send to family', { wait: 1500 });
  h.record('invoice', { invoiceId: id, number });
  return { id, number };
}

/** Live only: the parent pays on Stripe Checkout. Throws (abort) if the page is not in test mode. */
async function payOnStripe(h, checkout) {
  await checkout.waitForLoadState('domcontentloaded');
  const url = checkout.url();
  h.log(`  checkout ${url.split('#')[0].slice(0, 90)}…`);
  if (/cs_live_/.test(url)) throw new Error('ABORT: Stripe Checkout is in LIVE mode (cs_live_ session). No card details were entered.');
  if (!/checkout\.stripe\.com/.test(url) || !/cs_test_/.test(url)) throw new Error(`ABORT: not a Stripe test-mode Checkout page (${url.slice(0, 80)}). No card details were entered.`);
  await checkout.getByText(/test mode|sandbox/i).first().waitFor({ timeout: 30000 }).catch(() => {
    throw new Error('ABORT: Stripe Checkout does not show a "Test mode" or "Sandbox" badge. No card details were entered.');
  });
  h.ok(true, 'Stripe Checkout is in test mode (cs_test_ session and a test-mode badge)');

  const fillIf = async (sel, value) => {
    const el = checkout.locator(sel).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false)) && !(await el.inputValue().catch(() => ''))) await el.fill(value);
  };
  // Card is sometimes behind a "Card" accordion when other methods are offered.
  const cardTab = checkout.locator('[data-testid="card-accordion-item-button"], button[aria-label*="Card" i]').first();
  if (await cardTab.count()) await cardTab.click().catch(() => undefined);
  await fillIf('#email', h.config.roles.parent.email);
  await checkout.locator('#cardNumber').waitFor({ timeout: 30000 });
  await fillIf('#cardNumber', '4242 4242 4242 4242');
  await fillIf('#cardExpiry', '12 / 34');
  await fillIf('#cardCvc', '123');
  await fillIf('#billingName', `${h.tag('cardholder')}`);
  await fillIf('#billingPostalCode', '00000');
  const save = checkout.locator('#enableStripePass');
  if ((await save.count()) && (await save.isChecked().catch(() => false))) await save.uncheck().catch(() => undefined);
  await checkout.locator('button[type="submit"], .SubmitButton').first().click();
  await checkout.waitForURL((u) => !/checkout\.stripe\.com/.test(u.host), { timeout: 120000, waitUntil: 'commit' });
  h.ok(true, `Stripe returned to ${checkout.url().split('?')[0]}`);
}

async function invoiceState(h, invoiceId) {
  await h.go(`/invoice/${encodeURIComponent(invoiceId)}`, 2500);
  return h.bodyText();
}

run('payments', { need: ['admin', 'parent'] }, async (h) => {
  const { page } = h;
  if (!h.config.DEMO && h.config.stripeTestKey) h.ok(/^(sk|rk)_test_/.test(h.config.stripeTestKey), 'STRIPE_TEST_SECRET_KEY is a test-mode key');

  h.step('admin creates a test invoice for the test family');
  await h.signIn('admin');
  const invoice = await createTestInvoice(h);
  const body = await h.bodyText();
  const total = money((body.match(/Total including VAT\s*\n?\s*(AED [\d,.]+)/) || [])[1] || (body.match(/AED [\d,.]+/) || [])[0]);
  h.ok(total > 0, `invoice ${invoice.number} (${invoice.id}) issued for ${aed(total)}`);
  await h.signOut('admin');

  h.step('parent pays by card');
  await h.signIn('parent');
  await h.go(`/invoice/${encodeURIComponent(invoice.id)}`, 2500);
  const payBtn = h.button(/^Pay AED .* by card$/);
  h.ok((await payBtn.count()) > 0, 'the parent is offered "Pay … by card"');
  if (h.config.DEMO) {
    h.dialogs.length = 0;
    await payBtn.last().click();
    await page.waitForTimeout(2000);
    h.ok(h.dialogs.some((m) => /Payment received/.test(m)), 'DEMO: payment is simulated ("Payment received")');
    h.skip('DEMO: Stripe Checkout is not used by the demo build, so the test-mode card form was not exercised.');
  } else {
    const popup = h.context.waitForEvent('page', { timeout: 30000 }).catch(() => null);
    await payBtn.last().click();
    const checkout = (await popup) || page;
    await payOnStripe(h, checkout);
    if (checkout !== page) await checkout.close().catch(() => undefined);
    if (h.config.stripeTestKey) h.note('STRIPE_TEST_SECRET_KEY is set; payment confirmed through the app (the key is only checked for test mode).');
  }
  const paid = await h.poll(async () => /\bPaid\b/.test(await invoiceState(h, invoice.id)) && (await h.has(/· Card/)), { label: 'the invoice to show Paid (Stripe webhook)', every: 10000 });
  h.ok(!!paid, 'the parent’s invoice shows Paid with a card payment');
  await h.shot('parent-paid');
  await h.signOut('parent');

  h.step('admin refunds part of the payment with a credit note');
  await h.signIn('admin');
  await invoiceState(h, invoice.id);
  const refundBtn = h.button('Refund');
  h.ok((await refundBtn.count()) > 0, 'the admin sees "Refund" on the card payment');
  const part = Math.max(1, Math.round(total * 0.25 * 100) / 100);
  await refundBtn.first().click();
  await h.box('Amount to refund (AED)').waitFor({ timeout: 20000 });
  await h.fill('Amount to refund (AED)', part.toFixed(2));
  await h.fill('Reason', `${h.tag('partial refund')}: automated test, not a real refund request.`);
  h.dialogs.length = 0;
  await h.press(/^Refund AED/, { wait: 3000 });
  h.ok(h.dialogs.some((m) => /^Refund AED/.test(m) && /A credit note for/.test(m)), 'the refund confirmation says a credit note will be issued');
  h.ok(h.dialogs.some((m) => /Refund (recorded|requested)/.test(m)), `the refund of ${aed(part)} was accepted`);
  h.record('refund', { invoiceId: invoice.id, amount: part });

  const settled = await h.poll(
    async () => {
      const t = await invoiceState(h, invoice.id);
      return /Credit notes/i.test(t) && /Refunds/i.test(t) && (await h.has('Refunded', true)) ? t : null;
    },
    { label: 'the refund to succeed and the credit note to appear', every: 10000 },
  );
  h.ok(!!settled, 'the invoice lists the credit note and the refund as Refunded');
  h.ok(await h.has(aed(part)), `the refund shows ${aed(part)}`);
  await h.shot('admin-refunded');
  await h.signOut('admin');
});
