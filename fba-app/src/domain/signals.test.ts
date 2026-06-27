import { describe, it, expect } from 'vitest';
import {
  classifyDemandStability,
  demandStabilityScore,
  assertMarketSignal,
  collectMarketSignals,
  MockMarketSignalProvider,
  MarketSignal,
  OwnSalesSignal,
} from './signals';

describe('classifyDemandStability', () => {
  it('flags steady demand', () => {
    expect(classifyDemandStability([100, 98, 102, 101, 99, 100]).label).toBe('steady');
  });

  it('flags a one-off spike (the brief\'s "steady vs one spike")', () => {
    expect(classifyDemandStability([10, 12, 11, 10, 95, 11, 9]).label).toBe('spike');
  });

  it('flags rising demand', () => {
    expect(classifyDemandStability([50, 60, 72, 85, 100, 120]).label).toBe('rising');
  });

  it('flags declining demand', () => {
    expect(classifyDemandStability([120, 100, 85, 70, 55, 40]).label).toBe('declining');
  });

  it('flags volatile demand with no single dominating period', () => {
    expect(classifyDemandStability([50, 90, 40, 95, 30, 100]).label).toBe('volatile');
  });

  it('returns insufficient for short series', () => {
    expect(classifyDemandStability([100, 100]).label).toBe('insufficient');
  });

  it('scores steady above spike', () => {
    expect(demandStabilityScore('steady')).toBeGreaterThan(demandStabilityScore('spike'));
  });
});

describe('signal firewall', () => {
  const market: MarketSignal = {
    source: 'market', keyword: 'x', marketplace: 'amazon.ae', demandSeries: [1, 1, 1, 1],
    demandStability: 'steady', competitorCount: 10, avgPrice: 40, reviewCount: 100,
    reviewVelocity: 5, avgRating: 4.2, complaintRate: 0.1, provider: 'mock',
  };
  const ownSales: OwnSalesSignal = { source: 'own-sales', asin: 'B0', units: 5, revenueAed: 200, acos: 0.3, inventory: 12 };

  it('accepts market signals', () => {
    expect(() => assertMarketSignal(market)).not.toThrow();
  });

  it('rejects own-sales (SP-API) data from the scoring path', () => {
    expect(() => assertMarketSignal(ownSales)).toThrow(/own-sales/i);
  });

  it('collectMarketSignals throws if any biased signal is mixed in', () => {
    expect(() => collectMarketSignals([market, ownSales])).toThrow(/own-sales/i);
    expect(collectMarketSignals([market, market])).toHaveLength(2);
  });
});

describe('MockMarketSignalProvider', () => {
  it('is deterministic for a given keyword', async () => {
    const p = new MockMarketSignalProvider();
    const a = await p.fetchSignal('silicone bottle');
    const b = await p.fetchSignal('silicone bottle');
    expect(a).toEqual(b);
  });

  it('only ever emits market-tagged signals', async () => {
    const s = await new MockMarketSignalProvider().fetchSignal('phone mount');
    expect(s.source).toBe('market');
    expect(() => assertMarketSignal(s)).not.toThrow();
    expect(s.demandSeries.length).toBeGreaterThanOrEqual(4);
  });

  it('derives demandStability consistently from its own series', async () => {
    const s = await new MockMarketSignalProvider().fetchSignal('led ring light');
    expect(s.demandStability).toBe(classifyDemandStability(s.demandSeries).label);
  });
});
