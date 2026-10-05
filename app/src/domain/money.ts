/** Money helpers shared by billing and tax (kept separate so neither imports the other in a cycle). */

/** Round to fils (2 dp), half away from zero, without binary floating-point surprises (1.005 -> 1.01). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = (Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toPrecision(12)))) / 100;
  return r === 0 ? 0 : r;
}
