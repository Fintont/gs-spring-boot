/**
 * Module 2 — UAE FBA launch checklist (phase 3, manual entry).
 *
 * A compliance-aware launch tracker: each product carries a checklist of the steps needed
 * to go live on Amazon.ae, including the UAE-specific regulatory ones (IOR, VAT/TRN,
 * customs/HS code, GTIN, ESMA conformity). ESMA only applies to regulated product types,
 * so it is auto-marked N/A unless the product is flagged as ESMA-regulated.
 *
 * Pure module: no I/O, no framework. The UI supplies ids/timestamps and persists state.
 */

export type ItemStatus = 'todo' | 'in_progress' | 'done' | 'na';

export interface ChecklistItemDef {
  id: string;
  label: string;
  description: string;
  /** Counts toward launch-readiness when applicable. */
  required: boolean;
  /** Regulatory/compliance step — highlighted in the UI. */
  compliance?: boolean;
  /** Applies only when the product is ESMA-regulated. */
  esmaOnly?: boolean;
}

export interface ItemState {
  status: ItemStatus;
  note?: string;
  updatedAt?: string;
}

export interface LaunchProduct {
  id: string;
  name: string;
  asin?: string;
  category?: string;
  /** True if the product type is regulated by ESMA (electronics, toys, etc.). */
  esmaRegulated: boolean;
  createdAt: string;
  items: Record<string, ItemState>;
}

/** The UAE Amazon.ae launch checklist. Compliance items first, then go-live steps. */
export function defaultChecklist(): ChecklistItemDef[] {
  return [
    { id: 'ior', label: 'IOR arranged', description: 'Importer of Record in place to clear goods into the UAE.', required: true, compliance: true },
    { id: 'vat_registration', label: 'VAT registration (FTA TRN)', description: 'Registered for 5% UAE VAT with a Tax Registration Number.', required: true, compliance: true },
    { id: 'customs_hs', label: 'HS code & customs clearance', description: 'Correct HS classification and customs/duty handled.', required: true, compliance: true },
    { id: 'gtin', label: 'Barcodes / GTIN', description: 'Valid UPC/EAN (GTIN) per unit, or a GTIN exemption.', required: true },
    { id: 'esma', label: 'ESMA conformity (ECAS/EQM)', description: 'Emirates conformity certificate for regulated goods. Flag and obtain before import.', required: true, compliance: true, esmaOnly: true },
    { id: 'listing_live', label: 'Listing live on Amazon.ae', description: 'ASIN created and detail page published.', required: true },
    { id: 'inventory_shipped', label: 'Inventory shipped to FBA', description: 'Units received into an Amazon.ae fulfilment centre.', required: true },
  ];
}

/** Whether a checklist item applies to this product (ESMA-only items need the flag). */
export function isApplicable(def: ChecklistItemDef, product: LaunchProduct): boolean {
  if (def.esmaOnly) return product.esmaRegulated;
  return true;
}

/** Effective status of an item: stored value, or a sensible default (N/A for inapplicable). */
export function statusOf(def: ChecklistItemDef, product: LaunchProduct): ItemStatus {
  if (!isApplicable(def, product)) return 'na';
  return product.items[def.id]?.status ?? 'todo';
}

export interface Progress {
  done: number;
  applicable: number;
  pct: number;
  /** Required, applicable items not yet done — the blockers to launch. */
  remaining: ChecklistItemDef[];
}

/** Progress over required, applicable items. */
export function computeProgress(product: LaunchProduct, defs = defaultChecklist()): Progress {
  const required = defs.filter((d) => d.required && isApplicable(d, product));
  const done = required.filter((d) => statusOf(d, product) === 'done');
  const remaining = required.filter((d) => statusOf(d, product) !== 'done');
  const applicable = required.length;
  return {
    done: done.length,
    applicable,
    pct: applicable ? Math.round((done.length / applicable) * 100) : 0,
    remaining,
  };
}

/** True when every required, applicable item is done. */
export function isLaunchReady(product: LaunchProduct, defs = defaultChecklist()): boolean {
  return computeProgress(product, defs).remaining.length === 0;
}

export interface NewProductInput {
  name: string;
  asin?: string;
  category?: string;
  esmaRegulated?: boolean;
}

/** Create a launch product. `id`/`now` are injected so this stays pure and testable. */
export function createLaunchProduct(input: NewProductInput, id: string, now: string): LaunchProduct {
  return {
    id,
    name: input.name.trim(),
    asin: input.asin?.trim() || undefined,
    category: input.category?.trim() || undefined,
    esmaRegulated: !!input.esmaRegulated,
    createdAt: now,
    items: {},
  };
}

/** Return a copy of the product with one item's status/note updated. */
export function setItem(product: LaunchProduct, itemId: string, status: ItemStatus, now: string, note?: string): LaunchProduct {
  const prev = product.items[itemId];
  return {
    ...product,
    items: { ...product.items, [itemId]: { status, note: note ?? prev?.note, updatedAt: now } },
  };
}
