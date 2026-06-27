/**
 * Landed-cost + margin engine for Amazon.ae (UAE) FBA.
 *
 * This module is pure (no I/O, no framework) so it can be unit-tested and reused
 * by both the UI and, later, Module 1's scoring engine.
 *
 * VAT handling
 * ------------
 * UAE VAT is 5%. Prices shown to customers on Amazon.ae are VAT-INCLUSIVE.
 * For a VAT-registered seller, the VAT you collect is remitted to the FTA — it is
 * a pass-through, NOT your profit and NOT a cost. That is the `'inclusive'`
 * treatment (the correct default).
 *
 * Some sellers prefer to model VAT conservatively as a straight cost (e.g. while
 * not yet registered, or to build in a buffer). That is the `'addedCost'`
 * treatment, where 5% of the item price is deducted as an extra expense.
 *
 * Either way the VAT line is shown explicitly in the breakdown so nothing is hidden.
 */

export type VatTreatment = 'inclusive' | 'addedCost';
export type Verdict = 'pass' | 'warn' | 'fail';

export interface MarginInputs {
  /** Price the customer pays on Amazon.ae, in AED (VAT-inclusive). */
  sellingPrice: number;
  /** Supplier/unit cost in AED (ex-works or FOB). */
  supplierPrice: number;
  /** Inbound freight + import/IOR/customs allocated per unit, in AED. */
  freightPerUnit: number;
  /** Amazon referral fee as a fraction of the item price. Default 0.15 (15%). */
  referralFeePct: number;
  /** Amazon.ae FBA fulfilment fee per unit, in AED. */
  fbaFee: number;
  /** VAT rate as a fraction. Default 0.05 (5%). */
  vatRatePct: number;
  /** Advertising allowance (TACoS) as a fraction of item price. Default 0.10. */
  adAllowancePct: number;
  /** How to treat VAT — see module docs. Default 'inclusive'. */
  vatTreatment: VatTreatment;
  /** Net-margin threshold for a "pass". Default 0.30 (30%). */
  marginThresholdPct: number;
}

export interface MarginBreakdown {
  /** Customer-facing price (AED, VAT-inclusive). */
  sellingPrice: number;
  /** VAT-exclusive item price that Amazon fees and your revenue are based on. */
  itemPriceExVat: number;
  /** VAT amount (AED). Pass-through when 'inclusive', a cost when 'addedCost'. */
  vat: number;
  /** Supplier price + freight per unit (AED). */
  landedCost: number;
  /** Amazon referral fee (AED). */
  referralFee: number;
  /** FBA fulfilment fee (AED). */
  fbaFee: number;
  /** Advertising allowance (AED). */
  adCost: number;
  /** Sum of everything deducted to reach net profit (AED). */
  totalCosts: number;
  /** Net profit per unit (AED). */
  netProfit: number;
  /** Net profit / item price (ex-VAT). */
  netMarginPct: number;
  /** Net profit / landed cost — return on the cash tied up in product. */
  roiPct: number;
  /** Lowest VAT-inclusive selling price at which net profit is zero. */
  breakEvenSellingPrice: number;
  /** Threshold used for the verdict. */
  threshold: number;
  /** pass: margin >= threshold; warn: 2/3·threshold..threshold; fail: below. */
  verdict: Verdict;
}

export const DEFAULT_INPUTS: Omit<MarginInputs, 'sellingPrice' | 'supplierPrice' | 'freightPerUnit' | 'fbaFee'> = {
  referralFeePct: 0.15,
  vatRatePct: 0.05,
  adAllowancePct: 0.1,
  vatTreatment: 'inclusive',
  marginThresholdPct: 0.3,
};

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function verdictFor(marginPct: number, threshold: number): Verdict {
  if (marginPct >= threshold) return 'pass';
  if (marginPct >= threshold * (2 / 3)) return 'warn';
  return 'fail';
}

