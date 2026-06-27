/**
 * Keepa market-data provider.
 *
 * Keepa's strength is historical sales-rank/price time series, which is exactly what the
 * "demand stability (steady vs. one spike)" criterion needs. We map a Keepa product
 * object to a MarketSignal; the sales-rank history becomes the demand series.
 *
 * The pure mapper `mapKeepaToSignal` is unit-tested with fixtures. The KeepaProvider
 * class does the live HTTP (search term → first ASIN → product) and is intentionally
 * thin — its URLs/domain id must be verified against your Keepa plan.
 */

import { MarketSignal, MarketSignalProvider } from '../signals';
import {
  estimateComplaintRate, estimateReviewVelocity, finalizeSignal, parseKeepaSeries, rankToDemand, round2,
} from './util';

// Keepa csv channel indices (subset we use).
const C = { AMAZON: 0, NEW: 1, SALES: 3, COUNT_NEW: 11, RATING: 16, COUNT_REVIEWS: 17 } as const;

/** Minimal shape of a Keepa product object (only fields we read). */
export interface KeepaProductRaw {
  asin?: string;
  title?: string;
  csv?: (number[] | null)[];
  stats?: { current?: number[]; avg30?: number[] };
}

const pick = (v: number | undefined | null): number => (typeof v === 'number' && v >= 0 ? v : 0);

/** Map a Keepa product object to a market signal. Pure + fixture-tested. */
export function mapKeepaToSignal(raw: KeepaProductRaw, keyword: string, marketplace = 'amazon.ae'): MarketSignal {
  const csv = raw.csv ?? [];
  const stats = raw.stats ?? {};
  const cur = stats.current ?? [];
  const avg = stats.avg30 ?? [];

  // Sales-rank history → demand index (recent N valid points).
  const ranks = parseKeepaSeries(csv[C.SALES]).filter((p) => p.v > 0).slice(-12);
  const demandSeries = ranks.map((p) => rankToDemand(p.v));

  const ratingRaw = pick(cur[C.RATING]); // Keepa rating is ×10 (45 ⇒ 4.5★)
  const avgRating = ratingRaw > 0 ? round2(ratingRaw / 10) : 0;
  const reviewCount = pick(cur[C.COUNT_REVIEWS]);

  // Keepa prices are in the marketplace's minor units (fils for AED) → divide by 100.
  const priceMinor = pick(avg[C.NEW]) || pick(cur[C.NEW]) || pick(cur[C.AMAZON]);
  const avgPrice = priceMinor > 0 ? round2(priceMinor / 100) : 0;

  // COUNT_NEW = number of new offers — a proxy for competition depth (offers, not listings).
  const competitorCount = pick(cur[C.COUNT_NEW]);
  const reviewVelocity = estimateReviewVelocity(parseKeepaSeries(csv[C.COUNT_REVIEWS]));

  return finalizeSignal({
    keyword, marketplace, demandSeries, competitorCount, avgPrice,
    reviewCount, reviewVelocity, avgRating, complaintRate: estimateComplaintRate(avgRating), provider: 'keepa',
  });
}

/** Keepa numeric domain ids. ⚠️ Verify amazon.ae against your plan before relying on it. */
export const KEEPA_DOMAINS: Record<string, number> = {
  'amazon.com': 1, 'amazon.co.uk': 2, 'amazon.de': 3, 'amazon.in': 10, 'amazon.ae': 10 /* TODO: verify */,
};

export class KeepaProvider implements MarketSignalProvider {
  readonly name = 'keepa';

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly domainOverride?: number,
  ) {
    if (!apiKey) throw new Error('KeepaProvider requires an API key (set KEEPA_API_KEY)');
  }

  async fetchSignal(keyword: string, marketplace = 'amazon.ae'): Promise<MarketSignal> {
    const domain = this.domainOverride ?? KEEPA_DOMAINS[marketplace] ?? 1;
    const search = await this.json(
      `https://api.keepa.com/search?key=${this.apiKey}&domain=${domain}&type=product&term=${encodeURIComponent(keyword)}`,
    );
    const asin: string | undefined = search?.asinList?.[0] ?? search?.products?.[0]?.asin;
    if (!asin) throw new Error(`Keepa: no product found for "${keyword}"`);

    const product = await this.json(
      `https://api.keepa.com/product?key=${this.apiKey}&domain=${domain}&asin=${asin}&stats=30&rating=1&history=1`,
    );
    const raw: KeepaProductRaw | undefined = product?.products?.[0];
    if (!raw) throw new Error(`Keepa: empty product response for ASIN ${asin}`);
    return mapKeepaToSignal(raw, keyword, marketplace);
  }

  private async json(url: string): Promise<any> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`Keepa HTTP ${res.status}`);
    return res.json();
  }
}
