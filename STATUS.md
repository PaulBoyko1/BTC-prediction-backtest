# BTC Prediction Backtest — Current Status

## Implemented now

### Browser research workbench

- Two starting branches: Prediction Markets / BTC.
- Mixed BTC + prediction-market + settlement-reference factor composition.
- Prediction factors: contract price, probability shock, probability velocity, order-book imbalance, time-to-expiry, strike geometry, venue spread, prediction residual vs BTC.
- BTC factors: named VWAP setups, EMA, prior-day/week levels, momentum, volatility, round levels, small/large BTC move gate.
- Reference factors: reference-vs-strike and reference-vs-spot.
- Trade target separated from signals: venue, side, horizon.
- Re-entry controls: once, limited, repeated + **per-contract** cooldown.
- Exit controls: settlement, price target, target+stop, time-before-expiry.
- Portfolio controls: starting capital, fixed sizing, fractional Kelly for expiry trades, max position, max open exposure, slippage/fee allowances.
- Capital is reserved while positions remain open.
- Immediate post-entry marking uses the executable sell side so spread/exit friction appears in drawdown without waiting for another observation.
- 1y / 2y / 3y result layout, separate Kalshi/Polymarket paths and venue-difference visualization.
- Ask / last-trade / midpoint variants generated on every full run; ask remains canonical by default and the browser selector now controls which completed variant is displayed first.
- Fill-sensitivity alert when execution assumption changes results materially.
- Parameter sweep, advanced diagnostics and rule-based robustness suggestions.
- Target/stop/time strategies are guarded from being accepted/rejected solely by binary settlement-edge statistics.
- Dedicated cross-venue discrepancy page and Settlement Reference Lab.
- Core Test-B browser controls for prediction-shock lookback and BTC move-gate lookback alter the actual timestamped calculation and are regression-tested.
- Missing quotes, explicitly selected BTC-source data, reference data, or settlement outcomes fail closed instead of being silently fabricated/substituted.
- Kalshi and Polymarket settlement outcomes are represented independently.
- Polymarket explicit NO-token quotes are preferred when available; complementary YES reconstruction is only a schema fallback.
- Market-probability calibration is kept separate from all-in fee/slippage cost.
- All-in binary unit cost is allowed to exceed `$1.00` when explicit friction makes that economically true.

### BTC-source integrity

Explicit Binance/Coinbase selection no longer falls back to another BTC source. Source-specific values are honored for spot, VWAP, EMA, prior-day/week levels, realized volatility, round levels, momentum, BTC-move gates, reference-vs-spot and model-probability inputs.

BTC crossover logic requires a prior observation from an earlier timestamp; an unrelated prediction-contract row at the same timestamp cannot become the previous BTC state.

### Browser truth/guardrails

- Browser synthetic runs intentionally compare both prediction venues. The previously cosmetic `predictionSource` switch is disabled/relabelled in demo mode rather than pretending it changes the synthetic calculation; real backend runs are venue-specific by input dataset.
- Browser synthetic observations remain raw/generated timestamps. Resolution aggregation is a backend-normalization operation, so the previously cosmetic timestamp-resolution control is disabled/relabelled in demo mode.
- `minEdgePct` is visibly Kelly-only and disabled under fixed-% sizing.
- Advanced factors that still depend on precomputed/demo features display a warning rather than implying every parameter is production-calculation-active.

### Python high-frequency backend

- Python + Polars + DuckDB + Parquet stack defined in `pyproject.toml`.
- `backend/lead_lag.py` implements Test B:
  - prediction-market shock over configurable lookback;
  - require BTC to have moved no more than a configurable amount over the same backward-looking window;
  - label BTC moves at 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s, 1m, 3m, 5m and expiry.
- Historical features use backward as-of joins; forward BTC observations are labels only.
- Feature age/staleness is recorded and can be capped with `max_feature_staleness_ms`.
- Forward-label delay is recorded and can be capped with `max_forward_delay_ms`.
- Optional `signal_cooldown_ms` de-clusters repeated qualifying ticks per contract.
- Horizon summaries report valid labeled samples, de-clustered qualifying events, raw qualifying ticks and unique contracts separately.
- Automated test mutates all BTC prices after a qualifying signal and verifies that signal selection cannot change.
- CLI writes event-level and summary Parquet output.

### Reconstructed TWAP proxy

