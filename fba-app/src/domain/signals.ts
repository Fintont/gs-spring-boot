/**
 * Market-signal layer (Module 1, phase 1.x) — the *unbiased* demand plane.
 *
 * Core principle: keep two signal planes strictly separate.
 *
 *   Plane A — MARKET signal (this module): external demand & shopper behaviour —
 *     demand level/trend, competition depth, reviews, ratings, complaint/review-gap,
 *     price spread. Independent of anything we sell. Feeds Module 1 discovery & scoring.
 *
 *   Plane B — OWN-SALES signal (Module 2 / Amazon SP-API): our own units, revenue,
 *     ACoS, inventory. Feeds Module 2 tracking ONLY.
 *
 * Why the separation matters: our own sales data only covers products we already chose
 * and stocked. Letting it influence which *new* products we discover or score bakes in
 * survivorship/confirmation bias and hides untapped demand. So every signal is tagged
 * with its `source`, and the scoring path asserts it only ever consumes `'market'`.
 *
 * Pure module — no I/O, no framework. Providers (Keepa/Rainforest/trends) implement
 * `MarketSignalProvider` in phase 2; a deterministic mock lives here for offline work.
 */

export type SignalSource = 'market' | 'own-sales';

export type DemandStability = 'steady' | 'rising' | 'declining' | 'volatile' | 'spike' | 'insufficient';

/** External, bias-free market signal for a keyword/product. Always `source: 'market'`. */
export interface MarketSignal {
  readonly source: 'market';
  keyword: string;
  marketplace: string;
  /** Demand index over recent periods (higher = more demand). NOT our own sales. */
  demandSeries: number[];
  demandStability: DemandStability;
  /** Serious competing listings. */
  competitorCount: number;
  /** Average competitor price (AED). */
  avgPrice: number;
  /** Median competitor review count. */
  reviewCount: number;
  /** Reviews/month proxy — demand corroboration independent of our sales. */
  reviewVelocity: number;
  avgRating: number;
  /** Share of negative reviews (0–1) — the higher, the bigger the review-gap opening. */
  complaintRate: number;
  /** Provider that produced this signal. */
  provider: string;
}

/**
 * Internal performance signal from our own seller account (SP-API). Defined here ONLY
 * to make the boundary explicit and type-checkable. It must never reach the scorer.
 */
export interface OwnSalesSignal {
  readonly source: 'own-sales';
  asin: string;
  units: number;
  revenueAed: number;
  acos: number;
  inventory: number;
}

/** Pluggable market-data provider (Keepa, Rainforest, trends, …) — implemented in phase 2. */
export interface MarketSignalProvider {
  readonly name: string;
  fetchSignal(keyword: string, marketplace?: string): Promise<MarketSignal>;
}

/**
 * Firewall guard. The scorer calls this on anything it is about to consume; passing an
 * own-sales signal (or anything not tagged `'market'`) throws, by design.
 */
export function assertMarketSignal(s: { source: SignalSource }): asserts s is MarketSignal {
  if (s.source !== 'market') {
    throw new Error(
      `Module 1 scoring may only consume market signals, got source="${s.source}". ` +
        `Own-sales (SP-API) data must not influence discovery/scoring.`,
    );
  }
}

/** Filter a mixed list down to market signals, asserting nothing biased slips through. */
export function collectMarketSignals(items: ReadonlyArray<{ source: SignalSource }>): MarketSignal[] {
  return items.map((i) => {
    assertMarketSignal(i);
    return i;
  });
}

export interface StabilityResult {
  label: DemandStability;
  mean: number;
  /** Coefficient of variation (std / mean). */
  cv: number;
  /** Linear-fit slope per period, normalised by the mean. */
  slopePerPeriodPct: number;
  /** max / median(of the rest) — high when a single period dominates. */
  spikeRatio: number;
}

