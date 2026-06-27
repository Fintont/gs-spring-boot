import { describe, it, expect } from 'vitest';
import { computeMargin, breakEven, DEFAULT_INPUTS, MarginInputs } from './margin';
import { estimateFbaFee } from './fees';

function inputs(overrides: Partial<MarginInputs> = {}): MarginInputs {
  return {
    sellingPrice: 50,
    supplierPrice: 8,
    freightPerUnit: 2,
    fbaFee: 15,
    ...DEFAULT_INPUTS,
    ...overrides,
  };
}

describe('computeMargin — VAT inclusive (default)', () => {
  it('splits a VAT-inclusive price into ex-VAT item price + VAT', () => {
    const b = computeMargin(inputs({ sellingPrice: 52.5 }));
    // 52.5 / 1.05 = 50 ex-VAT, VAT = 2.5
    expect(b.itemPriceExVat).toBe(50);
    expect(b.vat).toBe(2.5);
  });

  it('does not deduct pass-through VAT from profit', () => {
    const b = computeMargin(inputs({ sellingPrice: 105 }));
    // item ex-VAT = 100; referral 15, ad 10, fba 15, landed 10 => profit 50
    expect(b.itemPriceExVat).toBe(100);
    expect(b.referralFee).toBe(15);
    expect(b.adCost).toBe(10);
    expect(b.netProfit).toBe(50);
    expect(b.netMarginPct).toBe(0.5);
  });

  it('computes ROI on landed cost', () => {
    const b = computeMargin(inputs({ sellingPrice: 105 }));
    // profit 50 / landed 10 = 5.0
    expect(b.roiPct).toBe(5);
  });
});

describe('computeMargin — VAT as a cost', () => {
  it('deducts VAT as an extra expense', () => {
    const b = computeMargin(inputs({ sellingPrice: 100, vatTreatment: 'addedCost' }));
    // itemPriceExVat = 100 (price treated as ex-VAT), vat cost = 5
    // referral 15, ad 10, fba 15, landed 10, vat 5 => profit 45
    expect(b.itemPriceExVat).toBe(100);
    expect(b.vat).toBe(5);
    expect(b.netProfit).toBe(45);
    expect(b.netMarginPct).toBe(0.45);
  });
});

describe('verdict thresholds', () => {
  it('passes at or above the threshold', () => {
    expect(computeMargin(inputs({ sellingPrice: 105 })).verdict).toBe('pass'); // 50%
  });

  it('warns in the band between 2/3·threshold and threshold', () => {
    // Tune costs so margin lands ~22% (threshold 30%, warn floor 20%).
    // item ex-VAT 100; referral 15 + ad 10 = 25; landed 38 + fba 15 = 53 => profit 22.
    const b = computeMargin(inputs({ sellingPrice: 105, supplierPrice: 30, freightPerUnit: 8, fbaFee: 15 }));
    expect(b.netMarginPct).toBeGreaterThanOrEqual(0.2);
    expect(b.netMarginPct).toBeLessThan(0.3);
    expect(b.verdict).toBe('warn');
  });

  it('fails below 2/3·threshold', () => {
    const b = computeMargin(inputs({ sellingPrice: 105, supplierPrice: 40, freightPerUnit: 10, fbaFee: 20 }));
    expect(b.netMarginPct).toBeLessThan(0.2);
    expect(b.verdict).toBe('fail');
  });

  it('honours a custom threshold', () => {
    const b = computeMargin(inputs({ sellingPrice: 105, marginThresholdPct: 0.6 }));
    expect(b.netMarginPct).toBe(0.5);
    expect(b.verdict).toBe('warn'); // 50% is below 60% but >= 40%
  });
});

describe('breakEven', () => {
  it('returns the inclusive price where profit is zero', () => {
    const i = inputs({ sellingPrice: 105 });
    const be = breakEven(i);
    const atBreakEven = computeMargin({ ...i, sellingPrice: be });
    expect(atBreakEven.netProfit).toBeCloseTo(0, 2);
  });

  it('fixed costs over (1 - variable rate), grossed up for VAT', () => {
    // landed 10 + fba 15 = 25 fixed; rate = .15 + .10 = .25 => ex-VAT 33.33; incl *1.05
    const be = breakEven(inputs());
    expect(be).toBeCloseTo((25 / 0.75) * 1.05, 2);
  });
});

describe('estimateFbaFee', () => {
  it('maps weight to a tier and flags bulky items', () => {
    expect(estimateFbaFee(0.3).tier.label).toContain('500 g');
    expect(estimateFbaFee(0.3).bulky).toBe(false);
    expect(estimateFbaFee(6).bulky).toBe(true);
    expect(estimateFbaFee(50).feeAed).toBe(70);
  });

  it('handles non-positive weight gracefully', () => {
    expect(estimateFbaFee(0).feeAed).toBeGreaterThan(0);
    expect(estimateFbaFee(-5).feeAed).toBeGreaterThan(0);
  });
});
