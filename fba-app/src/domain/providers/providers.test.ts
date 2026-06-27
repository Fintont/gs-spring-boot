import { describe, it, expect } from 'vitest';
import { mapKeepaToSignal, KeepaProductRaw, KeepaProvider } from './keepa';
import { mapRainforestToSignal, RainforestSearchRaw, RainforestProvider } from './rainforest';
import { assertMarketSignal } from '../signals';
import { estimateComplaintRate, rankToDemand } from './util';

// Build a Keepa csv channel [t, v, t, v, …] from value list, with increasing times.
function channel(values: number[], step = 43200): number[] {
  const out: number[] = [];
  values.forEach((v, i) => out.push(i * step, v));
  return out;
}

describe('util', () => {
  it('estimateComplaintRate falls as rating rises', () => {
    expect(estimateComplaintRate(3.0)).toBeGreaterThan(estimateComplaintRate(4.6));
    expect(estimateComplaintRate(4.9)).toBe(0);
  });
  it('rankToDemand inverts rank', () => {
    expect(rankToDemand(1000)).toBeGreaterThan(rankToDemand(50000));
  });
});

describe('mapKeepaToSignal', () => {
  const csv: (number[] | null)[] = [];
  csv[3] = channel([2000, 2100, 1950, 2050, 2000, 1980]); // steady sales rank
  csv[16] = channel([42, 43]); // rating ×10
  csv[17] = channel([100, 160]); // review count grows
  const raw: KeepaProductRaw = {
    asin: 'B0TEST',
    csv,
    stats: { current: rankStats({ NEW: 4500, COUNT_NEW: 22, RATING: 43, COUNT_REVIEWS: 160 }), avg30: rankStats({ NEW: 4600 }) },
  };

  it('maps rating, reviews, price and competition', () => {
    const s = mapKeepaToSignal(raw, 'silicone bottle');
    expect(s.source).toBe('market');
    expect(s.avgRating).toBe(4.3);
    expect(s.reviewCount).toBe(160);
    expect(s.avgPrice).toBe(46); // 4600 minor units / 100
    expect(s.competitorCount).toBe(22);
    expect(() => assertMarketSignal(s)).not.toThrow();
  });

  it('derives a demand series from sales-rank history', () => {
    const s = mapKeepaToSignal(raw, 'silicone bottle');
    expect(s.demandSeries.length).toBe(6);
    expect(s.demandStability).toBe('steady');
  });

  it('estimates review velocity as positive when reviews grow', () => {
    expect(mapKeepaToSignal(raw, 'x').reviewVelocity).toBeGreaterThan(0);
  });
});

describe('mapRainforestToSignal', () => {
  const raw: RainforestSearchRaw = {
    search_results: [
      { asin: 'A1', price: { value: 39 }, rating: 4.1, ratings_total: 220 },
      { asin: 'A2', price: { value: 49 }, rating: 3.8, ratings_total: 90 },
      { asin: 'A3', price: { value: 0 }, rating: 4.4, ratings_total: 500 }, // price filtered out
    ],
    pagination: { total_results: 64 },
  };

  it('aggregates price, rating, reviews and competition', () => {
    const s = mapRainforestToSignal(raw, 'phone mount');
    expect(s.source).toBe('market');
    expect(s.avgPrice).toBe(44); // mean(39,49)
    expect(s.avgRating).toBeCloseTo(4.1, 1); // mean(4.1,3.8,4.4)
    expect(s.reviewCount).toBe(220); // median(220,90,500)
    expect(s.competitorCount).toBe(64);
  });

  it('marks demand stability insufficient (no history)', () => {
    expect(mapRainforestToSignal(raw, 'x').demandStability).toBe('insufficient');
  });
});

describe('provider classes (stubbed fetch)', () => {
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

  it('KeepaProvider searches then fetches the product', async () => {
    const calls: string[] = [];
    const fetchFn = ((url: string) => {
      calls.push(url);
      if (url.includes('/search')) return ok({ asinList: ['B0XYZ'] });
      return ok({ products: [{ asin: 'B0XYZ', csv: [], stats: { current: rankStats({ RATING: 40 }) } }] });
    }) as unknown as typeof fetch;
    const p = new KeepaProvider('key123', fetchFn);
    const s = await p.fetchSignal('led light');
    expect(calls[0]).toContain('/search');
    expect(calls[1]).toContain('/product');
    expect(s.provider).toBe('keepa');
  });

  it('KeepaProvider throws on no result', async () => {
    const fetchFn = (() => ok({ asinList: [] })) as unknown as typeof fetch;
    await expect(new KeepaProvider('k', fetchFn).fetchSignal('zzz')).rejects.toThrow(/no product/i);
  });

  it('RainforestProvider maps a search response', async () => {
    const fetchFn = (() => ok({ search_results: [{ price: { value: 35 }, rating: 4.2, ratings_total: 50 }] })) as unknown as typeof fetch;
    const s = await new RainforestProvider('key', fetchFn).fetchSignal('bottle');
    expect(s.provider).toBe('rainforest');
    expect(s.avgPrice).toBe(35);
  });

  it('requires an API key', () => {
    expect(() => new KeepaProvider('')).toThrow(/key/i);
    expect(() => new RainforestProvider('')).toThrow(/key/i);
  });
});

// Build a Keepa stats array indexed by channel, with -1 for unset slots.
function rankStats(vals: Partial<Record<'AMAZON' | 'NEW' | 'SALES' | 'COUNT_NEW' | 'RATING' | 'COUNT_REVIEWS', number>>): number[] {
  const idx = { AMAZON: 0, NEW: 1, SALES: 3, COUNT_NEW: 11, RATING: 16, COUNT_REVIEWS: 17 } as const;
  const arr = new Array(18).fill(-1);
  for (const [k, v] of Object.entries(vals)) arr[idx[k as keyof typeof idx]] = v as number;
  return arr;
}
