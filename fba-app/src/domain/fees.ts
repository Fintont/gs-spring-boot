/**
 * Rough Amazon.ae (UAE) FBA fulfilment-fee estimator.
 *
 * ⚠️  These figures are ESTIMATES for sanity-checking only. Amazon updates the
 * UAE FBA fee schedule periodically and fees vary by exact dimensions, category
 * and storage. ALWAYS confirm against the current official Amazon.ae fee
 * schedule before committing to a product. The calculator lets you override the
 * FBA fee with a real figure at any time — this estimator is just a starting point.
 *
 * Tiers below are weight bands (in kg) mapped to an indicative AED fulfilment fee.
 * Keep `LAST_REVIEWED` honest when you refresh these numbers.
 */

export const LAST_REVIEWED = '2026-06 (indicative — verify before relying on it)';

export interface FbaTier {
  /** Inclusive upper bound of the band, in kilograms. */
  maxWeightKg: number;
  /** Indicative Amazon.ae fulfilment fee in AED. */
  feeAed: number;
  /** Human label for the size class. */
  label: string;
  /** True when the band is considered heavy/bulky and should be flagged. */
  bulky: boolean;
}

export const FBA_TIERS: FbaTier[] = [
  { maxWeightKg: 0.25, feeAed: 8, label: 'Small light (≤250 g)', bulky: false },
  { maxWeightKg: 0.5, feeAed: 11, label: 'Standard small (≤500 g)', bulky: false },
  { maxWeightKg: 1, feeAed: 15, label: 'Standard (≤1 kg)', bulky: false },
  { maxWeightKg: 2, feeAed: 20, label: 'Standard large (≤2 kg)', bulky: false },
  { maxWeightKg: 5, feeAed: 30, label: 'Large (≤5 kg)', bulky: true },
  { maxWeightKg: 10, feeAed: 45, label: 'Heavy (≤10 kg)', bulky: true },
  { maxWeightKg: Infinity, feeAed: 70, label: 'Oversize/bulky (>10 kg)', bulky: true },
];

export interface FbaEstimate {
  feeAed: number;
  tier: FbaTier;
  /** True if the unit lands in a heavy/bulky band (high FBA fee → margin risk). */
  bulky: boolean;
  disclaimer: string;
}

/** Estimate the Amazon.ae FBA fee for a unit weight, and flag bulky items. */
export function estimateFbaFee(weightKg: number): FbaEstimate {
  const w = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 0;
  const tier = FBA_TIERS.find((t) => w <= t.maxWeightKg) ?? FBA_TIERS[FBA_TIERS.length - 1];
  return {
    feeAed: tier.feeAed,
    tier,
    bulky: tier.bulky,
    disclaimer: `Estimate only (schedule last reviewed ${LAST_REVIEWED}). Verify on Amazon.ae and override.`,
  };
}
