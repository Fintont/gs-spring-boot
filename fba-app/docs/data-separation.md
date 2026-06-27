# Data separation: market signal vs. own sales

A core design rule for this app: **the two data planes must never contaminate each
other.** This protects Module 1's product decisions from bias.

## The two planes

| | **Plane A — Market signal** | **Plane B — Own-sales signal** |
|---|---|---|
| Tag | `source: 'market'` | `source: 'own-sales'` |
| Origin | Keepa / Rainforest, search-trend tools, competitor reviews | Amazon **SP-API** (our seller account) |
| Examples | demand level & trend, competition depth, review counts/velocity, ratings, complaint rate, price spread | our units, revenue, ACoS, inventory, profit/unit |
| Used by | **Module 1** — discovery & scoring of *new* products | **Module 2** — tracking products we already run |

## Why they must stay separate

Our own sales data only describes products we **already chose and stocked**. If that
data feeds back into discovering or scoring *new* products, we get:

- **Survivorship bias** — we only "see" demand for the narrow set we happen to sell.
- **Confirmation bias** — products similar to current winners get scored up regardless
  of true market demand; genuinely new opportunities get starved.

So market demand and shopper behaviour are measured **independently** of our sales. The
question Module 1 answers — *"is there real, stable demand for this, separate from how
my current catalogue performs?"* — can only be answered from Plane A.

## How it's enforced in code

- Every signal carries a `source` discriminant (`'market' | 'own-sales'`).
- The scoring path calls `assertMarketSignal()` / `collectMarketSignals()`
  (`src/domain/signals.ts`), which **throw** if anything that isn't `'market'` reaches
  them. Own-sales data is structurally barred from Module 1.
- `MarketSignalProvider` is the only interface the scorer pulls from. SP-API lives behind
  a separate provider used solely by Module 2.
- `MockMarketSignalProvider` lets Module 1 be built and tested offline, and has **no code
  path** that could emit own-sales figures.

## Demand stability (steady vs. one spike)

`classifyDemandStability()` turns a demand time series into
`steady | rising | declining | volatile | spike | insufficient` — operationalising the
brief's "UAE demand stability" criterion. A one-off **spike** (e.g. a seasonal blip) is
explicitly distinguished from **steady** demand and scored down by default
(`DEMAND_STABILITY_SCORE`, tunable when phase-2 weights are set).

## Where phase 2 plugs in

Real providers (Keepa/Rainforest for market, SP-API for own-sales) implement these
interfaces. The firewall and the stability classifier already exist and are unit-tested,
so the scorer can be assembled on top without re-litigating the bias boundary.
