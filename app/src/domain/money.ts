/** Rounds to whole fils (two decimal places). */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 'AED 1,250' or 'AED 199.50'. */
export function formatAED(n: number): string {
  const fixed = roundMoney(n).toFixed(Number.isInteger(roundMoney(n)) ? 0 : 2);
  return `AED ${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
