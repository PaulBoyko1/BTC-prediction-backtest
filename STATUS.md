# BTC Prediction Backtest — Current Status

## Implemented now

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
- 1y / 2y / 3y results are generated separately.
- Kalshi and Polymarket results are generated separately.
- Kalshi-minus-Polymarket equity-difference visualization.
- Ask / last-trade / midpoint variants generated on every full run.
- Fill-sensitivity alert when execution assumption changes results materially.
- Parameter sweep.
- Advanced diagnostics with in-UI explanations.
- Rule-based research/robustness suggestions.
- Dedicated cross-venue discrepancy page/tab.
- Dedicated Settlement Reference Lab (`reference.html`).
- Synthetic demo dataset with multiple observations per contract so early exits/re-entry can be exercised.
- Deterministic runtime smoke tests and GitHub Actions validation.

## Public API adapters implemented

- Kalshi public REST: markets, trades, order book, candles, historical cutoff/candles.
- Polymarket: Gamma metadata, CLOB price history/order book/midpoint, Data API trades.
- Binance: market-data-only REST + public WebSocket endpoint constants; public archive is documented for bulk history.
- Coinbase: public Exchange ticker/candles/trades/book; Advanced Trade WebSocket endpoint constant.
- Kalshi and Polymarket WebSocket endpoint constants.

## Read-only ingestion implemented

`scripts/ingest.mjs` can download/save raw public responses for:

- Kalshi market metadata
- Kalshi trades
- Kalshi candles
- Polymarket price history
- Polymarket trades
- Binance BTCUSDT klines
- Binance BTCUSDT aggregate trades
- Coinbase BTC-USD candles
- API connection checks

Raw downloads are git-ignored by design.

## Intentionally not claimed as complete

- No real multi-year dataset is committed/normalized yet.
- No real strategy edge has been established by the synthetic demo.
- Exact historical CF Benchmarks BRTI tick archive is not yet connected.
- Exact historical Chainlink BTC/USD Data Streams archive is not yet connected.
- Settlement-reference charts in exact mode are withheld until exact source data exists.
- Configurable X-second lead/lag lookbacks need the production timestamp-indexed feature engine; the synthetic demo uses representative derived fields.
- Historical fee schedules and full L2/queue-aware fill reconstruction remain to be added.
- No order-placement code exists.

## Validation rule

A strategy is not considered interesting because its equity curve survives. It should show a persistent, statistically credible edge after realistic execution costs, across time windows and preferably across venues/regimes, then survive walk-forward/out-of-sample testing.
