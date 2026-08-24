# BTC Prediction Backtest — Current Status

## Implemented now

### Browser research workbench

- Two starting branches: Prediction Markets / BTC.
- Mixed BTC + prediction-market + settlement-reference factor composition.
- Prediction factors: contract price, probability shock, probability velocity, order-book imbalance, time-to-expiry, strike geometry, venue spread, prediction residual vs BTC.
- BTC factors: named VWAP setups, EMA, prior-day/week levels, momentum, volatility, round levels, small/large BTC move gate.
- Reference factors: reference-vs-strike and reference-vs-spot.
- Trade target separated from signals: venue, side, horizon.
- Re-entry controls: once, limited, repeated + per-contract cooldown.
- Exit controls: settlement, price target, target+stop, time-before-expiry.
- Defined-price cycles such as buy <=45c / sell >=55c are regression-tested.
- Repeated low->high volatility-harvesting cycles inside one contract are regression-tested.
- Early-exit profit is correctly independent of final settlement direction after the position has already been closed.
- Portfolio controls: starting capital, fixed sizing, fractional Kelly for expiry trades, max position, max open exposure, slippage/fee allowances.
- Capital is reserved while positions remain open.
- 1y / 2y / 3y result layout, separate Kalshi/Polymarket paths and venue-difference visualization.
- Ask / last-trade / midpoint variants generated on every full run.
- Fill-sensitivity alert when execution assumption changes results materially.
- Parameter sweep, advanced diagnostics and rule-based robustness suggestions.
- Dedicated cross-venue discrepancy page and Settlement Reference Lab.
- Core Test-B browser controls for prediction-shock lookback and BTC move-gate lookback alter the actual timestamped calculation and are regression-tested.
- Missing quotes, reference data, settlement outcomes or explicitly selected BTC-source data fail closed rather than being silently fabricated/substituted.
- Open positions are marked to the executable sell side; entry spread/friction is visible in equity immediately.
- Kalshi and Polymarket settlement outcomes are represented independently.
- Explicit Polymarket NO-token books are used when available rather than always forcing NO = 1 - YES.
- Probability calibration is separated from fees/slippage/all-in execution cost.

### Python high-frequency backend

- Python + Polars + DuckDB + Parquet stack defined in `pyproject.toml`.
- `backend/lead_lag.py` implements the primary Test-B pattern:
  - prediction-market shock over configurable lookback;
  - require BTC to have moved no more than a configurable amount over the same backward-looking window;
  - label BTC moves at 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s, 1m, 3m, 5m and expiry.
- Historical features use backward as-of joins; forward BTC observations are labels only.
- Feature age/staleness is recorded and can be capped with `max_feature_staleness_ms`.
- Forward-label delay is recorded and can be capped with `max_forward_delay_ms`, preventing sparse data from masquerading as sub-second precision.
- Repeated qualifying ticks can be de-clustered per contract with `signal_cooldown_ms`.
- Summaries distinguish raw qualifying ticks, de-clustered signals, unique contracts and valid labeled samples.
- Automated test mutates all BTC prices after a qualifying signal and verifies that signal selection cannot change.
- CLI writes event-level and summary Parquet output.
- `backend/twap_proxy.py` builds explicitly non-exact reconstructed 30s/60s/etc. TWAP proxies from irregular Binance/Coinbase/composite ticks, including start-staleness and maximum in-window gap quality checks.

## Public/read-only acquisition implemented

- Kalshi public REST: live markets/trades/order book/candles plus historical cutoff, historical markets, historical trades and historical candles.
- `kalshi-trades` ingestion automatically splits a requested range around Kalshi's current historical cutoff, queries the correct live/historical tiers, combines and deduplicates them.
- Kalshi market metadata falls back to the historical endpoint on a live 404; candle routing supports `--historical auto|true|false`.
- Polymarket: Gamma metadata, CLOB price history/order book/midpoint, Data API trades.
- Polymarket trade ingestion respects the documented Data API offset cap and warns when the caller must use narrower time chunks.
- Binance market-data-only REST/public stream endpoints.
- Coinbase public BTC-USD ticker/candles/trades/book.
- `scripts/ingest.mjs` validates requested date ranges and saves raw public responses locally.