- `backend/twap_proxy.py` computes transparent time-weighted averages from irregular Binance/Coinbase/composite ticks.
- 30s, 60s or other windows are supported.
- A window fails closed if no price exists at/before the start; optional start-price staleness limits are supported.
- Output records completeness, source label and `is_exact_source = false`.
- CLI command `twap-proxy` writes a Parquet proxy series.
- This is a **reconstructed spot proxy**, never exact Chainlink Data Streams.

## Public/read-only acquisition implemented

- Kalshi public REST: live markets/trades/order book/candles plus historical cutoff, historical markets, historical trades and historical candles.
- `kalshi-trades` ingestion automatically splits a requested range around Kalshi's current historical cutoff, queries the correct live/historical tiers, combines and deduplicates them.
- Kalshi market metadata falls back to the historical endpoint on a live 404; candle routing supports `--historical auto|true|false`.
- Polymarket: Gamma metadata, CLOB price history/order book/midpoint, Data API trades.
- Polymarket trade ingestion respects the documented Data API offset cap and warns when narrower time chunks are required.
- Binance market-data-only REST/public stream endpoints.
- Coinbase public BTC-USD ticker/candles/trades/book.
- `scripts/ingest.mjs` validates date ranges, exposes pagination truncation metadata/warnings, and saves raw public responses locally.

## Exact settlement-reference acquisition paths

### Kalshi / BRTI

- CME confirms BRTI historical data exists back to November 2016 through its market-data channels.
- Exact raw BRTI history is licensed/entitled data rather than a zero-auth public archive.
- `backend/reference_sources.py` implements CME DataMine OAuth, token refresh, entitled-file listing and entitled-file download hooks.
- Kalshi resolved-market metadata can still provide exact target/final/outcome information for outcome-only studies before raw BRTI is licensed.
- BRTI publication frequency changed from 1 second to 200ms on May 18, 2026; source-frequency regime must be retained.

### Polymarket / Chainlink Data Streams

- `scripts/chainlink-reference.mjs` uses the official `@chainlink/data-streams-sdk` for credentialed feed/report retrieval and decoding.
- Exact Polymarket resolution source must be preserved per contract; short-duration BTC contracts have used rule/version-specific TWAP streams.
- Chainlink's standard historical-page SDK example does not establish multi-year exact oracle history.
- Older historical work may use the new reconstructed Binance/Coinbase/composite TWAP proxy for research/calibration, but that proxy must never be called exact Chainlink data.
- The Settlement Reference Lab physically separates demo rows from exact rows; exact mode stays withheld until verified exact rows are loaded.

See `REFERENCE_DATA_RESEARCH.md`, `BUG_AUDIT.md`, `LOGIC_AUDIT.md`, and `.env.example`.

## Contract-geometry rule

Real studies must preserve the contract's actual `rule_version`, `settlement_source`, target/comparison value and `comparison_start_value`. A normalized strike/threshold may be used for common distance calculations only after those source-specific rules are mapped correctly; cross-venue wording is never assumed equivalent merely because both markets are labeled BTC Up/Down.

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
4. Run the high-frequency lead/lag grid with conservative executable/taker assumptions and both raw/de-clustered event counts.
5. Add equivalent Polymarket contracts while preserving each exact rule/reference source; use reconstructed TWAP only as explicitly labeled proxy where exact Chainlink history is unavailable.
6. Only build expensive L2/queue-aware maker reconstruction for strategies that survive initial edge tests.

## Intentionally not claimed as complete

- No real normalized multi-month/multi-year BTC prediction-market dataset is committed yet.
- No real strategy edge has been established by the synthetic demo.
- BRTI DataMine entitlement has not been purchased/provided in this repository.
- Chainlink credentials and a long-history Chainlink archive have not been provided.
- Historical fee schedules and full L2/queue-aware fill reconstruction remain to be added.
- Full raw-data feature recomputation is still needed for arbitrary VWAP session/confirmation settings, arbitrary EMA lengths/timeframes, arbitrary L2 imbalance depth, and realized-volatility lookback settings.
- Prediction residual-vs-BTC remains a precomputed demo feature until the normalized feature engine computes source-specific residuals from real data.
- Statistical multiple-testing correction, regime analysis and walk-forward/OOS orchestration remain required.
- No order-placement code exists.

## Validation standard

A strategy is not considered interesting because its equity curve survives. Require a persistent, statistically credible edge after realistic execution costs, timestamp-quality/sample-size disclosure, event de-clustering/dependence checks, multi-window/regime checks and walk-forward/out-of-sample validation.
