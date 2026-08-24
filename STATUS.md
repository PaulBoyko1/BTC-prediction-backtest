# BTC Prediction Backtest — Current Status

## Implemented now

### Browser research workbench

- Two starting branches: Prediction Markets / BTC.
- Mixed BTC + prediction-market + settlement-reference factor composition.
- Prediction factors: contract price, probability shock, probability velocity, order-book imbalance, time-to-expiry, strike geometry, venue spread, prediction residual vs BTC.
- BTC factors: named VWAP setups, EMA, prior-day/week levels, momentum, volatility, round levels, small/large BTC move gate.
- Reference factors: reference-vs-strike and reference-vs-spot.
- Trade target separated from signals: venue, side, horizon.
- Re-entry controls: once, limited, repeated + cooldown.
- Exit controls: settlement, price target, target+stop, time-before-expiry.
- Portfolio controls: starting capital, fixed sizing, fractional Kelly for expiry trades, max position, max open exposure, slippage/fee allowances.
- Capital is reserved while positions remain open.
- 1y / 2y / 3y result layout, separate Kalshi/Polymarket paths and venue-difference visualization.
- Ask / last-trade / midpoint variants generated on every full run.
- Fill-sensitivity alert when execution assumption changes results materially.
- Parameter sweep, advanced diagnostics and rule-based robustness suggestions.
- Dedicated cross-venue discrepancy page and Settlement Reference Lab.

### Python high-frequency backend

- Python + Polars + DuckDB + Parquet stack defined in `pyproject.toml`.
- `backend/lead_lag.py` implements the primary Test-B pattern:
  - prediction-market shock over configurable lookback;
  - require BTC to have moved no more than a configurable amount over the same backward-looking window;
  - label BTC moves at 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s, 1m, 3m, 5m and expiry.
- Historical features use backward as-of joins; forward BTC observations are labels only.
- Automated test mutates all BTC prices after a qualifying signal and verifies that signal selection cannot change.
- CLI writes event-level and summary Parquet output.

## Public/read-only acquisition implemented

- Kalshi public REST: markets, trades, order book, candles, historical cutoff/candles.
- Polymarket: Gamma metadata, CLOB price history/order book/midpoint, Data API trades.
- Binance market-data-only REST/public stream endpoints.
- Coinbase public BTC-USD ticker/candles/trades/book.
- `scripts/ingest.mjs` saves raw public responses locally.

## Exact settlement-reference acquisition paths

### Kalshi / BRTI

- CME confirms BRTI historical data exists back to November 2016 through its market-data channels.
- Exact raw BRTI history is licensed/entitled data rather than a zero-auth public archive.
- `backend/reference_sources.py` implements CME DataMine OAuth, entitled-file listing and entitled-file download hooks.
- Kalshi resolved-market metadata can still provide exact target/final/outcome information for outcome-only studies before raw BRTI is licensed.
- BRTI publication frequency changed from 1 second to 200ms on May 18, 2026; source-frequency regime must be retained.

### Polymarket / Chainlink Data Streams

- `scripts/chainlink-reference.mjs` uses the official `@chainlink/data-streams-sdk` for credentialed feed/report retrieval and decoding.
- Exact Polymarket resolution source must be preserved per contract; 5-minute contracts have used both 30s and 60s BTC/USD TWAP streams during August 2026.
- Important limitation: Chainlink's official historical-page SDK example documents a last-30-days timestamp requirement. A credential alone therefore does **not** establish 1–3 years of historical TWAP reports from the standard API.
- Older exact Chainlink reference paths require an authorized archive/provider or remain unavailable. Exchange spot may only be labeled `spot_proxy`.

See `REFERENCE_DATA_RESEARCH.md` and `.env.example`.

## Real-history coverage rule

The UI can request 1y / 2y / 3y comparisons, but real short-duration prediction-market series may not cover those complete periods. Production results must:

- report exact first/last source timestamps and sample counts;
- show `N/A / insufficient history` when a requested window is not covered;
- never pad missing prediction-market periods with synthetic rows;
- never call a shorter prediction-market series a 1y/2y/3y backtest merely because BTC history exists for that long.

## Approved next data order

1. Kalshi BTC15m metadata/trades/resolutions.
2. Binance + Coinbase raw BTC data aligned at native timestamps.
3. Add BTC perp inputs: funding, basis, OI, liquidations and perp-book imbalance.
4. Run the high-frequency lead/lag grid with conservative executable/taker assumptions.
5. Add equivalent Polymarket contracts while preserving each exact rule/reference source.
6. Only build expensive L2/queue-aware maker reconstruction for strategies that survive initial edge tests.

## Intentionally not claimed as complete

- No real normalized multi-month/multi-year BTC prediction-market dataset is committed yet.
- No real strategy edge has been established by the synthetic demo.
- BRTI DataMine entitlement has not been purchased/provided in this repository.
- Chainlink credentials and a long-history Chainlink archive have not been provided.
- Historical fee schedules and full L2/queue-aware fill reconstruction remain to be added.
- No order-placement code exists.

## Validation standard

A strategy is not considered interesting because its equity curve survives. Require a persistent, statistically credible edge after realistic execution costs, sample-size disclosure, multi-window/regime checks and walk-forward/out-of-sample validation.
