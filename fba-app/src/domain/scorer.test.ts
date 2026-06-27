import { describe, it, expect } from 'vitest';
import { scoreProduct, DEFAULT_SCORE_OPTIONS } from './scorer';
import { MarketSignal, OwnSalesSignal } from './signals';

function signal(overrides: Partial<MarketSignal> = {}): MarketSignal {
  return {
    source: 'market',
    keyword: 'silicone bottle',
    marketplace: 'amazon.ae',
    demandSeries: [100, 98, 102, 101, 99, 100],
    demandStability: 'steady',
    competitorCount: 30,
    avgPrice: 45,
    reviewCount: 300,
    reviewVelocity: 12,
    avgRating: 3.6,
    complaintRate: 0.25,
    provider: 'mock',
    ...overrides,
  };
}

describe('scoreProduct', () => {
  it('gives a strong product a GO', () => {
    const r = scoreProduct(signal(), { weightKg: 0.2 });
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.verdict).toBe('go');
    expect(r.criteria).toHaveLength(5);
  });

  it('penalises a saturated, spiky, bulky, overpriced product', () => {
    const r = scoreProduct(
      signal({ demandStability: 'spike', competitorCount: 200, avgPrice: 140, avgRating: 4.7, complaintRate: 0.02 }),
      { weightKg: 8 },
    );
    expect(r.score).toBeLessThan(50);
    expect(r.verdict).toBe('no-go');
  });

  it('reflects competition depth: fewer listings scores higher', () => {
    const few = scoreProduct(signal({ competitorCount: 20 })).criteria.find((c) => c.key === 'competitionDepth')!;
    const many = scoreProduct(signal({ competitorCount: 200 })).criteria.find((c) => c.key === 'competitionDepth')!;
    expect(few.score).toBeGreaterThan(many.score);
    expect(few.score).toBe(1);
    expect(many.score).toBe(0);
  });

  it('rewards review-gap (more complaints / weaker ratings)', () => {
    const gap = scoreProduct(signal({ complaintRate: 0.35, avgRating: 3.2 })).criteria.find((c) => c.key === 'reviewGap')!;
    const none = scoreProduct(signal({ complaintRate: 0.02, avgRating: 4.8 })).criteria.find((c) => c.key === 'reviewGap')!;
    expect(gap.score).toBeGreaterThan(none.score);
  });

  it('scores price-band fit highest inside AED 30–60', () => {
    const inBand = scoreProduct(signal({ avgPrice: 45 })).criteria.find((c) => c.key === 'priceBandFit')!;
    const high = scoreProduct(signal({ avgPrice: 120 })).criteria.find((c) => c.key === 'priceBandFit')!;
    expect(inBand.score).toBe(1);
    expect(high.score).toBeLessThan(inBand.score);
  });

  it('flags bulky weight class', () => {
    const light = scoreProduct(signal(), { weightKg: 0.2 }).criteria.find((c) => c.key === 'weightClass')!;
    const heavy = scoreProduct(signal(), { weightKg: 8 }).criteria.find((c) => c.key === 'weightClass')!;
    expect(light.score).toBeGreaterThan(heavy.score);
    expect(heavy.detail).toMatch(/bulky/i);
  });

  it('honours custom weights (zeroing a criterion removes its influence)', () => {
    const base = scoreProduct(signal({ competitorCount: 200 }));
    const noComp = scoreProduct(signal({ competitorCount: 200 }), {
      weights: { ...DEFAULT_SCORE_OPTIONS.weights, competitionDepth: 0 },
    });
    expect(noComp.score).toBeGreaterThan(base.score);
  });

  it('throws if own-sales (SP-API) data reaches the scorer', () => {
    const ownSales = { source: 'own-sales', asin: 'B0', units: 5, revenueAed: 200, acos: 0.3, inventory: 12 } as unknown as OwnSalesSignal;
    expect(() => scoreProduct(ownSales as unknown as MarketSignal)).toThrow(/own-sales/i);
  });
});
