// Pure Stripe helpers shared by the payment Edge Functions and unit-tested with Jest.
// No imports and no Deno globals: this file is also compiled by the app's TypeScript and Jest.
// Amounts sent to Stripe are in fils (1 AED = 100 fils).

/** Seconds either side of now that a webhook timestamp may be. Stripe's own libraries use five minutes. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Checks a `Stripe-Signature` header (t=…,v1=…[,v1=…]) against the raw request body. */
export async function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string | null | undefined,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim());
  const timestamp = Number(parts.find((p) => p.startsWith('t='))?.slice(2));
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  return signatures.some((s) => timingSafeEqual(s, expected));
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** AED to fils, rounding half up to the nearest fils (a tiny nudge absorbs binary float error, e.g. 1.005). */
function toFils(aed: number): number {
  return Math.round(aed * 100 + 1e-6);
}

/** Credit notes and refunds on an invoice (credit_notes(total) and refunds(amount, status) from the database). */
export type InvoiceAdjustments = {
  credits?: { total: number | string }[] | null;
  refunds?: { amount: number | string; status?: string | null }[] | null;
};

/**
 * What is still owed on an invoice, in fils: subtotal plus VAT (rounded to 2dp, as invoice_total does) less payments,
 * less credit notes, plus refunds that have not failed (as invoice_balance does in the database).
 */
export function invoiceBalanceFils(
  items: { quantity: number; unitPrice: number }[],
  vatRate: number | string,
  payments: { amount: number | string }[],
  adjustments?: InvoiceAdjustments,
): number {
  const subtotal = (items ?? []).reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
  const totalFils = toFils(subtotal * (1 + Number(vatRate || 0)));
  const paidFils = (payments ?? []).reduce((s, p) => s + toFils(Number(p.amount)), 0);
  const creditedFils = (adjustments?.credits ?? []).reduce((s, c) => s + toFils(Number(c.total)), 0);
  const refundedFils = (adjustments?.refunds ?? [])
    .filter((r) => r.status !== 'failed')
    .reduce((s, r) => s + toFils(Number(r.amount)), 0);
  return totalFils - paidFils - creditedFils + refundedFils;
}

/** The card charge for a lesson bundle, in fils (price plus VAT). */
export function offerChargeFils(price: number | string, vatRate: number | string): number {
  return toFils(Number(price) * (1 + Number(vatRate || 0)));
}

// ---------------------------------------------------------------------------
// Request bodies (application/x-www-form-urlencoded)
// ---------------------------------------------------------------------------

/**
 * Checkout for an invoice balance. The card is kept on the family's Stripe customer for next time
 * (setup_future_usage) and shown again at the next Checkout. No payment_method_types, so Apple Pay and
 * Google Pay appear from the Dashboard settings. Never sets customer_email: Stripe rejects it with customer.
 */
export function checkoutInvoiceForm(o: {
  invoiceId: string;
  invoiceNumber: string;
  balanceFils: number;
  customerId: string;
  familyId: string;
  appUrl: string;
}): URLSearchParams {
  return new URLSearchParams({
    mode: 'payment',
    customer: o.customerId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aed',
    'line_items[0][price_data][unit_amount]': String(o.balanceFils),
    'line_items[0][price_data][product_data][name]': `Elite Education invoice ${o.invoiceNumber}`,
    'payment_intent_data[setup_future_usage]': 'off_session',
    'payment_intent_data[description]': `Elite Education invoice ${o.invoiceNumber}`,
    'payment_intent_data[metadata][invoice_id]': o.invoiceId,
    'payment_intent_data[metadata][family_id]': o.familyId,
    'payment_method_data[allow_redisplay]': 'always',
    'metadata[invoice_id]': o.invoiceId,
    'metadata[family_id]': o.familyId,
    success_url: `${o.appUrl}/invoice/${o.invoiceId}?paid=1`,
    cancel_url: `${o.appUrl}/invoice/${o.invoiceId}`,
  });
}

/** What the parent was shown for a lesson package. Sent with the payment so the webhook fulfils exactly that. */
export type OfferSnapshot = { name: string; lessons: number; price: number; serviceId?: string | null; vatRate: number };

