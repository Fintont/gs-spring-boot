/**
 * Shared helpers for real market-data providers (Keepa, Rainforest).
 *
 * The mapping helpers here are pure and unit-tested with fixtures — that is the part we
 * can verify without live API keys. Provider classes (which do the HTTP) live alongside
 * and delegate to these mappers.
 */

import { MarketSignal, classifyDemandStability } from '../signals';
import { clamp, round2 } from '../math';

export { clamp, round2, mean, median } from '../math';

export const isPosNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * No mainstream provider exposes a clean "negative review share", so we approximate a
 * complaint rate from the average rating: ~4.6★+ ≈ minimal complaints, ~3.0★ ≈ a large
 * unhappy share. This is a heuristic — documented as such, and easy to replace if a
 * provider later gives a real rating histogram.
 */
export function estimateComplaintRate(avgRating: number): number {
  if (!isPosNum(avgRating)) return 0;
  return round2(clamp((4.6 - avgRating) / 3.2, 0, 0.6));
}

/** Convert a sales rank to a demand index (lower rank ⇒ higher demand). */
export function rankToDemand(rank: number): number {
  return rank > 0 ? Math.round(1_000_000 / rank) : 0;
}

/**
 * Assemble a MarketSignal from computed fields: stamps `source: 'market'` (so the
 * firewall is satisfied centrally) and derives demandStability from the series.
 */
export function finalizeSignal(s: Omit<MarketSignal, 'source' | 'demandStability'>): MarketSignal {
  return { source: 'market', ...s, demandStability: classifyDemandStability(s.demandSeries).label };
}

/** A Keepa csv channel is [time, value, time, value, …]; split into {t, v} pairs. */
export function parseKeepaSeries(arr: number[] | null | undefined): { t: number; v: number }[] {
  if (!Array.isArray(arr)) return [];
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) out.push({ t: arr[i], v: arr[i + 1] });
  return out;
}

/** Keepa "minutes" → unix ms. */
export function keepaMinutesToMs(km: number): number {
  return (km + 21564000) * 60000;
}

/** Estimate reviews/month from a Keepa COUNT_REVIEWS history channel. */
export function estimateReviewVelocity(pairs: { t: number; v: number }[]): number {
  const valid = pairs.filter((p) => p.v >= 0);
  if (valid.length < 2) return 0;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const months = (keepaMinutesToMs(last.t) - keepaMinutesToMs(first.t)) / (1000 * 60 * 60 * 24 * 30);
  if (months <= 0) return 0;
  return Math.max(0, Math.round((last.v - first.v) / months));
}
