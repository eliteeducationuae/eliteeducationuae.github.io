import {
  classifyEvent,
  describeRefundFailure,
  findAppRefund,
  invoiceBalanceFils,
  mapRefundStatus,
  refundAmountFils,
  refundForm,
  refundIdempotencyKey,
  refundListPath,
  refundNeedsLookup,
  REFUND_REPLAY_HOURS,
} from '../../../supabase/functions/_shared/stripe';

const refundEvent = (type: string, object: Record<string, unknown>) => ({ id: 'evt_1', type, data: { object } });

describe('refundForm', () => {
  it('sends the payment intent, the amount in fils and the app ids as metadata', () => {
    const form = refundForm({ paymentIntent: 'pi_1', amountFils: refundAmountFils(349.99), refundId: 'ref-1', invoiceId: 'inv-1' });
    expect(Object.fromEntries(form)).toEqual({
      payment_intent: 'pi_1',
      amount: '34999',
      reason: 'requested_by_customer',
      'metadata[refund_id]': 'ref-1',
      'metadata[invoice_id]': 'inv-1',
    });
  });

  it('rounds AED to whole fils', () => {
    expect(refundAmountFils(349.99)).toBe(34999);
    expect(refundAmountFils('100.00')).toBe(10000);
    expect(refundAmountFils(1.005)).toBe(101);
    expect(refundAmountFils(0.1 + 0.2)).toBe(30);
  });
});

describe('refundIdempotencyKey', () => {
  it('is one key per refund', () => {
    expect(refundIdempotencyKey('abc')).toBe('refund-abc');
    expect(refundIdempotencyKey('abc')).toBe(refundIdempotencyKey('abc'));
    expect(refundIdempotencyKey('abd')).not.toBe(refundIdempotencyKey('abc'));
  });
});

describe('mapRefundStatus', () => {
  it.each([
    ['succeeded', 'succeeded'],
    ['failed', 'failed'],
    ['canceled', 'failed'],
    ['pending', 'pending'],
    ['requires_action', 'pending'],
    [undefined, 'pending'],
    ['something_new', 'pending'],
  ])('%s is %s', (stripe, app) => {
    expect(mapRefundStatus(stripe)).toBe(app);
  });
});

const REFUND_ID = '6f1c2b9e-3d4a-4c5b-9e8f-0a1b2c3d4e5f';

describe('classifyEvent: refunds', () => {
  const refund = {
    id: 're_1',
    object: 'refund',
    amount: 34999,
    status: 'succeeded',
    payment_intent: 'pi_1',
    metadata: { refund_id: REFUND_ID, invoice_id: 'inv-1' },
  };

  it.each(['refund.created', 'refund.updated', 'refund.failed', 'charge.refund.updated'])('reads %s', (type) => {
    expect(classifyEvent(refundEvent(type, refund))).toEqual({
      kind: 'refund-updated',
      refundId: REFUND_ID,
      stripeRefundId: 're_1',
      paymentIntent: 'pi_1',
      amount: 349.99,
      status: 'succeeded',
    });
  });

  it('reads a refund made in the Stripe Dashboard (no metadata)', () => {
    expect(classifyEvent(refundEvent('refund.created', { ...refund, metadata: {} }))).toEqual({
      kind: 'refund-updated',
      stripeRefundId: 're_1',
      paymentIntent: 'pi_1',
      amount: 349.99,
      status: 'succeeded',
    });
    const noMetadata = { ...refund } as Record<string, unknown>;
    delete noMetadata.metadata;
    expect(classifyEvent(refundEvent('refund.updated', noMetadata))).toMatchObject({ kind: 'refund-updated', stripeRefundId: 're_1' });
    expect(classifyEvent(refundEvent('refund.updated', noMetadata))).not.toHaveProperty('refundId');
  });

  it('treats a refund id that is not a uuid as a refund made outside the app', () => {
    for (const bad of ['ref-1', 'x', "1'; drop table refunds; --", `${REFUND_ID}0`]) {
      const event = classifyEvent(refundEvent('refund.updated', { ...refund, metadata: { refund_id: bad } }));
      expect(event).toMatchObject({ kind: 'refund-updated', stripeRefundId: 're_1', paymentIntent: 'pi_1' });
      expect(event).not.toHaveProperty('refundId');
    }
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, metadata: { refund_id: REFUND_ID.toUpperCase() } }))).toMatchObject({
      refundId: REFUND_ID.toUpperCase(),
    });
  });

  it('accepts an expanded payment intent', () => {
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, payment_intent: { id: 'pi_2' } }))).toMatchObject({ paymentIntent: 'pi_2' });
  });

  it('reports a failed refund with a friendly reason', () => {
    expect(classifyEvent(refundEvent('refund.failed', { ...refund, status: 'failed', failure_reason: 'expired_or_canceled_card' }))).toMatchObject({
      status: 'failed',
      failureReason: 'The card has expired or been cancelled.',
    });
  });

  it('treats a cancelled refund as failed', () => {
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, status: 'canceled' }))).toMatchObject({
      status: 'failed',
      failureReason: 'The refund was cancelled.',
    });
  });

  it('keeps a refund still in progress pending, without a failure reason', () => {
    const event = classifyEvent(refundEvent('refund.created', { ...refund, status: 'pending' }));
    expect(event).toMatchObject({ kind: 'refund-updated', status: 'pending' });
    expect(event).not.toHaveProperty('failureReason');
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, status: 'requires_action' }))).toMatchObject({ status: 'pending' });
  });

  it('ignores malformed refunds', () => {
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, id: undefined }))).toEqual({ kind: 'ignore' });
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, amount: 0 }))).toEqual({ kind: 'ignore' });
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, amount: '100' }))).toEqual({ kind: 'ignore' });
    expect(classifyEvent(refundEvent('refund.updated', { ...refund, object: 'charge' }))).toEqual({ kind: 'ignore' });
    expect(classifyEvent({ type: 'refund.updated', data: {} })).toEqual({ kind: 'ignore' });
    expect(classifyEvent({ type: 'refund.updated' })).toEqual({ kind: 'ignore' });
  });
});

