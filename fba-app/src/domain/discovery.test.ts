import { describe, it, expect } from 'vitest';
import {
  parseCandidatesCsv,
  splitCsvLine,
  evaluateCandidate,
  rankCandidates,
  DEFAULT_IMPORT_SETTINGS,
  CandidateInput,
} from './discovery';

describe('splitCsvLine', () => {
  it('splits plain fields', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('honours quoted fields with commas', () => {
    expect(splitCsvLine('"Foldable, bottle",2.5,0.2')).toEqual(['Foldable, bottle', '2.5', '0.2']);
  });
  it('handles escaped quotes', () => {
    expect(splitCsvLine('"12""screen",9')).toEqual(['12"screen', '9']);
  });

  it('treats a mid-field quote (inch mark) as a literal, not a quote opener', () => {
    expect(splitCsvLine('5" phone stand,12.50,0.3')).toEqual(['5" phone stand', '12.50', '0.3']);
  });
});

describe('parseCandidatesCsv', () => {
  it('parses header synonyms and rows', () => {
    const csv = [
      'Product,Wholesale,Weight,Category,MOQ',
      'Silicone bottle,2.5,0.18,Kitchen,500',
      '"Travel pouch, large",3.2,0.25,Travel,300',
    ].join('\n');
    const { candidates, errors } = parseCandidatesCsv(csv);
    expect(errors).toHaveLength(0);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ name: 'Silicone bottle', unitCost: 2.5, weightKg: 0.18, category: 'Kitchen', moq: 500 });
    expect(candidates[1].name).toBe('Travel pouch, large');
  });

  it('reports missing required columns', () => {
    const { errors } = parseCandidatesCsv('name,category\nFoo,Bar');
    expect(errors.some((e) => /cost/.test(e.message))).toBe(true);
    expect(errors.some((e) => /weight/.test(e.message))).toBe(true);
  });

  it('skips and reports invalid rows but keeps good ones', () => {
    const csv = 'name,cost,weight\nGood,2,0.3\nBadWeight,2,abc\nBadCost,xyz,0.3';
    const { candidates, errors } = parseCandidatesCsv(csv);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('Good');
    expect(errors).toHaveLength(2);
  });

  it('returns an error for empty input', () => {
    expect(parseCandidatesCsv('   ').errors[0].message).toMatch(/empty/i);
  });
});

describe('evaluateCandidate', () => {
  const base: CandidateInput = { name: 'X', unitCost: 3, weightKg: 0.3 };

  it('converts cost to AED via fx and computes a verdict', () => {
    const r = evaluateCandidate(base, DEFAULT_IMPORT_SETTINGS);
    expect(r.supplierPriceAed).toBeCloseTo(3 * 3.6725, 2);
    expect(['pass', 'warn', 'fail']).toContain(r.breakdown.verdict);
  });

  it('flags and excludes bulky items from the shortlist', () => {
    const r = evaluateCandidate({ ...base, weightKg: 8 }, DEFAULT_IMPORT_SETTINGS);
    expect(r.bulky).toBe(true);
    expect(r.shortlisted).toBe(false);
    expect(r.flags.some((f) => /bulky/i.test(f))).toBe(true);
  });

  it('flags an out-of-band price but still shortlists on economics', () => {
    const r = evaluateCandidate({ ...base, sellingPrice: 120 }, DEFAULT_IMPORT_SETTINGS);
    expect(r.priceInBand).toBe(false);
    expect(r.flags.some((f) => /band/i.test(f))).toBe(true);
    expect(r.shortlisted).toBe(true); // healthy margin, light, profitable
  });

  it('excludes a thin-margin candidate', () => {
    const r = evaluateCandidate({ name: 'Pricey', unitCost: 10, weightKg: 0.3, sellingPrice: 45 }, DEFAULT_IMPORT_SETTINGS);
    expect(r.breakdown.verdict).toBe('fail');
    expect(r.shortlisted).toBe(false);
  });
});

describe('rankCandidates', () => {
  it('puts shortlisted first, then by margin descending', () => {
    const settings = DEFAULT_IMPORT_SETTINGS;
    const results = [
      evaluateCandidate({ name: 'Bulky', unitCost: 3, weightKg: 8 }, settings),
      evaluateCandidate({ name: 'Thin', unitCost: 11, weightKg: 0.3, sellingPrice: 45 }, settings),
      evaluateCandidate({ name: 'Great', unitCost: 2, weightKg: 0.2 }, settings),
      evaluateCandidate({ name: 'Good', unitCost: 4, weightKg: 0.3 }, settings),
    ];
    const ranked = rankCandidates(results);
    expect(ranked[0].candidate.name).toBe('Great');
    expect(ranked[1].candidate.name).toBe('Good');
    // non-shortlisted candidates sink to the bottom
    expect(ranked[ranked.length - 1].shortlisted).toBe(false);
  });
});
