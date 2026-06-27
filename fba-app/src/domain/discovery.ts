/**
 * Expo / sourcing idea-feeder (Module 1, phase 1).
 *
 * Turns a list of candidate products — e.g. exported from a Chinese expo's online
 * catalogue (Canton Fair, Yiwu, Global Sources, HKTDC) or a supplier sheet — into a
 * ranked shortlist by running each one through the offline margin engine.
 *
 * It is deliberately source-agnostic: any list that can be expressed as the CSV
 * schema below flows through the same pipeline. Later (phase 2) each candidate can
 * be enriched with live Amazon.ae market data before scoring.
 *
 * Pure module: no I/O, no framework — unit-testable and reusable.
 */

import { computeMargin, MarginBreakdown, VatTreatment } from './margin';
import { estimateFbaFee } from './fees';
import { round } from './math';

export interface CandidateInput {
  name: string;
  category?: string;
  supplier?: string;
  /** Supplier unit cost, expressed in the import currency (converted via fxToAed). */
  unitCost: number;
  /** Unit weight in kg — drives the FBA fee estimate and the bulky flag. */
  weightKg: number;
  /** Target Amazon.ae price (AED, VAT-incl). Falls back to the import default. */
  sellingPrice?: number;
  /** Minimum order quantity, informational. */
  moq?: number;
  /** Per-unit inbound freight/import in AED. Falls back to the import default. */
  freight?: number;
}

export interface ImportSettings {
  /** Currency label of the unitCost column, e.g. 'USD'. */
  currency: string;
  /** Multiplier from import currency to AED (USD→AED ≈ 3.6725, pegged). */
  fxToAed: number;
  /** Per-unit freight (AED) used when a row omits it. */
  defaultFreightPerUnit: number;
  /** Target Amazon.ae selling price (AED, VAT-incl) used when a row omits it. */
  defaultSellingPrice: number;
  referralFeePct: number;
  vatRatePct: number;
  adAllowancePct: number;
  vatTreatment: VatTreatment;
  marginThresholdPct: number;
  /** Lower/upper bounds of the target price band (AED). Default 30–60. */
  priceBandMin: number;
  priceBandMax: number;
}

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  currency: 'USD',
  fxToAed: 3.6725,
  defaultFreightPerUnit: 3,
  defaultSellingPrice: 49,
  referralFeePct: 0.15,
  vatRatePct: 0.05,
  adAllowancePct: 0.1,
  vatTreatment: 'inclusive',
  marginThresholdPct: 0.3,
  priceBandMin: 30,
  priceBandMax: 60,
};

export interface CandidateResult {
  candidate: CandidateInput;
  supplierPriceAed: number;
  sellingPrice: number;
  breakdown: MarginBreakdown;
  bulky: boolean;
  fbaFeeAed: number;
  fbaTierLabel: string;
  priceInBand: boolean;
  shortlisted: boolean;
  /** Human-readable reasons a candidate did NOT make the shortlist. */
  flags: string[];
}

/** Evaluate one candidate against the margin engine and the go/no-go criteria. */
export function evaluateCandidate(c: CandidateInput, s: ImportSettings): CandidateResult {
  const supplierPriceAed = c.unitCost * s.fxToAed;
  const sellingPrice = c.sellingPrice ?? s.defaultSellingPrice;
  const freight = c.freight ?? s.defaultFreightPerUnit;
  const fba = estimateFbaFee(c.weightKg);

  const breakdown = computeMargin({
    sellingPrice,
    supplierPrice: supplierPriceAed,
    freightPerUnit: freight,
    fbaFee: fba.feeAed,
    referralFeePct: s.referralFeePct,
    vatRatePct: s.vatRatePct,
    adAllowancePct: s.adAllowancePct,
    vatTreatment: s.vatTreatment,
    marginThresholdPct: s.marginThresholdPct,
  });

  const priceInBand = sellingPrice >= s.priceBandMin && sellingPrice <= s.priceBandMax;

  const flags: string[] = [];
  if (breakdown.verdict === 'fail') flags.push(`Margin ${(breakdown.netMarginPct * 100).toFixed(0)}% — below floor`);
  if (fba.bulky) flags.push(`Heavy/bulky (${fba.tier.label}) — high FBA fee`);
  if (!priceInBand) flags.push(`Price ${sellingPrice.toFixed(0)} AED outside ${s.priceBandMin}–${s.priceBandMax} band`);
  if (breakdown.netProfit <= 0) flags.push('Not profitable per unit');

  // Shortlist = clears the margin floor (pass or warn), not bulky, and profitable.
  // Price-band is a flag, not an exclusion, because the sell price is an assumption.
  const shortlisted = breakdown.verdict !== 'fail' && !fba.bulky && breakdown.netProfit > 0;

  return {
    candidate: c,
    supplierPriceAed: round(supplierPriceAed),
    sellingPrice: round(sellingPrice),
    breakdown,
    bulky: fba.bulky,
    fbaFeeAed: fba.feeAed,
    fbaTierLabel: fba.tier.label,
    priceInBand,
    shortlisted,
    flags,
  };
}

