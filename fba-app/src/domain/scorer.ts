/**
 * Module 1 scoring engine (phase 2).
 *
 * Turns a (firewalled, market-only) MarketSignal plus optional product attributes into
 * a 0–100 score, a ✅/⚠️/❌ verdict per criterion, and an overall go/no-go.
 *
 * Criteria come straight from the brief's Stage-0 framework:
 *   - UAE demand stability (steady vs. one spike)
 *   - Competition depth (<~45 serious listings = good)
 *   - Review-gap opportunity (competitors with complaints / weak ratings to beat)
 *   - Price-band fit (AED 30–60 target)
 *   - Weight/size class (heavy/bulky → high FBA fee)
 *
 * Weights are configurable — the defaults below are a starting point, not gospel. The
 * scorer consumes ONLY market signals: it routes input through the assertMarketSignal
 * firewall so own-sales (SP-API) data can never bias a discovery decision.
 *
 * Pure module: no I/O, no framework.
 */

import { MarketSignal, assertMarketSignal, demandStabilityScore } from './signals';
import { estimateFbaFee } from './fees';

export type CriterionKey = 'demandStability' | 'competitionDepth' | 'reviewGap' | 'priceBandFit' | 'weightClass';

export type ScoreVerdict = 'pass' | 'warn' | 'fail';

export interface ScoringWeights {
  demandStability: number;
  competitionDepth: number;
  reviewGap: number;
  priceBandFit: number;
  weightClass: number;
}

/** Default criterion weights (relative — they are normalised, need not sum to 1). */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  demandStability: 0.25,
  competitionDepth: 0.2,
  reviewGap: 0.2,
  priceBandFit: 0.15,
  weightClass: 0.2,
};

export interface ScoreOptions {
  weights: ScoringWeights;
  /** Target price band (AED). Default 30–60. */
  priceBandMin: number;
  priceBandMax: number;
  /** Unit weight (kg) if known — drives the weight/size criterion. */
  weightKg?: number;
  /** Competition depth (serious listings) considered "good" at/under this. Default 45. */
  competitionGood: number;
  /** Competition depth considered saturated at/over this (score 0). Default 150. */
  competitionSaturated: number;
  /** Overall score (0–100) at/above which the verdict is GO. Default 70. */
  goThreshold: number;
  /** Overall score at/above which the verdict is WATCH; below is NO-GO. Default 50. */
  watchThreshold: number;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  weights: DEFAULT_WEIGHTS,
  priceBandMin: 30,
  priceBandMax: 60,
  competitionGood: 45,
  competitionSaturated: 150,
  goThreshold: 70,
  watchThreshold: 50,
};

export interface CriterionScore {
  key: CriterionKey;
  label: string;
  /** Normalised 0–1 desirability. */
  score: number;
  weight: number;
  verdict: ScoreVerdict;
  detail: string;
}

export interface ProductScore {
  keyword: string;
  marketplace: string;
  /** 0–100 weighted score. */
  score: number;
  verdict: 'go' | 'watch' | 'no-go';
  criteria: CriterionScore[];
  provider: string;
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

function verdictForScore(score: number): ScoreVerdict {
  if (score >= 0.66) return 'pass';
  if (score >= 0.4) return 'warn';
  return 'fail';
}

// --- individual criterion sub-scores (each returns 0..1) ---

function competitionScore(count: number, good: number, saturated: number): number {
  if (count <= good) return 1;
  if (count >= saturated) return 0;
  return clamp(1 - (count - good) / (saturated - good));
}

function priceBandScore(price: number, min: number, max: number): number {
  if (price >= min && price <= max) return 1;
  const dist = price < min ? (min - price) / min : (price - max) / max;
  return clamp(1 - dist, 0, 0.9);
}

function reviewGapScore(complaintRate: number, avgRating: number): number {
  // More complaints and weaker ratings = more room to win on quality.
  const complaintComponent = clamp(complaintRate / 0.35);
  const ratingGap = clamp((4.5 - avgRating) / 1.5);
  return clamp(0.5 * complaintComponent + 0.5 * ratingGap);
}

function weightClassScore(weightKg: number | undefined): { score: number; detail: string } {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) {
    return { score: 0.6, detail: 'weight unknown — neutral' };
  }
  const fba = estimateFbaFee(weightKg);
  // Map FBA fee band (8 AED light → 70 AED bulky) to 1..0.
  const score = clamp(1 - (fba.feeAed - 8) / (70 - 8));
  return { score, detail: `${fba.tier.label}${fba.bulky ? ' — bulky, high FBA fee' : ''}` };
}

/** Score a single product/keyword from its market signal. Market-only by construction. */
export function scoreProduct(signal: MarketSignal, options: Partial<ScoreOptions> = {}): ProductScore {
  assertMarketSignal(signal); // firewall: own-sales data cannot reach scoring
  const opts: ScoreOptions = { ...DEFAULT_SCORE_OPTIONS, ...options, weights: { ...DEFAULT_WEIGHTS, ...options.weights } };
  const w = opts.weights;

  const demand = demandStabilityScore(signal.demandStability);
  const competition = competitionScore(signal.competitorCount, opts.competitionGood, opts.competitionSaturated);
  const reviewGap = reviewGapScore(signal.complaintRate, signal.avgRating);
  const priceFit = priceBandScore(signal.avgPrice, opts.priceBandMin, opts.priceBandMax);
  const weightClass = weightClassScore(opts.weightKg);

  const criteria: CriterionScore[] = [
    { key: 'demandStability', label: 'Demand stability', score: demand, weight: w.demandStability, verdict: verdictForScore(demand), detail: signal.demandStability },
    { key: 'competitionDepth', label: 'Competition depth', score: competition, weight: w.competitionDepth, verdict: verdictForScore(competition), detail: `${signal.competitorCount} serious listings` },
    { key: 'reviewGap', label: 'Review-gap opportunity', score: reviewGap, weight: w.reviewGap, verdict: verdictForScore(reviewGap), detail: `${Math.round(signal.complaintRate * 100)}% complaints, ${signal.avgRating}★` },
    { key: 'priceBandFit', label: 'Price-band fit', score: priceFit, weight: w.priceBandFit, verdict: verdictForScore(priceFit), detail: `avg AED ${signal.avgPrice.toFixed(0)}` },
    { key: 'weightClass', label: 'Weight/size class', score: weightClass.score, weight: w.weightClass, verdict: verdictForScore(weightClass.score), detail: weightClass.detail },
  ];

  const totalWeight = criteria.reduce((a, c) => a + Math.max(0, c.weight), 0) || 1;
  const weighted = criteria.reduce((a, c) => a + c.score * Math.max(0, c.weight), 0) / totalWeight;
  const score = Math.round(weighted * 100);

  const verdict: ProductScore['verdict'] = score >= opts.goThreshold ? 'go' : score >= opts.watchThreshold ? 'watch' : 'no-go';

  return {
    keyword: signal.keyword,
    marketplace: signal.marketplace,
    score,
    verdict,
    criteria: criteria.map((c) => ({ ...c, score: round(c.score) })),
    provider: signal.provider,
  };
}
