/** Money helpers shared by billing, rates and tax (kept separate so none imports another in a cycle). */

/** Round to fils (2 dp), half away from zero, without binary floating-point surprises (1.005 -> 1.01). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = (Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toPrecision(12)))) / 100;
  return r === 0 ? 0 : r;
}

/** Round to fils, half away from zero and float-safe (see round2). */
export function roundMoney(n: number): number {
  return round2(n);
}

/** 'AED 1,250' or 'AED 199.50'. A negative amount takes a minus sign before the currency ('−AED 2,480'), as on invoices and credit notes. */
export function formatAED(n: number): string {
  const v = roundMoney(n);
  const fixed = Math.abs(v).toFixed(Number.isInteger(v) ? 0 : 2);
  return `${v < 0 ? '−' : ''}AED ${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