const verdictRank: Record<MarginBreakdown['verdict'], number> = { pass: 0, warn: 1, fail: 2 };

/**
 * Rank candidates: shortlisted first, then by verdict (pass > warn > fail), then by
 * net margin descending. Stable for equal keys.
 */
export function rankCandidates(results: CandidateResult[]): CandidateResult[] {
  return [...results].sort((a, b) => {
    if (a.shortlisted !== b.shortlisted) return a.shortlisted ? -1 : 1;
    const v = verdictRank[a.breakdown.verdict] - verdictRank[b.breakdown.verdict];
    if (v !== 0) return v;
    return b.breakdown.netMarginPct - a.breakdown.netMarginPct;
  });
}

export interface ParseResult {
  candidates: CandidateInput[];
  /** Row-level problems: 1-based data row index (header = row 0) + message. */
  errors: { row: number; message: string }[];
}

// Accepted header synonyms → canonical field. Compared case/space/underscore-insensitive.
const HEADER_MAP: Record<string, keyof CandidateInput> = {
  name: 'name', product: 'name', productname: 'name', item: 'name',
  category: 'category', cat: 'category',
  supplier: 'supplier', vendor: 'supplier', factory: 'supplier',
  unitcost: 'unitCost', cost: 'unitCost', price: 'unitCost', wholesale: 'unitCost', wholesaleprice: 'unitCost', supplierprice: 'unitCost',
  weight: 'weightKg', weightkg: 'weightKg', kg: 'weightKg',
  sellingprice: 'sellingPrice', sellprice: 'sellingPrice', targetprice: 'sellingPrice', retail: 'sellingPrice',
  moq: 'moq', minorder: 'moq',
  freight: 'freight', shipping: 'freight', freightperunit: 'freight',
};

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_]+/g, '');

/** Split one CSV line, honouring double-quoted fields and escaped quotes (""). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      // A double-quote only opens a quoted field at the very start of the field;
      // elsewhere (e.g. an inch mark in `5" stand`) it is a literal character.
      inQuotes = true;
    } else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * Parse a CSV candidate list. The first non-empty line is the header.
 * Required columns: name, unitCost (cost/price/wholesale), weight.
 */
export function parseCandidatesCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const candidates: CandidateInput[] = [];
  const errors: ParseResult['errors'] = [];
  if (lines.length === 0) return { candidates, errors: [{ row: 0, message: 'Empty input' }] };

  const headers = splitCsvLine(lines[0]).map(normHeader);
  const cols = headers.map((h) => HEADER_MAP[h]);
  const has = (f: keyof CandidateInput) => cols.includes(f);
  if (!has('name')) errors.push({ row: 0, message: 'Missing required "name" column' });
  if (!has('unitCost')) errors.push({ row: 0, message: 'Missing required cost column (cost/price/wholesale)' });
  if (!has('weightKg')) errors.push({ row: 0, message: 'Missing required "weight" column' });
  if (errors.length) return { candidates, errors };

  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]);
    const get = (f: keyof CandidateInput) => {
      const idx = cols.indexOf(f);
      return idx >= 0 ? cells[idx] ?? '' : '';
    };
    const name = get('name');
    if (!name) { errors.push({ row: r, message: 'Missing name' }); continue; }

    const unitCost = parseFloat(get('unitCost'));
    const weightKg = parseFloat(get('weightKg'));
    if (!Number.isFinite(unitCost) || unitCost < 0) { errors.push({ row: r, message: `"${name}": invalid cost` }); continue; }
    if (!Number.isFinite(weightKg) || weightKg <= 0) { errors.push({ row: r, message: `"${name}": invalid weight` }); continue; }

    const optNum = (f: keyof CandidateInput) => {
      const v = parseFloat(get(f));
      return Number.isFinite(v) ? v : undefined;
    };

    candidates.push({
      name,
      category: get('category') || undefined,
      supplier: get('supplier') || undefined,
      unitCost,
      weightKg,
      sellingPrice: optNum('sellingPrice'),
      moq: optNum('moq'),
      freight: optNum('freight'),
    });
  }
  return { candidates, errors };
}
