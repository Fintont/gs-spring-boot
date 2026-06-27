import { describe, it, expect } from 'vitest';
import {
  defaultChecklist, createLaunchProduct, setItem, computeProgress, isLaunchReady, statusOf, isApplicable, LaunchProduct,
} from './launch';

const NOW = '2026-06-27T00:00:00.000Z';
const product = (over: Partial<LaunchProduct> = {}): LaunchProduct => ({
  ...createLaunchProduct({ name: 'Silicone bottle' }, 'p1', NOW),
  ...over,
});

describe('defaultChecklist', () => {
  it('includes the UAE compliance steps', () => {
    const ids = defaultChecklist().map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['ior', 'vat_registration', 'customs_hs', 'gtin', 'esma', 'listing_live', 'inventory_shipped']));
    expect(defaultChecklist().find((d) => d.id === 'esma')?.esmaOnly).toBe(true);
  });
});

describe('ESMA applicability', () => {
  const esma = defaultChecklist().find((d) => d.id === 'esma')!;
  it('is N/A and not required when the product is not ESMA-regulated', () => {
    const p = product({ esmaRegulated: false });
    expect(isApplicable(esma, p)).toBe(false);
    expect(statusOf(esma, p)).toBe('na');
    expect(computeProgress(p).applicable).toBe(6); // 7 items minus ESMA
  });

  it('is required when the product is ESMA-regulated', () => {
    const p = product({ esmaRegulated: true });
    expect(isApplicable(esma, p)).toBe(true);
    expect(computeProgress(p).applicable).toBe(7);
  });
});

describe('progress & readiness', () => {
  it('starts at 0% with everything to do', () => {
    const p = product();
    const prog = computeProgress(p);
    expect(prog.done).toBe(0);
    expect(prog.pct).toBe(0);
    expect(isLaunchReady(p)).toBe(false);
  });

  it('advances as items are marked done', () => {
    let p = product(); // 6 applicable (no ESMA)
    p = setItem(p, 'ior', 'done', NOW);
    p = setItem(p, 'vat_registration', 'done', NOW);
    p = setItem(p, 'customs_hs', 'done', NOW);
    const prog = computeProgress(p);
    expect(prog.done).toBe(3);
    expect(prog.pct).toBe(50);
    expect(prog.remaining.map((d) => d.id)).toEqual(['gtin', 'listing_live', 'inventory_shipped']);
  });

  it('is launch-ready only when every required applicable item is done', () => {
    let p = product({ esmaRegulated: true });
    for (const d of defaultChecklist()) p = setItem(p, d.id, 'done', NOW);
    expect(isLaunchReady(p)).toBe(true);
    expect(computeProgress(p).pct).toBe(100);
  });

  it('an ESMA-regulated product is not ready until ESMA is done', () => {
    let p = product({ esmaRegulated: true });
    for (const d of defaultChecklist()) if (d.id !== 'esma') p = setItem(p, d.id, 'done', NOW);
    expect(isLaunchReady(p)).toBe(false);
    expect(computeProgress(p).remaining.map((d) => d.id)).toEqual(['esma']);
  });
});

describe('setItem', () => {
  it('updates status immutably and stamps updatedAt', () => {
    const p = product();
    const next = setItem(p, 'gtin', 'in_progress', NOW, 'EAN ordered');
    expect(p.items.gtin).toBeUndefined(); // original untouched
    expect(next.items.gtin).toEqual({ status: 'in_progress', note: 'EAN ordered', updatedAt: NOW });
  });

  it('preserves an existing note when none is supplied', () => {
    let p = setItem(product(), 'gtin', 'in_progress', NOW, 'EAN ordered');
    p = setItem(p, 'gtin', 'done', NOW);
    expect(p.items.gtin.note).toBe('EAN ordered');
  });
});
