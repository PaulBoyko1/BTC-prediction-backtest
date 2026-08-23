# BTC Prediction Backtest

A research UI and deterministic backtesting foundation for testing whether BTC prediction markets and BTC market structure contain exploitable short-horizon statistical edges.

## Current foundation

- Two strategy branches:
  - **Prediction Markets** — contract price, probability shocks, order-book imbalance, Kalshi/Polymarket spread, time-to-expiry, strike/round-level geometry.
  - **BTC Technicals** — VWAP, EMA relationship/cross, yesterday high/low/close, prior-week statistics, momentum, realized volatility, round levels.
- Add-factor strategy composer with AND / OR logic.
- 1 / 2 / 3 year test-window selector.
- Portfolio simulation:
  - starting capital
  - fixed-percent sizing
  - fractional Kelly sizing based only on *prior* completed trades
  - Bayesian pseudo-count smoothing for Kelly estimates
  - max trade size / exposure caps
  - fee and slippage allowances
  - cooldown
  - one entry per contract
  - hold to settlement
- Metrics: win rate, breakeven rate, empirical edge, ending equity, total return, CAGR, max drawdown, trade-return diagnostic and trade ledger.
- Equity curve.
- Digital-option `N(d2)` probability reference for binary-contract diagnostics.
- Prediction-market comparison page for Kalshi ↔ Polymarket discrepancies.
- Data-source/API adapter page.
- Deterministic synthetic demo dataset, deliberately isolated from future real API adapters.

## Run locally

No framework or package install is required.

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Architecture

- `index.html` — shell
- `styles.css` — responsive UI
- `src/app.js` — state + views + interactions
- `src/catalog.js` — editable factor catalog and defaults
- `src/backtest.js` — signal evaluation, execution simulation, sizing, metrics, binary probability reference
- `src/mockData.js` — deterministic demo data only
- `QUESTIONS.txt` — unresolved requirements/data decisions to answer before historical/live ingestion

## Data adapter plan

The strategy engine should consume normalized data rather than venue-specific responses directly. Planned normalized entities:

1. `PredictionMarketSnapshot`
   - timestamp
   - venue
   - market / contract id
   - side
   - bid / ask / midpoint
   - depth / imbalance
   - volume / trade flow
   - expiry
   - strike / comparison price
   - resolution source / rule version
2. `BTCMarketSnapshot`
   - timestamp
   - venue
   - spot / perp price
   - bid / ask
   - trades / volume
   - order book
3. `BTCBar`
   - timeframe
   - OHLCV
   - derived VWAP / EMA / prior-period features
4. `ResolvedContract`
   - final outcome
   - resolution timestamp
   - resolution source / rule

Keep raw ingestion/cache files immutable and versioned by data source and collection date when practical.

## Backtesting principles

- Never size a historical trade using a win rate measured from future trades.
- Use a realistically executable entry price rather than a displayed midpoint unless the strategy explicitly models maker fills.
- Record rule-version and settlement-source changes; do not mix incompatible market regimes silently.
- Separate hypothesis discovery from forward/out-of-sample validation.
- Report sample size and calibration by price/probability bucket before trusting large Kelly fractions.
- Large historical tick/order-book datasets should generally be imported/cached locally (CSV/Parquet) rather than repeatedly fetched from APIs.

## Status

This repository currently contains the **UI/backtest foundation**, not a validated trading strategy. The included demo results are synthetic and must never be interpreted as evidence of a real edge.
