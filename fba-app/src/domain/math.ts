/** Small numeric helpers shared across the domain layer (single source of truth). */

export const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n));

/** Round to `dp` decimal places, nudging by EPSILON so e.g. 1.005 → 1.01. */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export const round2 = (n: number): number => round(n, 2);
export const round4 = (n: number): number => round(n, 4);

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
