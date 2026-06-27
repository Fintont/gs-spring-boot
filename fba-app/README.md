# UAE FBA Product Finder + Operations Tracker

A two-module web app for evaluating and operating Amazon.ae (UAE) FBA products.

- **Module 1 — Product Identifier & Scorer:** input a product/keyword → fetch market
  data via a pluggable provider → score against a go/no-go framework → verdict.
- **Module 2 — FBA Operations & Tracker:** launch checklist (UAE compliance-aware),
  live performance dashboard (Amazon SP-API), reorder alerts, profit tracking.

## Build status

This repo is being built in the agreed sequence. **Step 1 is complete:**

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Landed-cost + margin calculator (offline, no API) | ✅ Done |
| 2 | Module 1 scorer + one data provider (Keepa/Rainforest) | ⏳ Next |
| 3 | Module 2 launch checklist tracker (manual entry) | ◻️ Planned |
| 4 | Module 2 SP-API live dashboard | ◻️ Planned |

## Step 1 — Landed-cost + Margin calculator

A pure, offline calculator for Amazon.ae unit economics. Enter supplier price,
freight, weight and selling price; it computes net margin after the referral fee,
FBA fee, VAT and an ad allowance, and returns a go/no-go style verdict.

### Run it

```bash
cd fba-app
npm install
npm run dev      # http://localhost:5173
npm test         # run the domain unit tests
npm run build    # typecheck + production build
```

### What it computes (per unit)

- **Landed cost** = supplier price + freight/import per unit
- **Referral fee** = referral % × ex-VAT item price (default 15%)
- **FBA fee** = manual, or auto-estimated from unit weight (see disclaimer below)
- **Ad allowance** = TACoS % × ex-VAT item price (default 10%)
- **Net profit / margin / ROI**, plus the **break-even selling price**
- **Verdict:** ✅ pass ≥ threshold (default 30%) · ⚠️ warn within 2⁄3·threshold · ❌ fail below
- **Criteria flags:** margin, price-band fit (AED 30–60), weight/size class (bulky → high fee)

### VAT treatment (important)

UAE VAT is 5% and Amazon.ae prices are VAT-inclusive. Two modes:

- **Pass-through (default, VAT-registered):** VAT is split out of the inclusive
  price and remitted to the FTA — it is *not* counted as profit or cost. This is
  the correct model for a registered seller.
- **Absorb as cost (conservative):** 5% is deducted as a straight expense, for
  modelling a not-yet-registered seller or building in a buffer.

The VAT line is always shown explicitly in the breakdown.

### ⚠️ FBA fee estimates are indicative

The weight-based FBA fee estimator (`src/domain/fees.ts`) is a **sanity-check
starting point only**. Amazon updates the UAE fee schedule periodically and fees
depend on exact dimensions and category. Always confirm against the current
official Amazon.ae fee schedule and override the fee with a real figure.

## Project layout

```
fba-app/
  src/
    domain/        pure, framework-free business logic (unit-tested)
      margin.ts    landed-cost + margin engine
      fees.ts      Amazon.ae FBA fee estimator
      *.test.ts    Vitest unit tests
    components/     React UI
    App.tsx
    main.tsx
```

The `domain/` layer is deliberately framework-free so Module 1's scoring engine
and Module 2's profit tracker can reuse the same calculations.

## Tech

React 18 + TypeScript + Vite, Vitest for tests. A Node/Express API-abstraction
layer for data providers (Keepa/Rainforest) and SP-API arrives in steps 2 and 4.

## Secrets

API keys will live in environment variables (`.env`, git-ignored) — never
hardcoded. No secrets are required for Step 1.