describe('describeRefundFailure', () => {
  it('never returns an empty or technical message', () => {
    for (const code of ['lost_or_stolen_card', 'expired_or_canceled_card', 'insufficient_funds', 'declined', 'merchant_request', 'unknown', undefined]) {
      const text = describeRefundFailure(code);
      expect(text).toMatch(/^[A-Z].*\.$/);
      expect(text).not.toMatch(/_/);
    }
  });
});

describe('invoiceBalanceFils with credit notes and refunds', () => {
  // Three lessons of 333.33 at 5% VAT: AED 1,049.99.
  const items = [
    { quantity: 1, unitPrice: 333.33 },
    { quantity: 1, unitPrice: 333.33 },
    { quantity: 1, unitPrice: 333.33 },
  ];

  it('is unchanged without adjustments', () => {
    expect(invoiceBalanceFils(items, 0.05, [])).toBe(104999);
    expect(invoiceBalanceFils(items, '0.05', [{ amount: '49.99' }], {})).toBe(100000);
  });

  it('subtracts credit notes', () => {
    expect(invoiceBalanceFils(items, 0.05, [], { credits: [{ total: 350 }] })).toBe(69999);
    expect(invoiceBalanceFils(items, 0.05, [], { credits: [{ total: '350.00' }, { total: '699.99' }] })).toBe(0);
  });

  it('adds back refunds that have not failed', () => {
    const payments = [{ amount: 1049.99 }];
    const credits = [{ total: 100 }];
    expect(invoiceBalanceFils(items, 0.05, payments, { credits, refunds: [{ amount: 100, status: 'pending' }] })).toBe(0);
    expect(invoiceBalanceFils(items, 0.05, payments, { credits, refunds: [{ amount: 100, status: 'succeeded' }] })).toBe(0);
    expect(invoiceBalanceFils(items, 0.05, payments, { credits, refunds: [{ amount: 100, status: 'failed' }] })).toBe(-10000);
    expect(invoiceBalanceFils(items, 0.05, payments, { credits, refunds: [{ amount: 100 }] })).toBe(0);
  });

  it('accepts missing lists from the database', () => {
    expect(invoiceBalanceFils(items, 0.05, [], { credits: null, refunds: null })).toBe(104999);
  });
});

describe('late refund retries', () => {
  const created = '2026-10-01T10:00:00Z';
  const at = (hours: number) => Date.parse(created) + hours * 3_600_000;

  it('sends again with the idempotency key alone for 23 hours, then looks the refund up first', () => {
    expect(REFUND_REPLAY_HOURS).toBe(23);
    expect(refundNeedsLookup(created, at(0))).toBe(false);
    expect(refundNeedsLookup(created, at(22.9))).toBe(false);
    expect(refundNeedsLookup(created, at(23))).toBe(true);
    expect(refundNeedsLookup(created, at(48))).toBe(true);
    // Without a creation time it is always looked up.
    expect(refundNeedsLookup(undefined, at(0))).toBe(true);
    expect(refundNeedsLookup('not a date', at(0))).toBe(true);
  });

  it('lists the payment intent\'s refunds', () => {
    expect(refundListPath('pi_123')).toBe('/refunds?payment_intent=pi_123&limit=100');
  });

  it('finds the Stripe refund carrying this refund\'s id in its metadata', () => {
    const list = {
      object: 'list',
      data: [
        { id: 're_other', status: 'succeeded', metadata: { refund_id: 'ref-2' } },
        { id: 're_none', status: 'succeeded' },
        { id: 're_mine', status: 'pending', metadata: { refund_id: 'ref-1', invoice_id: 'inv-1' } },
      ],
    };
    expect(findAppRefund(list, 'ref-1')).toMatchObject({ id: 're_mine', status: 'pending' });
    expect(findAppRefund(list, 'ref-3')).toBeNull();
    expect(findAppRefund(null, 'ref-1')).toBeNull();
    expect(findAppRefund({ data: 'x' }, 'ref-1')).toBeNull();
  });
});