/** Metadata keys carrying an OfferSnapshot (Stripe metadata values are strings of up to 500 characters). */
function offerMetadata(prefix: string, o: { offerId: string; familyId: string; snapshot: OfferSnapshot }): Record<string, string> {
  const md: Record<string, string> = {
    [`${prefix}[offer_id]`]: o.offerId,
    [`${prefix}[family_id]`]: o.familyId,
    [`${prefix}[offer_name]`]: o.snapshot.name.slice(0, 500),
    [`${prefix}[offer_lessons]`]: String(o.snapshot.lessons),
    [`${prefix}[offer_price]`]: String(o.snapshot.price),
    [`${prefix}[offer_vat_rate]`]: String(o.snapshot.vatRate),
  };
  if (o.snapshot.serviceId) md[`${prefix}[offer_service_id]`] = o.snapshot.serviceId;
  return md;
}

/** 'Ten IB lessons' as it is; 'Exam season' becomes 'Exam season (10 lessons)'. Matches the receipt fulfil_package_offer writes. */
export function packageLine(name: string, lessons: number): string {
  return /lesson/i.test(name) ? name : `${name} (${lessons} ${lessons === 1 ? 'lesson' : 'lessons'})`;
}

/**
 * Checkout for a lesson package bought by a parent ("Buy more lessons"). The webhook creates the package from the
 * snapshot in the metadata, so a change to the offer while the parent is paying never changes what they get.
 */
export function checkoutOfferForm(o: {
  offer: { id: string; name: string; lessons: number; price: number | string; service_id?: string | null };
  vatRate: number | string;
  amountFils: number;
  customerId: string;
  familyId: string;
  appUrl: string;
}): URLSearchParams {
  const name = `Elite Education: ${packageLine(o.offer.name, Number(o.offer.lessons))}`;
  const snapshot: OfferSnapshot = {
    name: o.offer.name,
    lessons: Number(o.offer.lessons),
    price: Number(o.offer.price),
    serviceId: o.offer.service_id ?? null,
    vatRate: Number(o.vatRate || 0),
  };
  const meta = { offerId: o.offer.id, familyId: o.familyId, snapshot };
  return new URLSearchParams({
    mode: 'payment',
    customer: o.customerId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aed',
    'line_items[0][price_data][unit_amount]': String(o.amountFils),
    'line_items[0][price_data][product_data][name]': name,
    'payment_intent_data[setup_future_usage]': 'off_session',
    'payment_intent_data[description]': name,
    ...offerMetadata('payment_intent_data[metadata]', meta),
    'payment_method_data[allow_redisplay]': 'always',
    ...offerMetadata('metadata', meta),
    success_url: `${o.appUrl}/parent/billing?topup=1`,
    cancel_url: `${o.appUrl}/parent/billing`,
  });
}

/** An autopay charge on the saved card, made without the parent present. */
export function offSessionIntentForm(o: {
  invoiceId: string;
  invoiceNumber: string;
  familyId: string;
  amountFils: number;
  customerId: string;
  paymentMethodId: string;
  /** invoices.autopay_attempts for this charge: a late failure from an earlier attempt is then ignored. */
  attempt: number;
}): URLSearchParams {
  return new URLSearchParams({
    amount: String(o.amountFils),
    currency: 'aed',
    customer: o.customerId,
    payment_method: o.paymentMethodId,
    off_session: 'true',
    confirm: 'true',
    'automatic_payment_methods[enabled]': 'true',
    'automatic_payment_methods[allow_redirects]': 'never',
    description: `Elite Education invoice ${o.invoiceNumber} (autopay)`,
    'metadata[invoice_id]': o.invoiceId,
    'metadata[family_id]': o.familyId,
    'metadata[autopay]': '1',
    'metadata[autopay_attempt]': String(o.attempt),
  });
}

/** One key per attempt: a retried request never charges twice, and a later retry is a new attempt. */
export function autopayIdempotencyKey(invoiceId: string, attempt: number): string {
  return `autopay-${invoiceId}-${attempt}`;
}

/** Resend an unknown autopay request with its idempotency key only within this many hours of the first send. */
export const AUTOPAY_REPLAY_HOURS = 23;

/**
 * Whether an autopay request whose outcome is unknown may be sent again (same body, same idempotency key). Sending it
 * again makes a brand-new charge when the first request never reached Stripe, so it is allowed only while the invoice
 * still wants exactly that charge: still sent (not voided or paid), autopay still on, the balance still at least the
 * amount requested, and the idempotency key still fresh. Otherwise the payment intent is only looked up.
 */
export function autopayReplayAllowed(o: {
  invoiceStatus: string | null | undefined;
  autopay: boolean | null | undefined;
  balanceFils: number;
  requestAmountFils: number;
  sentAt: string;
  now: number;
}): boolean {
  const sent = Date.parse(o.sentAt);
  return (
    o.invoiceStatus === 'sent' &&
    o.autopay === true &&
    Number.isInteger(o.requestAmountFils) &&
    o.requestAmountFils > 0 &&
    o.balanceFils >= o.requestAmountFils &&
    Number.isFinite(sent) &&
    o.now - sent < AUTOPAY_REPLAY_HOURS * 3_600_000
  );
}

