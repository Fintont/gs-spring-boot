/**
 * Module 2 — live performance & profit tracking (phase 4). OWN-SALES plane.
 *
 * This is Plane B from docs/data-separation.md: real seller data from Amazon SP-API
 * (units, revenue, ad spend, inventory). It is tagged `source: 'own-sales'` and must NEVER
 * feed Module 1 discovery/scoring — `assertOwnSales` is the symmetric guard, and the
 * scorer's `assertMarketSignal` already rejects anything tagged this way.
 *
 * Pure module: metrics are framework-free and unit-tested. A deterministic mock provider
 * stands in for SP-API until LWA credentials are supplied; the real adapter is stubbed.
 */

export interface SalesPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  units: number;
  /** Gross revenue for the period (AED, VAT-inclusive). */
  revenueAed: number;
  /** Advertising spend for the period (AED). */
  adSpendAed: number;
}

export interface ProductPerformance {
  readonly source: 'own-sales';
  asin: string;
  name: string;
  /** Actual landed cost per unit (AED). */
  landedCostPerUnit: number;
  /** Amazon referral fee as a fraction of the ex-VAT item price. */
  referralFeePct: number;
  /** FBA fulfilment fee per unit (AED). */
  fbaFeePerUnit: number;
  /** VAT rate (fraction, 0.05 for UAE). */
  vatRatePct: number;
  /** Current units in the fulfilment centre. */
  inventory: number;
  /** Restock when inventory hits this level. */
  reorderThreshold: number;
  /** Replenishment lead time (days) — also triggers a reorder via days-of-cover. */
  leadTimeDays: number;
  /** Chronological sales history. */
  series: SalesPoint[];
}

export interface SpApiProvider {
  readonly name: string;
  /** Fetch the seller's tracked product portfolio. */
  fetchPortfolio(): Promise<ProductPerformance[]>;
}

/** Firewall (symmetric to assertMarketSignal): confirm data is own-sales before use here. */
export function assertOwnSales(x: { source: string }): asserts x is ProductPerformance {
  if (x.source !== 'own-sales') {
    throw new Error(`Module 2 expects own-sales data, got source="${x.source}".`);
  }
}

