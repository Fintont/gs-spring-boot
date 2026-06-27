/**
 * Rainforest API market-data provider.
 *
 * Rainforest gives rich *live* Amazon listing/review/competitor data via a simple REST
 * search, but little price/rank history. So we use it for competition depth, pricing and
 * review signals — and deliberately leave the demand series empty (→ stability
 * "insufficient"), because assessing steady-vs-spike demand needs history (use Keepa for
 * that, or combine the two later).
 *
 * The pure mapper `mapRainforestToSignal` is unit-tested with fixtures; the provider
 * class does the live HTTP.
 */

import { MarketSignal, MarketSignalProvider } from '../signals';
import { estimateComplaintRate, finalizeSignal, isPosNum, mean, median, round2 } from './util';

/** Minimal shape of a Rainforest `type=search` response (only fields we read). */
export interface RainforestSearchRaw {
  search_results?: Array<{
    asin?: string;
    title?: string;
    price?: { value?: number };
    rating?: number;
    ratings_total?: number;
  }>;
  pagination?: { total_results?: number };
  search_information?: { total_results?: number };
}

/** Map a Rainforest search response to a market signal. Pure + fixture-tested. */
export function mapRainforestToSignal(raw: RainforestSearchRaw, keyword: string, marketplace = 'amazon.ae'): MarketSignal {
  const results = raw.search_results ?? [];
  const prices = results.map((r) => r.price?.value).filter(isPosNum);
  const ratings = results.map((r) => r.rating).filter(isPosNum);
  const reviewCounts = results.map((r) => r.ratings_total).filter(isPosNum);

  const avgPrice = prices.length ? round2(mean(prices)) : 0;
  const avgRating = ratings.length ? round2(mean(ratings)) : 0;
  const reviewCount = reviewCounts.length ? Math.round(median(reviewCounts)) : 0;
  // The number of serious competing listings, NOT the catalogue-wide total_results
  // (which is often thousands and would peg every keyword to "saturated"). Use the count
  // of returned search results — the visible front-page competition.
  const competitorCount = results.length;

  return finalizeSignal({
    keyword, marketplace,
    demandSeries: [], // Rainforest has no rank history → stability "insufficient" by design
    competitorCount, avgPrice, reviewCount,
    reviewVelocity: 0, avgRating, complaintRate: estimateComplaintRate(avgRating), provider: 'rainforest',
  });
}

export class RainforestProvider implements MarketSignalProvider {
  readonly name = 'rainforest';

  constructor(private readonly apiKey: string, private readonly fetchFn: typeof fetch = fetch) {
    if (!apiKey) throw new Error('RainforestProvider requires an API key (set RAINFOREST_API_KEY)');
  }

  async fetchSignal(keyword: string, marketplace = 'amazon.ae'): Promise<MarketSignal> {
    const url =
      `https://api.rainforestapi.com/request?api_key=${this.apiKey}` +
      `&type=search&amazon_domain=${encodeURIComponent(marketplace)}&search_term=${encodeURIComponent(keyword)}`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`Rainforest HTTP ${res.status}`);
    return mapRainforestToSignal(await res.json(), keyword, marketplace);
  }
}
