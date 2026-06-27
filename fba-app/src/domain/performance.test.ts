import { describe, it, expect } from 'vitest';
import {
  computeSummary, marginOverTime, burnDown, reorderAlerts, assertOwnSales,
  MockSpApiProvider, ProductPerformance, SalesPoint,
} from './performance';

function series(units: number[], price: number, adPct = 0.1): SalesPoint[] {
  return units.map((u, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, units: u, revenueAed: u * price, adSpendAed: u * price * adPct }));
}

function product(over: Partial<ProductPerformance> = {}): ProductPerformance {
  return {
    source: 'own-sales', asin: 'B0', name: 'Test', landedCostPerUnit: 12, referralFeePct: 0.15,
    fbaFeePerUnit: 11, vatRatePct: 0.05, inventory: 200, reorderThreshold: 60, leadTimeDays: 30,
    series: series([5, 5, 5, 5, 5], 49), ...over,
  };
}

describe('computeSummary', () => {
  it('aggregates units/revenue/ACoS', () => {
    const s = computeSummary(product());
    expect(s.units).toBe(25);
    expect(s.revenueAed).toBe(25 * 49);
    // ad = 10% of VAT-incl revenue → 10.5% of ex-VAT revenue (the ACoS base)
    expect(s.acos).toBeCloseTo(0.105, 4);
  });

  it('treats VAT as pass-through in profit', () => {
    // price 105 incl → exVat 100/unit; referral 15, fba 11, landed 12, ad 10.5 → profit 51.5/unit
    const s = computeSummary(product({ series: series([1], 105, 0.1) }));
    expect(s.revenueExVatAed).toBe(100);
    expect(s.vatAed).toBe(5);
    expect(s.profitPerUnitAed).toBeCloseTo(51.5, 1);
    expect(s.netMarginPct).toBeCloseTo(0.515, 3);
  });

  it('computes days of cover from average daily sales', () => {
    const s = computeSummary(product({ inventory: 100, series: series([10, 10, 10, 10, 10], 49) }));
    expect(s.avgDailyUnits).toBe(10);
    expect(s.daysOfCover).toBe(10);
  });
});

describe('reorder logic', () => {
  it('flags when inventory is at/below threshold', () => {
    expect(computeSummary(product({ inventory: 50, reorderThreshold: 60 })).reorderNeeded).toBe(true);
  });

  it('flags when days-of-cover is within lead time', () => {
    // 10 units/day, inventory 120, lead time 30 → 12 days cover ≤ 30 → reorder
    const s = computeSummary(product({ inventory: 120, reorderThreshold: 10, leadTimeDays: 30, series: series([10, 10, 10, 10, 10], 49) }));
    expect(s.daysOfCover).toBe(12);
    expect(s.reorderNeeded).toBe(true);
  });

  it('does not flag healthy stock', () => {
    const s = computeSummary(product({ inventory: 1000, reorderThreshold: 60, leadTimeDays: 30, series: series([2, 2, 2, 2, 2], 49) }));
    expect(s.reorderNeeded).toBe(false);
  });

  it('keeps displayed daysOfCover and the reorder flag consistent at the boundary', () => {
    // 10 units/day, inventory 304 → 30.4 days, rounds to 30 ≤ leadTime 30 → reorder.
    const s = computeSummary(product({ inventory: 304, reorderThreshold: 10, leadTimeDays: 30, series: series([10, 10, 10, 10, 10], 49) }));
    expect(s.daysOfCover).toBe(30);
    expect(s.reorderNeeded).toBe(true); // matches the shown 30 ≤ 30, no contradiction
  });

  it('reorderAlerts returns only products needing restock', () => {
    const alerts = reorderAlerts([product({ asin: 'LOW', inventory: 20 }), product({ asin: 'OK', inventory: 5000, series: series([1, 1, 1, 1, 1], 49) })]);
    expect(alerts.map((a) => a.product.asin)).toEqual(['LOW']);
  });
});

describe('marginOverTime & burnDown', () => {
  it('returns a margin point per period', () => {
    const m = marginOverTime(product());
    expect(m).toHaveLength(5);
    expect(m[0]).toHaveProperty('netMarginPct');
  });

  it('burns inventory down toward zero', () => {
    const b = burnDown(product({ inventory: 50, series: series([10, 10, 10, 10, 10], 49) }), 30);
    expect(b[0].units).toBe(50);
    expect(b[b.length - 1].units).toBe(0); // 10/day → empty by day 5
  });
});

describe('own-sales firewall & mock provider', () => {
  it('assertOwnSales accepts own-sales and rejects market', () => {
    expect(() => assertOwnSales(product())).not.toThrow();
    expect(() => assertOwnSales({ source: 'market' } as never)).toThrow(/own-sales/i);
  });

  it('mock provider returns a deterministic own-sales portfolio', async () => {
    const p = new MockSpApiProvider();
    const a = await p.fetchPortfolio();
    const b = await p.fetchPortfolio();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    a.forEach((x) => expect(x.source).toBe('own-sales'));
  });
});
