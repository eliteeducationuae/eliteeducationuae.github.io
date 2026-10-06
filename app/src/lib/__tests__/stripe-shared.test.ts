import {
  autopayIdempotencyKey,
  autopayIntentListPath,
  autopayReplayAllowed,
  classifyAutopayResponse,
  findAutopayIntent,
  cardSummary,
  checkoutInvoiceForm,
  checkoutOfferForm,
  classifyEvent,
  customerForm,
  describeStripeError,
  invoiceBalanceFils,
  isPermanentWebhookError,
  offerChargeFils,
  offSessionIntentForm,
  portalForm,
  verifyStripeSignature,
} from '../../../supabase/functions/_shared/stripe';

/** Signs like Stripe does: hex HMAC-SHA256 of "<timestamp>.<payload>" (Web Crypto, as in Deno). */
async function sign(payload: string, secret: string, t: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyStripeSignature', () => {
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';
  const secret = 'whsec_test';
  const now = 1_800_000_000;

  it('accepts a valid signature', async () => {
    await expect(verifyStripeSignature(payload, `t=${now},v1=${await sign(payload, secret, now)}`, secret, now + 10)).resolves.toBe(true);
  });
  it('rejects a signature made with another secret', async () => {
    await expect(verifyStripeSignature(payload, `t=${now},v1=${await sign(payload, 'whsec_other', now)}`, secret, now)).resolves.toBe(false);
  });
  it('rejects a stale timestamp', async () => {
    await expect(verifyStripeSignature(payload, `t=${now},v1=${await sign(payload, secret, now)}`, secret, now + 301)).resolves.toBe(false);
  });
  it('rejects a changed payload', async () => {
    await expect(verifyStripeSignature(payload + ' ', `t=${now},v1=${await sign(payload, secret, now)}`, secret, now)).resolves.toBe(false);
  });
  it('accepts any matching v1 value (secret rolling)', async () => {
    const header = `t=${now},v1=${await sign(payload, 'whsec_old', now)},v1=${await sign(payload, secret, now)},v0=abc`;
    await expect(verifyStripeSignature(payload, header, secret, now)).resolves.toBe(true);
  });
  it('rejects missing headers, secrets and signatures', async () => {
    await expect(verifyStripeSignature(payload, null, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(payload, `t=${now},v1=${await sign(payload, secret, now)}`, undefined, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(payload, `t=${now}`, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(payload, `v1=${await sign(payload, secret, now)}`, secret, now)).resolves.toBe(false);
  });
});

describe('money', () => {
  it('adds VAT, rounds to 2dp and subtracts payments, in fils', () => {
    expect(invoiceBalanceFils([{ quantity: 2, unitPrice: 450 }], 0.05, [])).toBe(94500);
    expect(invoiceBalanceFils([{ quantity: 2, unitPrice: 450 }], '0.0500', [{ amount: '500' }])).toBe(44500);
    expect(invoiceBalanceFils([{ quantity: 1, unitPrice: 945 }], 0.05, [{ amount: 992.25 }])).toBe(0);
    expect(invoiceBalanceFils([{ quantity: 1, unitPrice: 100 }], 0, [{ amount: 150 }])).toBe(-5000);
  });
  it('rounds half up like the database', () => {
    expect(invoiceBalanceFils([{ quantity: 1, unitPrice: 1.005 }], 0, [])).toBe(101);
    expect(invoiceBalanceFils([{ quantity: 3, unitPrice: 33.33 }], 0.05, [])).toBe(10499); // 104.9895 → 104.99
    expect(invoiceBalanceFils([], 0.05, [])).toBe(0);
  });
  it('prices a lesson bundle with VAT', () => {
    expect(offerChargeFils(4000, 0.05)).toBe(420000);
    expect(offerChargeFils('2100.00', '0')).toBe(210000);
    expect(offerChargeFils(99.99, 0.05)).toBe(10499);
  });
});

describe('Checkout forms', () => {
  const invoice = checkoutInvoiceForm({
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-1001',
    balanceFils: 94500,
    customerId: 'cus_1',
    familyId: 'fam-1',
    appUrl: 'https://eliteeducationuae.github.io/app',
  });

  it('pays an invoice on the family customer and saves the card', () => {
    expect(invoice.get('mode')).toBe('payment');
    expect(invoice.get('customer')).toBe('cus_1');
    expect(invoice.has('customer_email')).toBe(false);
    expect([...invoice.keys()].some((k) => k.startsWith('payment_method_types'))).toBe(false);
    expect(invoice.get('payment_intent_data[setup_future_usage]')).toBe('off_session');
    expect(invoice.get('line_items[0][price_data][currency]')).toBe('aed');
    expect(invoice.get('line_items[0][price_data][unit_amount]')).toBe('94500');
    expect(invoice.get('line_items[0][price_data][product_data][name]')).toBe('Elite Education invoice INV-1001');
    expect(invoice.get('metadata[invoice_id]')).toBe('inv-1');
    expect(invoice.get('payment_intent_data[metadata][invoice_id]')).toBe('inv-1');
    expect(invoice.get('payment_intent_data[metadata][family_id]')).toBe('fam-1');
    expect(invoice.get('success_url')).toBe('https://eliteeducationuae.github.io/app/invoice/inv-1?paid=1');
    expect(invoice.get('cancel_url')).toBe('https://eliteeducationuae.github.io/app/invoice/inv-1');
  });

  it('buys a lesson package', () => {
    const form = checkoutOfferForm({
      offer: { id: 'off-1', name: 'Ten IB lessons', lessons: 10, price: '4000.00', service_id: 'svc-1' },
      vatRate: '0.05',
      amountFils: 420000,
      customerId: 'cus_1',
      familyId: 'fam-1',
      appUrl: 'https://x.test/app',
    });
    expect(form.get('customer')).toBe('cus_1');
    expect(form.has('customer_email')).toBe(false);
    expect([...form.keys()].some((k) => k.startsWith('payment_method_types'))).toBe(false);
    expect(form.get('line_items[0][price_data][product_data][name]')).toBe('Elite Education: Ten IB lessons');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('420000');
    expect(form.get('payment_intent_data[setup_future_usage]')).toBe('off_session');
    expect(form.get('metadata[offer_id]')).toBe('off-1');
    expect(form.get('metadata[family_id]')).toBe('fam-1');
    expect(form.get('payment_intent_data[metadata][offer_id]')).toBe('off-1');
    expect(form.get('payment_intent_data[metadata][family_id]')).toBe('fam-1');
    expect(form.has('metadata[invoice_id]')).toBe(false);
    // What the parent was shown travels with the payment, on both the session and the payment intent.
    for (const prefix of ['metadata', 'payment_intent_data[metadata]']) {
      expect(form.get(`${prefix}[offer_name]`)).toBe('Ten IB lessons');
      expect(form.get(`${prefix}[offer_lessons]`)).toBe('10');
      expect(form.get(`${prefix}[offer_price]`)).toBe('4000');
      expect(form.get(`${prefix}[offer_service_id]`)).toBe('svc-1');
      expect(form.get(`${prefix}[offer_vat_rate]`)).toBe('0.05');
    }
    expect(form.get('success_url')).toBe('https://x.test/app/parent/billing?topup=1');
    expect(form.get('cancel_url')).toBe('https://x.test/app/parent/billing');
  });
});

describe('autopay and customer forms', () => {
  it('charges the saved card off-session without redirects', () => {
    const form = offSessionIntentForm({
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-1001',
      familyId: 'fam-1',
      amountFils: 94500,
      customerId: 'cus_1',
      paymentMethodId: 'pm_1',
      attempt: 2,
    });
    expect(Object.fromEntries(form)).toEqual({
      amount: '94500',
      currency: 'aed',
      customer: 'cus_1',
      payment_method: 'pm_1',
      off_session: 'true',
      confirm: 'true',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      description: 'Elite Education invoice INV-1001 (autopay)',
      'metadata[invoice_id]': 'inv-1',
      'metadata[family_id]': 'fam-1',
      'metadata[autopay]': '1',
      'metadata[autopay_attempt]': '2',
    });
  });
  it('uses one idempotency key per attempt', () => {
    expect(autopayIdempotencyKey('inv-1', 1)).toBe('autopay-inv-1-1');
    expect(autopayIdempotencyKey('inv-1', 2)).not.toBe(autopayIdempotencyKey('inv-1', 1));
  });
  it('lists the customer\'s payment intents since the request was sent, less five minutes', () => {
    const path = autopayIntentListPath('cus_1', '2026-10-01T10:00:00Z');
    const since = Date.parse('2026-10-01T10:00:00Z') / 1000 - 300;
    expect(path).toBe(`/payment_intents?customer=cus_1&created%5Bgte%5D=${since}&limit=100`);
    expect(autopayIntentListPath('cus_1', '2026-10-01T10:00:00Z', 'pi_9')).toContain('starting_after=pi_9');
  });
  it('finds the payment intent of one autopay attempt by its metadata', () => {
    const list = {
      data: [
        { id: 'pi_a', metadata: { invoice_id: 'inv-1', autopay_attempt: '2' } },
        { id: 'pi_b', metadata: { invoice_id: 'inv-2', autopay_attempt: '3' } },
        { id: 'pi_c', metadata: { invoice_id: 'inv-1', autopay_attempt: '3' } },
      ],
    };
    expect(findAutopayIntent(list, 'inv-1', 3)?.id).toBe('pi_c');
    expect(findAutopayIntent(list, 'inv-1', 4)).toBeNull();
    expect(findAutopayIntent(null, 'inv-1', 3)).toBeNull();
  });
  it('creates a customer tagged with the family', () => {
    expect(Object.fromEntries(customerForm({ familyId: 'fam-1', email: 'mum@x', name: 'Mona Ahmed' }))).toEqual({
      'metadata[family_id]': 'fam-1',
      email: 'mum@x',
      name: 'Mona Ahmed',
    });
    expect(customerForm({ familyId: 'fam-1', email: null }).has('email')).toBe(false);
  });
  it('opens the portal with a return URL', () => {
    expect(Object.fromEntries(portalForm('cus_1', 'https://x.test/app/parent/billing'))).toEqual({
      customer: 'cus_1',
      return_url: 'https://x.test/app/parent/billing',
    });
  });
});

describe('cardSummary', () => {
  const pm = (brand: string, month = 4, year = 2029) => ({ id: 'pm_1', type: 'card', card: { brand, last4: '4242', exp_month: month, exp_year: year } });
  it('names card brands', () => {
    expect(cardSummary(pm('visa'))?.brand).toBe('Visa');
    expect(cardSummary(pm('mastercard'))?.brand).toBe('Mastercard');
    expect(cardSummary(pm('amex'))?.brand).toBe('American Express');
    expect(cardSummary(pm('discover'))?.brand).toBe('Discover');
    expect(cardSummary(pm('unionpay'))?.brand).toBe('UnionPay');
    expect(cardSummary(pm('jcb'))?.brand).toBe('JCB');
    expect(cardSummary(pm('diners'))?.brand).toBe('Diners Club');
    expect(cardSummary(pm('cartes_bancaires'))?.brand).toBe('Cartes_bancaires');
  });
  it('pads the expiry to MM/YY', () => {
    expect(cardSummary(pm('visa', 4, 2029))).toEqual({ brand: 'Visa', last4: '4242', expires: '04/29' });
    expect(cardSummary(pm('visa', 12, 2031))?.expires).toBe('12/31');
    expect(cardSummary(pm('visa', 1, 2005))?.expires).toBe('01/05');
  });
  it('returns null when there is no card', () => {
    expect(cardSummary(null)).toBeNull();
    expect(cardSummary({ id: 'pm_1', type: 'link' })).toBeNull();
    expect(cardSummary({ card: { brand: 'visa' } })).toBeNull();
  });
});

describe('describeStripeError', () => {
  it('explains common declines in plain English', () => {
    expect(describeStripeError({ code: 'authentication_required' })).toBe(
      'Your bank asked to confirm this payment, which cannot be done automatically.',
    );
    expect(describeStripeError({ code: 'card_declined', decline_code: 'authentication_required' })).toMatch(/^Your bank asked to confirm/);
    expect(describeStripeError({ code: 'card_declined', decline_code: 'insufficient_funds' })).toBe('Your card has insufficient funds.');
    expect(describeStripeError({ code: 'expired_card' })).toBe('Your card has expired.');
    expect(describeStripeError({ code: 'card_declined', decline_code: 'generic_decline' })).toBe('Your card was declined by your bank.');
    expect(describeStripeError({ code: 'card_declined' })).toBe('Your card was declined by your bank.');
  });
  it('falls back to a generic sentence and never echoes raw details', () => {
    const raw = { code: 'resource_missing', message: 'No such PaymentMethod: pm_123; cus_456' };
    expect(describeStripeError(raw)).toBe('The payment could not be completed.');
    expect(describeStripeError(raw)).not.toMatch(/pm_|cus_/);
    expect(describeStripeError(null)).toBe('The payment could not be completed.');
  });
});

describe('classifyEvent', () => {
  const ev = (type: string, object: object, extra: object = {}) => ({ id: 'evt_1', type, data: { object, ...extra } });

  it('reads a paid invoice Checkout session', () => {
    expect(
      classifyEvent(
        ev('checkout.session.completed', {
          id: 'cs_1',
          payment_status: 'paid',
          amount_total: 94500,
          payment_intent: 'pi_1',
          customer: 'cus_1',
          metadata: { invoice_id: 'inv-1', family_id: 'fam-1' },
        }),
      ),
    ).toEqual({ kind: 'invoice-paid', invoiceId: 'inv-1', amount: 945, paymentIntent: 'pi_1', autopay: false, sessionId: 'cs_1', customerId: 'cus_1' });
  });
  it('ignores an unpaid Checkout session', () => {
    expect(classifyEvent(ev('checkout.session.completed', { id: 'cs_1', payment_status: 'unpaid', metadata: { invoice_id: 'inv-1' } }))).toEqual({
      kind: 'ignore',
    });
  });
  it('reads a paid lesson package Checkout session with what the parent was shown', () => {
    const snapshot = { offer_name: 'Ten IB lessons', offer_lessons: '10', offer_price: '4000', offer_vat_rate: '0.05', offer_service_id: 'svc-1' };
    expect(
      classifyEvent(
        ev('checkout.session.completed', {
          id: 'cs_2',
          payment_status: 'paid',
          amount_total: 420000,
          payment_intent: 'pi_2',
          metadata: { offer_id: 'off-1', family_id: 'fam-1', ...snapshot },
        }),
      ),
    ).toEqual({
      kind: 'offer-paid',
      offerId: 'off-1',
      familyId: 'fam-1',
      amount: 4200,
      paymentIntent: 'pi_2',
      sessionId: 'cs_2',
      snapshot: { name: 'Ten IB lessons', lessons: 10, price: 4000, vatRate: 0.05, serviceId: 'svc-1' },
    });
    // An incomplete snapshot is left out, so the database falls back to the offer.
    const partial = classifyEvent(
      ev('payment_intent.succeeded', { id: 'pi_9', amount_received: 420000, metadata: { offer_id: 'off-1', family_id: 'fam-1', offer_name: 'X', offer_lessons: 'ten' } }),
    );
    expect(partial).toEqual({ kind: 'offer-paid', offerId: 'off-1', familyId: 'fam-1', amount: 4200, paymentIntent: 'pi_9' });
  });
  it('reads a paid lesson package Checkout session started before snapshots', () => {
    expect(
      classifyEvent(
        ev('checkout.session.completed', {
          id: 'cs_2',
          payment_status: 'paid',
          amount_total: 420000,
          payment_intent: 'pi_2',
          metadata: { offer_id: 'off-1', family_id: 'fam-1' },
        }),
      ),
    ).toEqual({ kind: 'offer-paid', offerId: 'off-1', familyId: 'fam-1', amount: 4200, paymentIntent: 'pi_2', sessionId: 'cs_2' });
  });
  it('reads a succeeded payment intent with its card', () => {
    expect(
      classifyEvent(
        ev('payment_intent.succeeded', {
          id: 'pi_3',
          amount_received: 94500,
          customer: 'cus_1',
          payment_method: 'pm_1',
          metadata: { invoice_id: 'inv-1', family_id: 'fam-1', autopay: '1' },
        }),
      ),
    ).toEqual({ kind: 'invoice-paid', invoiceId: 'inv-1', amount: 945, paymentIntent: 'pi_3', autopay: true, customerId: 'cus_1', paymentMethodId: 'pm_1' });
    expect(
      classifyEvent(
        ev('payment_intent.succeeded', { id: 'pi_4', amount_received: 420000, customer: 'cus_1', payment_method: 'pm_1', metadata: { offer_id: 'off-1', family_id: 'fam-1' } }),
      ),
    ).toEqual({ kind: 'offer-paid', offerId: 'off-1', familyId: 'fam-1', amount: 4200, paymentIntent: 'pi_4', customerId: 'cus_1', paymentMethodId: 'pm_1' });
  });
  it('ignores payments that are not ours', () => {
    expect(classifyEvent(ev('payment_intent.succeeded', { id: 'pi_5', amount_received: 100, metadata: {} }))).toEqual({ kind: 'ignore' });
  });
  it('reads a failed payment intent', () => {
    expect(
      classifyEvent(
        ev('payment_intent.payment_failed', {
          id: 'pi_6',
          metadata: { invoice_id: 'inv-1', autopay: '1', autopay_attempt: '3' },
          last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
        }),
      ),
    ).toEqual({ kind: 'payment-failed', invoiceId: 'inv-1', message: 'Your card has insufficient funds.', autopay: true, attempt: 3 });
    expect(
      classifyEvent(ev('payment_intent.payment_failed', { id: 'pi_6b', metadata: { invoice_id: 'inv-1', autopay: '1', autopay_attempt: 'x' } })),
    ).toEqual({ kind: 'payment-failed', invoiceId: 'inv-1', message: 'The payment could not be completed.', autopay: true });
    expect(classifyEvent(ev('payment_intent.payment_failed', { id: 'pi_7', metadata: { invoice_id: 'inv-1' } }))).toEqual({
      kind: 'payment-failed',
      invoiceId: 'inv-1',
      message: 'The payment could not be completed.',
      autopay: false,
    });
    expect(classifyEvent(ev('payment_intent.payment_failed', { id: 'pi_8', metadata: { offer_id: 'off-1' } }))).toEqual({ kind: 'ignore' });
  });
  it('notices card changes', () => {
    expect(classifyEvent(ev('payment_method.attached', { id: 'pm_1', customer: 'cus_1' }))).toEqual({ kind: 'card-changed', customerId: 'cus_1' });
    expect(classifyEvent(ev('payment_method.detached', { id: 'pm_1', customer: null }, { previous_attributes: { customer: 'cus_1' } }))).toEqual({
      kind: 'card-changed',
      customerId: 'cus_1',
    });
    expect(classifyEvent(ev('payment_method.detached', { id: 'pm_1', customer: null }))).toEqual({ kind: 'ignore' });
    expect(classifyEvent(ev('customer.updated', { id: 'cus_1', object: 'customer' }))).toEqual({ kind: 'card-changed', customerId: 'cus_1' });
  });
  it('ignores everything else', () => {
    expect(classifyEvent(ev('invoice.paid', { id: 'in_1' }))).toEqual({ kind: 'ignore' });
    expect(classifyEvent(null)).toEqual({ kind: 'ignore' });
    expect(classifyEvent({ type: 'customer.updated' })).toEqual({ kind: 'ignore' });
  });
});

describe('classifyAutopayResponse', () => {
  const err = (status: number, error: Record<string, unknown>) => ({ ok: false, status, body: { error } });
  it('treats only answers about the card as declines', () => {
    expect(classifyAutopayResponse(err(402, { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds' }))).toEqual({
      outcome: 'declined',
      message: 'Your card has insufficient funds.',
    });
    expect(classifyAutopayResponse(err(400, { type: 'card_error', code: 'expired_card' }))).toEqual({
      outcome: 'declined',
      message: 'Your card has expired.',
    });
    expect(classifyAutopayResponse({ ok: true, status: 200, body: { status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } } })).toEqual({
      outcome: 'declined',
      message: 'Your card was declined by your bank.',
    });
    expect(classifyAutopayResponse({ ok: true, status: 200, body: { status: 'requires_action' } })).toMatchObject({ outcome: 'declined' });
  });
  it('never treats errors that say nothing about the card as declines', () => {
    expect(classifyAutopayResponse(err(409, { type: 'invalid_request_error', code: 'idempotency_key_in_use' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(409, { type: 'invalid_request_error', code: 'lock_timeout' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(400, { type: 'idempotency_error' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(400, { type: 'invalid_request_error' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(401, { type: 'invalid_request_error', message: 'Invalid API Key provided' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(403, { type: 'invalid_request_error' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(404, { type: 'invalid_request_error' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(429, { type: 'rate_limit_error' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(err(500, { type: 'api_error' }))).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse({ ok: false, status: 502, body: null })).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse(null)).toEqual({ outcome: 'unknown' });
    expect(classifyAutopayResponse({ ok: true, status: 200, body: { status: 'requires_confirmation' } })).toEqual({ outcome: 'unknown' });
  });
  it('passes successes and charges under way through with the payment intent', () => {
    const pi = { id: 'pi_1', status: 'succeeded', amount_received: 45000 };
    expect(classifyAutopayResponse({ ok: true, status: 200, body: pi })).toEqual({ outcome: 'succeeded', intent: pi });
    expect(classifyAutopayResponse({ ok: true, status: 200, body: { id: 'pi_1', status: 'processing' } })).toMatchObject({ outcome: 'processing' });
  });
});

describe('autopayReplayAllowed', () => {
  const now = Date.parse('2026-10-02T10:00:00Z');
  const base = {
    invoiceStatus: 'sent',
    autopay: true,
    balanceFils: 45000,
    requestAmountFils: 45000,
    sentAt: '2026-10-02T09:00:00Z',
    now,
  };
  it('resends while the invoice still wants exactly that charge', () => {
    expect(autopayReplayAllowed(base)).toBe(true);
  });
  it('never resends an unknown charge on a voided, paid or draft invoice', () => {
    expect(autopayReplayAllowed({ ...base, invoiceStatus: 'void' })).toBe(false);
    expect(autopayReplayAllowed({ ...base, invoiceStatus: 'paid' })).toBe(false);
    expect(autopayReplayAllowed({ ...base, invoiceStatus: 'draft' })).toBe(false);
  });
  it('never resends once autopay is switched off or a payment has been recorded since', () => {
    expect(autopayReplayAllowed({ ...base, autopay: false })).toBe(false);
    expect(autopayReplayAllowed({ ...base, autopay: null })).toBe(false);
    expect(autopayReplayAllowed({ ...base, balanceFils: 20000 })).toBe(false);
    expect(autopayReplayAllowed({ ...base, requestAmountFils: 0, balanceFils: 0 })).toBe(false);
  });
  it('never resends once the idempotency key may have expired', () => {
    expect(autopayReplayAllowed({ ...base, sentAt: '2026-10-01T11:00:01Z' })).toBe(true);
    expect(autopayReplayAllowed({ ...base, sentAt: '2026-10-01T11:00:00Z' })).toBe(false);
    expect(autopayReplayAllowed({ ...base, sentAt: 'not a date' })).toBe(false);
  });
});

describe('isPermanentWebhookError', () => {
  it('treats missing rows and malformed metadata as permanent', () => {
    expect(isPermanentWebhookError({ code: '23503', message: 'insert or update on table "payments" violates foreign key constraint' })).toBe(true);
    expect(isPermanentWebhookError({ code: '22P02', message: 'invalid input syntax for type uuid' })).toBe(true);
    expect(isPermanentWebhookError({ code: 'P0001', message: 'Family not found' })).toBe(true);
    expect(isPermanentWebhookError({ code: 'P0001', message: 'A payment intent is required' })).toBe(true);
  });

  it('leaves transient errors to Stripe\'s retries', () => {
    expect(isPermanentWebhookError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isPermanentWebhookError({ code: '40P01', message: 'deadlock detected' })).toBe(false);
    expect(isPermanentWebhookError({ message: 'fetch failed' })).toBe(false);
    expect(isPermanentWebhookError(null)).toBe(false);
  });
});