export interface PerfSummary {
  units: number;
  revenueAed: number;
  revenueExVatAed: number;
  adSpendAed: number;
  /** Advertising Cost of Sales = ad spend / revenue. */
  acos: number;
  referralAed: number;
  fbaAed: number;
  landedAed: number;
  vatAed: number;
  netProfitAed: number;
  /** Net profit / ex-VAT revenue. */
  netMarginPct: number;
  profitPerUnitAed: number;
  avgDailyUnits: number;
  daysOfCover: number;
  inventory: number;
  reorderNeeded: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** True net profit for a window: VAT is treated as pass-through (remitted, not retained). */
export function computeSummary(p: ProductPerformance): PerfSummary {
  const units = p.series.reduce((a, s) => a + s.units, 0);
  const revenueAed = p.series.reduce((a, s) => a + s.revenueAed, 0);
  const adSpendAed = p.series.reduce((a, s) => a + s.adSpendAed, 0);

  const revenueExVatAed = revenueAed / (1 + p.vatRatePct);
  const vatAed = revenueAed - revenueExVatAed;
  const referralAed = p.referralFeePct * revenueExVatAed;
  const fbaAed = p.fbaFeePerUnit * units;
  const landedAed = p.landedCostPerUnit * units;

  const netProfitAed = revenueExVatAed - referralAed - fbaAed - landedAed - adSpendAed;
  const netMarginPct = revenueExVatAed > 0 ? netProfitAed / revenueExVatAed : 0;
  const avgDailyUnits = p.series.length > 0 ? units / p.series.length : 0;
  const daysOfCover = avgDailyUnits > 0 ? p.inventory / avgDailyUnits : Infinity;
  const reorderNeeded = p.inventory <= p.reorderThreshold || daysOfCover <= p.leadTimeDays;

  return {
    units,
    revenueAed: round2(revenueAed),
    revenueExVatAed: round2(revenueExVatAed),
    adSpendAed: round2(adSpendAed),
    acos: revenueAed > 0 ? round4(adSpendAed / revenueAed) : 0,
    referralAed: round2(referralAed),
    fbaAed: round2(fbaAed),
    landedAed: round2(landedAed),
    vatAed: round2(vatAed),
    netProfitAed: round2(netProfitAed),
    netMarginPct: round4(netMarginPct),
    profitPerUnitAed: units > 0 ? round2(netProfitAed / units) : 0,
    avgDailyUnits: round2(avgDailyUnits),
    daysOfCover: Number.isFinite(daysOfCover) ? Math.round(daysOfCover) : Infinity,
    inventory: p.inventory,
    reorderNeeded,
  };
}

export interface MarginPoint {
  date: string;
  netProfitAed: number;
  netMarginPct: number;
}

/** Per-period net margin/profit over time (for the margin trend chart). */
export function marginOverTime(p: ProductPerformance): MarginPoint[] {
  return p.series.map((s) => {
    const exVat = s.revenueAed / (1 + p.vatRatePct);
    const profit = exVat - p.referralFeePct * exVat - p.fbaFeePerUnit * s.units - p.landedCostPerUnit * s.units - s.adSpendAed;
    return { date: s.date, netProfitAed: round2(profit), netMarginPct: exVat > 0 ? round4(profit / exVat) : 0 };
  });
}

export interface BurnPoint {
  day: number;
  units: number;
}

/** Project inventory burn-down from current stock and average daily sales. */
export function burnDown(p: ProductPerformance, horizonDays = 30): BurnPoint[] {
  const units = p.series.reduce((a, s) => a + s.units, 0);
  const avgDaily = p.series.length > 0 ? units / p.series.length : 0;
  const out: BurnPoint[] = [];
  for (let day = 0; day <= horizonDays; day++) {
    out.push({ day, units: Math.max(0, Math.round(p.inventory - avgDaily * day)) });
    if (p.inventory - avgDaily * day <= 0) break;
  }
  return out;
}

/** Products that need restocking now. */
export function reorderAlerts(portfolio: ProductPerformance[]): { product: ProductPerformance; summary: PerfSummary }[] {
  return portfolio
    .map((product) => ({ product, summary: computeSummary(product) }))
    .filter((x) => x.summary.reorderNeeded);
}

// ---------------------------------------------------------------------------
// Deterministic mock SP-API provider (offline). Real adapter is stubbed below.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_DATE = '2026-06-01';
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildProduct(seed: number, spec: { asin: string; name: string; price: number; landed: number; inventory: number }): ProductPerformance {
  const rnd = mulberry32(seed);
  const days = 14;
  const series: SalesPoint[] = Array.from({ length: days }, (_, i) => {
    const units = Math.max(0, Math.round(3 + rnd() * 7));
    return {
      date: addDays(BASE_DATE, i),
      units,
      revenueAed: round2(units * spec.price),
      adSpendAed: round2(units * spec.price * (0.08 + rnd() * 0.12)),
    };
  });
  return {
    source: 'own-sales',
    asin: spec.asin,
    name: spec.name,
    landedCostPerUnit: spec.landed,
    referralFeePct: 0.15,
    fbaFeePerUnit: 11,
    vatRatePct: 0.05,
    inventory: spec.inventory,
    reorderThreshold: 60,
    leadTimeDays: 30,
    series,
  };
}

export class MockSpApiProvider implements SpApiProvider {
  readonly name = 'mock';
  async fetchPortfolio(): Promise<ProductPerformance[]> {
    return [
      buildProduct(101, { asin: 'B0AAA001', name: 'Silicone collapsible bottle', price: 49, landed: 12, inventory: 220 }),
      buildProduct(202, { asin: 'B0BBB002', name: 'Magnetic phone mount', price: 39, landed: 8, inventory: 45 }),
      buildProduct(303, { asin: 'B0CCC003', name: 'Bamboo cutlery travel set', price: 35, landed: 6, inventory: 140 }),
    ];
  }
}

/**
 * Real Amazon SP-API adapter — STUB. Wiring SP-API needs LWA OAuth (refresh token →
 * access token), AWS SigV4, the Sellers/Orders/Finances/FBA-Inventory endpoints, and the
 * seller's region/marketplace id. Credentials come from env (never hardcoded):
 *   SPAPI_LWA_CLIENT_ID, SPAPI_LWA_CLIENT_SECRET, SPAPI_LWA_REFRESH_TOKEN,
 *   SPAPI_MARKETPLACE_ID (A2VIGQ35RCS4UA for amazon.ae).
 */
export class RealSpApiProvider implements SpApiProvider {
  readonly name = 'spapi';
  constructor(private readonly creds: { clientId?: string; clientSecret?: string; refreshToken?: string; marketplaceId?: string } = {}) {}
  async fetchPortfolio(): Promise<ProductPerformance[]> {
    if (!this.creds.refreshToken) throw new Error('SP-API not configured: set SPAPI_LWA_* env vars (see .env.example)');
    throw new Error('SP-API adapter not yet implemented — provide seller credentials to complete step 4');
  }
}