/**
 * Split a VAT-inclusive selling price into the ex-VAT item price and VAT amount,
 * according to the chosen treatment.
 */
function splitVat(sellingPrice: number, vatRatePct: number, treatment: VatTreatment) {
  if (treatment === 'inclusive') {
    const itemPriceExVat = sellingPrice / (1 + vatRatePct);
    return { itemPriceExVat, vat: sellingPrice - itemPriceExVat, vatIsCost: false };
  }
  // addedCost: the entered price is treated as the ex-VAT item price and VAT is
  // deducted as an extra cost the seller absorbs.
  return { itemPriceExVat: sellingPrice, vat: sellingPrice * vatRatePct, vatIsCost: true };
}

/** Compute the full per-unit margin breakdown for a candidate product. */
export function computeMargin(inputs: MarginInputs): MarginBreakdown {
  const {
    sellingPrice,
    supplierPrice,
    freightPerUnit,
    referralFeePct,
    fbaFee,
    vatRatePct,
    adAllowancePct,
    vatTreatment,
    marginThresholdPct,
  } = inputs;

  const { itemPriceExVat, vat, vatIsCost } = splitVat(sellingPrice, vatRatePct, vatTreatment);

  const landedCost = supplierPrice + freightPerUnit;
  // Amazon levies the referral fee and you budget ads against the ex-VAT item price.
  const referralFee = referralFeePct * itemPriceExVat;
  const adCost = adAllowancePct * itemPriceExVat;

  const vatCost = vatIsCost ? vat : 0;
  const totalCosts = landedCost + referralFee + fbaFee + adCost + vatCost;

  // Revenue you keep is the ex-VAT item price (VAT is remitted, not retained).
  const netProfit = itemPriceExVat - landedCost - referralFee - fbaFee - adCost - vatCost;
  const netMarginPct = itemPriceExVat > 0 ? netProfit / itemPriceExVat : 0;
  const roiPct = landedCost > 0 ? netProfit / landedCost : 0;

  // Break-even: the VAT-inclusive price at which netProfit == 0.
  // netProfit(P) is linear in P; solve for the inclusive price.
  const breakEvenSellingPrice = breakEven(inputs);

  return {
    sellingPrice: round(sellingPrice),
    itemPriceExVat: round(itemPriceExVat),
    vat: round(vat),
    landedCost: round(landedCost),
    referralFee: round(referralFee),
    fbaFee: round(fbaFee),
    adCost: round(adCost),
    totalCosts: round(totalCosts),
    netProfit: round(netProfit),
    netMarginPct: round(netMarginPct, 4),
    roiPct: round(roiPct, 4),
    breakEvenSellingPrice: round(breakEvenSellingPrice),
    threshold: marginThresholdPct,
    verdict: verdictFor(netMarginPct, marginThresholdPct),
  };
}

/**
 * Lowest VAT-inclusive selling price at which net profit is exactly zero,
 * holding all per-unit costs and percentage rates fixed.
 *
 * Let x = ex-VAT item price. Fixed costs F = landedCost + fbaFee.
 * Variable rate r = referralFeePct + adAllowancePct (+ vatRatePct if VAT is a cost).
 * netProfit = x − F − r·x = 0  =>  x = F / (1 − r).
 * Convert back to an inclusive price for the 'inclusive' treatment.
 */
export function breakEven(inputs: MarginInputs): number {
  const fixed = inputs.supplierPrice + inputs.freightPerUnit + inputs.fbaFee;
  const vatIsCost = inputs.vatTreatment === 'addedCost';
  const rate = inputs.referralFeePct + inputs.adAllowancePct + (vatIsCost ? inputs.vatRatePct : 0);
  if (rate >= 1) return Infinity;
  const itemPriceExVat = fixed / (1 - rate);
  return inputs.vatTreatment === 'inclusive' ? itemPriceExVat * (1 + inputs.vatRatePct) : itemPriceExVat;
}