/**
 * GET path listing a customer's payment intents created since an autopay request was sent (less five minutes for
 * clock drift). The list endpoint is strongly consistent, unlike Search, so "not found" means it was never made.
 */
export function autopayIntentListPath(customerId: string, sentAt: string, startingAfter?: string): string {
  const since = Math.floor(Date.parse(sentAt) / 1000) - 300;
  const params = new URLSearchParams({ customer: customerId, 'created[gte]': String(since), limit: '100' });
  if (startingAfter) params.set('starting_after', startingAfter);
  return `/payment_intents?${params.toString()}`;
}

/** The payment intent of one autopay attempt in a page of payment intents, or null. */
export function findAutopayIntent(list: unknown, invoiceId: string, attempt: number): Record<string, unknown> | null {
  const data = isObj(list) && Array.isArray(list.data) ? list.data : [];
  for (const pi of data) {
    const md = isObj(pi) && isObj(pi.metadata) ? pi.metadata : {};
    if (md.invoice_id === invoiceId && md.autopay_attempt === String(attempt)) return pi as Record<string, unknown>;
  }
  return null;
}

export type AutopayOutcome =
  | { outcome: 'succeeded'; intent: Record<string, unknown> }
  | { outcome: 'processing'; intent: Record<string, unknown> }
  /** Stripe said something about the card: a real decline the family is told about. */
  | { outcome: 'declined'; message: string }
  /** Nothing is known about the card: an outage, a rate limit, a key problem, a request still in flight. */
  | { outcome: 'unknown' };

/**
 * Turns Stripe's answer to an autopay charge (or a lookup of one) into what it means for the invoice. Only HTTP 402,
 * a card_error, or a payment intent that needs a new card or the cardholder counts as a decline. Everything else that
 * is not a success (any 409 such as idempotency_key_in_use, 400, 401, 403, 404, 429, 5xx, no answer at all) is unknown,
 * so the family is never told a payment failed, and offered another way to pay, while the charge may still go through.
 */
export function classifyAutopayResponse(res: { ok: boolean; status: number; body: unknown } | null): AutopayOutcome {
  if (!res) return { outcome: 'unknown' };
  const body = isObj(res.body) ? res.body : {};
  if (res.ok) {
    const status = str(body.status);
    if (status === 'succeeded') return { outcome: 'succeeded', intent: body };
    if (status === 'processing') return { outcome: 'processing', intent: body };
    if (status === 'requires_action') return { outcome: 'declined', message: describeStripeError({ code: 'authentication_required' }) };
    if (status === 'requires_payment_method') return { outcome: 'declined', message: describeStripeError(body.last_payment_error) };
    return { outcome: 'unknown' };
  }
  const error = isObj(body.error) ? body.error : {};
  if (res.status === 402 || error.type === 'card_error') return { outcome: 'declined', message: describeStripeError(error) };
  return { outcome: 'unknown' };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundStatus = 'pending' | 'succeeded' | 'failed';

/** One key per refund row: a retried request for the same refund never refunds twice. */
export function refundIdempotencyKey(refundId: string): string {
  return `refund-${refundId}`;
}

/** POST /v1/refunds for part or all of a card payment. Built only from the stored refund, so a retry is identical. */
export function refundForm(o: { paymentIntent: string; amountFils: number; refundId: string; invoiceId: string }): URLSearchParams {
  return new URLSearchParams({
    payment_intent: o.paymentIntent,
    amount: String(o.amountFils),
    reason: 'requested_by_customer',
    'metadata[refund_id]': o.refundId,
    'metadata[invoice_id]': o.invoiceId,
  });
}

/** AED to fils for a refund (349.99 gives 34999). */
export function refundAmountFils(aed: number | string): number {
  return toFils(Number(aed));
}

/** Stripe's refund status as the app records it. Anything not yet final (pending, requires_action) is pending. */
export function mapRefundStatus(stripeStatus: unknown): RefundStatus {
  if (stripeStatus === 'succeeded') return 'succeeded';
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') return 'failed';
  return 'pending';
}

/** A short British English sentence for a refund's failure_reason. Never includes Stripe ids or card numbers. */
export function describeRefundFailure(reason: unknown): string {
  switch (reason) {
    case 'lost_or_stolen_card':
      return 'The card has been reported lost or stolen.';
    case 'expired_or_canceled_card':
      return 'The card has expired or been cancelled.';
    case 'insufficient_funds':
      return 'The Stripe balance was too low to make the refund.';
    case 'declined':
      return 'The card issuer declined the refund.';
    case 'merchant_request':
      return 'The refund was cancelled.';
    case 'charge_for_pending_refund_disputed':
      return 'The payment is disputed, so it cannot be refunded.';
    default:
      return 'Stripe could not complete the refund.';
  }
}

export function customerForm(o: { familyId: string; email?: string | null; name?: string | null }): URLSearchParams {
  const form = new URLSearchParams({ 'metadata[family_id]': o.familyId });
  if (o.email) form.set('email', o.email);
  if (o.name) form.set('name', o.name);
  return form;
}

export function portalForm(customerId: string, returnUrl: string): URLSearchParams {
  return new URLSearchParams({ customer: customerId, return_url: returnUrl });
}

// ---------------------------------------------------------------------------
// Responses and events
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
/** A Stripe reference may be an id string or an expanded object with an id. */
const ref = (v: unknown): string | undefined => str(v) ?? (isObj(v) ? str(v.id) : undefined);

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  unionpay: 'UnionPay',
  jcb: 'JCB',
  diners: 'Diners Club',
};