## Exact settlement-reference acquisition paths

### Kalshi / BRTI

- CME confirms BRTI history exists from its November 2016 launch through licensed/entitled market-data channels.
- Exact raw BRTI history is licensed/entitled data rather than a guaranteed zero-auth public multi-year archive.
- `backend/reference_sources.py` implements CME DataMine OAuth, entitled-file listing and entitled-file download hooks.
- Kalshi resolved-market metadata can still provide exact target/final/outcome information for outcome-only studies before raw BRTI is licensed.
- BRTI publication frequency changed from 1 second to 200ms on May 18, 2026; source-frequency regime must be retained.

### Polymarket / Chainlink Data Streams

- `scripts/chainlink-reference.mjs` uses the official `@chainlink/data-streams-sdk` for credentialed feed/report retrieval and decoding.
- Exact Polymarket resolution source must be preserved per contract; short-duration BTC contracts have used different TWAP streams/rule versions.
- Chainlink's official `getReportsPage` SDK example explicitly documents that the requested timestamp must be within the last 30 days. A credential alone therefore does **not** establish 1–3 years of historical TWAP reports from the standard API.
- Older historical work may use the clearly labeled reconstructed Binance/Coinbase TWAP proxy for research/calibration, but that proxy must never be called exact Chainlink data.
- The Settlement Reference Lab physically separates demo rows from exact rows; exact mode stays withheld until verified exact rows are actually loaded.

See `REFERENCE_DATA_RESEARCH.md`, `LOGIC_AUDIT.md`, `QUESTIONS.txt`, `DECISIONS.md`, and `.env.example`.

## Question / decision register

`QUESTIONS.txt` is now a question-and-answer register rather than a stale list of unresolved prompts. Each item records:

- whether the user's prior requirements resolved it;
- the user's terse/prior answer translated into normal language;
- the concrete repo implication;
- what has been verified/implemented;
- what remains genuinely unanswered.

`DECISIONS.md` is synchronized with recovered decisions including the backend stack, ingestion order, lead/lag horizons, derivatives inputs, execution-cost requirements, settlement-reference integrity, Deribit as primary BTC/ETH options source, staged probability-model development, walk-forward/anti-overfitting requirements, regime testing, minimum-evidence/No-Trade behavior and no automatic real-money execution in the research phase.

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
6. Add Deribit BTC/ETH options for digital/call-spread/IV-skew probability comparisons.
7. Version historical market/date fee regimes rather than relying on one permanent fixed fee estimate.
8. Only build expensive L2/queue-aware maker reconstruction for strategies that survive initial edge tests.

## Intentionally not claimed as complete

- No real normalized multi-month/multi-year BTC prediction-market dataset is committed yet.
- No real strategy edge has been established by the synthetic demo.
- BRTI DataMine entitlement has not been purchased/provided in this repository.
- Chainlink credentials and a long-history Chainlink archive have not been provided.
- Exact historical fee schedules/product-specific fee formulas are not yet normalized into each trade.
- Full L2/partial-fill/queue-aware maker reconstruction remains to be added.
- Full raw-data feature recomputation is still needed for arbitrary VWAP session/confirmation settings, arbitrary EMA lengths/timeframes, arbitrary L2 imbalance depth, realized-volatility lookback settings and source-specific prediction residuals.
- Deribit options ingestion is an approved provider decision but is not implemented yet.
- Automatic walk-forward orchestration, purging/embargo, multiple-testing correction and regime reports remain to be implemented.
- Saved-strategy persistence, export priorities and detailed multi-strategy comparison UI remain genuinely unanswered design choices.
- No order-placement code exists.

## Validation standard

A strategy is not considered interesting because its equity curve survives. Require a persistent, statistically credible edge after realistic execution costs, timestamp-quality/sample-size disclosure, de-clustering/dependence controls, multi-window/regime checks, multiple-testing awareness and walk-forward/out-of-sample validation.

The v0.5 exact-head CI validation completed successfully on 2026-08-23 before merge: JavaScript syntax, deterministic browser-engine tests, Chainlink SDK import, Python backend install/compile, Python research tests and required-file checks all passed.