const STEADY_CV = 0.35; // at/under this, with no trend, demand is "steady"
const TREND_PCT = 0.08; // |slope/mean| per period above this is rising/declining
const SPIKE_RATIO = 3; // max must be ≥ 3× the median of the rest …
const SPIKE_REST_CV = 0.4; // … and the rest must be relatively flat to count as a one-off spike

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs: number[], m = mean(xs)): number {
  if (!xs.length) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Classify a demand time series into steady / rising / declining / volatile / spike.
 *
 * This operationalises the brief's "UAE demand stability (steady vs. one spike)"
 * criterion. Order: spike → trend → volatile → steady.
 */
export function classifyDemandStability(series: number[]): StabilityResult {
  const clean = series.filter((x) => Number.isFinite(x));
  const m = mean(clean);
  if (clean.length < 4 || m <= 0) {
    return { label: 'insufficient', mean: m, cv: 0, slopePerPeriodPct: 0, spikeRatio: 0 };
  }

  const cv = std(clean, m) / m;

  // Spike: one period dwarfs the rest, and the rest are flat.
  const maxVal = Math.max(...clean);
  const rest = clean.slice();
  rest.splice(rest.indexOf(maxVal), 1);
  const restMed = median(rest);
  const restMean = mean(rest);
  const spikeRatio = restMed > 0 ? maxVal / restMed : Infinity;
  const restCv = restMean > 0 ? std(rest, restMean) / restMean : 0;

  // Linear-fit slope (least squares) over period index 0..n-1.
  const n = clean.length;
  const ts = Array.from({ length: n }, (_, i) => i);
  const tMean = mean(ts);
  let cov = 0;
  let varT = 0;
  for (let i = 0; i < n; i++) {
    cov += (ts[i] - tMean) * (clean[i] - m);
    varT += (ts[i] - tMean) ** 2;
  }
  const slope = varT > 0 ? cov / varT : 0;
  const slopePerPeriodPct = slope / m;

  let label: DemandStability;
  if (spikeRatio >= SPIKE_RATIO && restCv < SPIKE_REST_CV) label = 'spike';
  else if (slopePerPeriodPct >= TREND_PCT) label = 'rising';
  else if (slopePerPeriodPct <= -TREND_PCT) label = 'declining';
  else if (cv > STEADY_CV) label = 'volatile';
  else label = 'steady';

  return { label, mean: m, cv, slopePerPeriodPct, spikeRatio };
}

/**
 * Default 0–1 desirability for each stability class (steady demand is best, a one-off
 * spike worst). These are tunable — final scoring weights are defined in phase 2.
 */
export const DEMAND_STABILITY_SCORE: Record<DemandStability, number> = {
  steady: 1,
  rising: 0.85,
  volatile: 0.45,
  insufficient: 0.5,
  declining: 0.2,
  spike: 0.1,
};

export function demandStabilityScore(label: DemandStability): number {
  return DEMAND_STABILITY_SCORE[label];
}

// ---------------------------------------------------------------------------
// Deterministic mock provider — lets Module 1 be developed/tested offline without
// any API key, and (critically) without touching own-sales data.
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32) so the mock is stable across runs/tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeries(rnd: () => number, base: number): number[] {
  const r = rnd();
  const jitter = () => base * (0.92 + rnd() * 0.16); // ±8%
  if (r < 0.5) return Array.from({ length: 8 }, jitter); // steady
  if (r < 0.7) return Array.from({ length: 8 }, (_, i) => base * (0.6 + i * 0.12) * (0.95 + rnd() * 0.1)); // rising
  if (r < 0.85) return Array.from({ length: 8 }, (_, i) => base * (1.5 - i * 0.14) * (0.95 + rnd() * 0.1)); // declining
  if (r < 0.95) return Array.from({ length: 8 }, () => base * (0.4 + rnd() * 1.3)); // volatile
  return Array.from({ length: 8 }, (_, i) => (i === 4 ? base * 7 : base * (0.9 + rnd() * 0.2))); // spike
}

/**
 * Deterministic, offline mock. Same keyword → same signal. Produces ONLY market-tagged
 * data; there is deliberately no path here that can emit own-sales figures.
 */
export class MockMarketSignalProvider implements MarketSignalProvider {
  readonly name = 'mock';

  async fetchSignal(keyword: string, marketplace = 'amazon.ae'): Promise<MarketSignal> {
    const rnd = mulberry32(hashString(`${keyword}|${marketplace}`));
    const base = 20 + rnd() * 200;
    const demandSeries = buildSeries(rnd, base).map((x) => Math.round(x));
    return {
      source: 'market',
      keyword,
      marketplace,
      demandSeries,
      demandStability: classifyDemandStability(demandSeries).label,
      competitorCount: Math.round(10 + rnd() * 120),
      avgPrice: Math.round((25 + rnd() * 60) * 100) / 100,
      reviewCount: Math.round(rnd() * 2000),
      reviewVelocity: Math.round(rnd() * 80),
      avgRating: Math.round((3.5 + rnd() * 1.5) * 10) / 10,
      complaintRate: Math.round((0.05 + rnd() * 0.4) * 100) / 100,
      provider: this.name,
    };
  }
}