export type CardSummary = { brand: string; last4: string; expires: string };

/** Brand, last four digits and MM/YY expiry of a card payment method; null if it is not a card. */
export function cardSummary(paymentMethod: unknown): CardSummary | null {
  if (!isObj(paymentMethod) || !isObj(paymentMethod.card)) return null;
  const card = paymentMethod.card;
  const last4 = str(card.last4);
  if (!last4) return null;
  const raw = (str(card.brand) ?? 'card').toLowerCase();
  const brand = BRANDS[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
  const month = Number(card.exp_month);
  const year = Number(card.exp_year);
  const expires = month && year ? `${String(month).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}` : '';
  return { brand, last4, expires };
}

/** A short, friendly British English sentence for a Stripe error. Never includes Stripe ids or card numbers. */
export function describeStripeError(err: unknown): string {
  const e = isObj(err) ? err : {};
  const codes = [str(e.decline_code), str(e.code)].filter(Boolean) as string[];
  const has = (...c: string[]) => codes.some((x) => c.includes(x));
  if (has('authentication_required')) return 'Your bank asked to confirm this payment, which cannot be done automatically.';
  if (has('insufficient_funds')) return 'Your card has insufficient funds.';
  if (has('expired_card')) return 'Your card has expired.';
  if (has('incorrect_cvc', 'invalid_cvc')) return 'The security code for your card was not accepted.';
  if (has('processing_error')) return 'Your bank could not process the payment at the moment.';
  if (has('card_declined', 'generic_decline', 'do_not_honor', 'lost_card', 'stolen_card', 'fraudulent', 'card_not_supported')) {
    return 'Your card was declined by your bank.';
  }
  return 'The payment could not be completed.';
}

export type ClassifiedEvent =
  | {
      kind: 'invoice-paid';
      invoiceId: string;
      amount: number;
      paymentIntent: string;
      /** A charge on the saved card made by autopay (recorded as "Autopay"). */
      autopay: boolean;
      sessionId?: string;
      customerId?: string;
      paymentMethodId?: string;
    }
  | {
      kind: 'offer-paid';
      offerId: string;
      familyId: string;
      amount: number;
      paymentIntent: string;
      /** What the parent was shown at Checkout; absent for payments started before it was sent. */
      snapshot?: OfferSnapshot;
      sessionId?: string;
      customerId?: string;
      paymentMethodId?: string;
    }
  | { kind: 'payment-failed'; invoiceId: string; message: string; autopay: boolean; attempt?: number }
  | { kind: 'card-changed'; customerId: string }
  | {
      kind: 'refund-updated';
      /** The app's refund (metadata.refund_id); absent for a refund made in the Stripe Dashboard. */
      refundId?: string;
      stripeRefundId: string;
      paymentIntent?: string;
      /** AED. */
      amount: number;
      status: RefundStatus;
      /** A friendly sentence when the refund failed. */
      failureReason?: string;
    }
  | { kind: 'ignore' };

const IGNORE: ClassifiedEvent = { kind: 'ignore' };

function paid(
  metadata: unknown,
  amountMinor: unknown,
  paymentIntent: string | undefined,
  extra: { sessionId?: string; customerId?: string; paymentMethodId?: string },
): ClassifiedEvent {
  const md = isObj(metadata) ? metadata : {};
  const amount = Number(amountMinor) / 100;
  if (!paymentIntent || !(amount > 0)) return IGNORE;
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) as typeof extra;
  const invoiceId = str(md.invoice_id);
  if (invoiceId) return { kind: 'invoice-paid', invoiceId, amount, paymentIntent, autopay: md.autopay === '1', ...clean };
  const offerId = str(md.offer_id);
  const familyId = str(md.family_id);
  if (offerId && familyId) {
    const snapshot = offerSnapshot(md);
    return { kind: 'offer-paid', offerId, familyId, amount, paymentIntent, ...(snapshot ? { snapshot } : {}), ...clean };
  }
  return IGNORE;
}

/** The OfferSnapshot in a payment's metadata, or undefined when it is missing or incomplete. */
function offerSnapshot(md: Obj): OfferSnapshot | undefined {
  const name = str(md.offer_name)?.trim();
  const lessons = Number(md.offer_lessons);
  const price = Number(md.offer_price);
  const vatRate = Number(md.offer_vat_rate ?? 0);
  if (!name || !Number.isInteger(lessons) || lessons <= 0 || !(price > 0) || !Number.isFinite(vatRate) || vatRate < 0) return undefined;
  return { name, lessons, price, serviceId: str(md.offer_service_id) ?? null, vatRate };
}

/** A positive whole number from metadata, else undefined. */
function wholeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return typeof v === 'string' && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** A Stripe Refund object as a 'refund-updated' event; malformed objects are ignored. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refundEvent(o: Obj): ClassifiedEvent {
  const stripeRefundId = str(o.id);
  const amountMinor = o.amount;
  if (!stripeRefundId || (o.object !== undefined && o.object !== 'refund')) return IGNORE;
  if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) return IGNORE;
  const md = isObj(o.metadata) ? o.metadata : {};
  const status = mapRefundStatus(o.status);
  // Only a well-formed refund id is passed to the database; anything else is treated as a refund made outside the app,
  // so a bad value cannot make the webhook fail (and Stripe retry it for days).
  const rawRefundId = str(md.refund_id);
  const refundId = rawRefundId && UUID_RE.test(rawRefundId) ? rawRefundId : undefined;
  const paymentIntent = ref(o.payment_intent);
  return {
    kind: 'refund-updated',
    stripeRefundId,
    amount: amountMinor / 100,
    status,
    ...(refundId ? { refundId } : {}),
    ...(paymentIntent ? { paymentIntent } : {}),
    ...(status === 'failed'
      ? { failureReason: o.status === 'canceled' && !o.failure_reason ? describeRefundFailure('merchant_request') : describeRefundFailure(o.failure_reason) }
      : {}),
  };
}

/** Turns a verified Stripe webhook event into the one thing the app needs to do about it. */
export function classifyEvent(event: unknown): ClassifiedEvent {
  if (!isObj(event) || !isObj(event.data) || !isObj(event.data.object)) return IGNORE;
  const o = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
      if (o.payment_status !== 'paid') return IGNORE;
      return paid(o.metadata, o.amount_total, ref(o.payment_intent), { sessionId: str(o.id), customerId: ref(o.customer) });
    case 'payment_intent.succeeded':
      return paid(o.metadata, o.amount_received, str(o.id), { customerId: ref(o.customer), paymentMethodId: ref(o.payment_method) });
    case 'payment_intent.payment_failed': {
      const md = isObj(o.metadata) ? o.metadata : {};
      const invoiceId = str(md.invoice_id);
      if (!invoiceId) return IGNORE;
      const attempt = wholeNumber(md.autopay_attempt);
      return {
        kind: 'payment-failed',
        invoiceId,
        message: describeStripeError(o.last_payment_error),
        autopay: md.autopay === '1',
        ...(attempt ? { attempt } : {}),
      };
    }
    case 'payment_method.attached': {
      const customerId = ref(o.customer);
      return customerId ? { kind: 'card-changed', customerId } : IGNORE;
    }
    case 'payment_method.detached': {
      const prev = isObj(event.data.previous_attributes) ? event.data.previous_attributes : {};
      const customerId = ref(prev.customer);
      return customerId ? { kind: 'card-changed', customerId } : IGNORE;
    }
    case 'customer.updated': {
      const customerId = str(o.id);
      return customerId ? { kind: 'card-changed', customerId } : IGNORE;
    }
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed':
    case 'charge.refund.updated':
      return refundEvent(o);
    default:
      return IGNORE;
  }
}
