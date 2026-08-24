# Full Code Bug Audit — v0.4

Audit performed 2026-08-23/24 against the full repository: browser strategy engine, portfolio accounting, synthetic data, API adapters/ingestion, reference lab, Python/Polars lead-lag backend, tests, and CI.

## Correctness bugs fixed

### Backtest / portfolio engine

- **Missing quote fabrication:** a missing venue quote could fall through to an invented `0.50` contract price. Missing executable data now produces no fill rather than a fake fair price.
- **Cross-contract crossing leakage:** prediction price `crosses_up` / `crosses_down` could compare with the globally previous row even when it belonged to another contract. Crossing logic now uses the previous observation of the same contract.
- **Null crossing bug:** JavaScript converts `null` to numeric zero. An event with no prior contract observation could therefore appear to cross upward. Crossing conditions now require an actual finite previous value.
- **Shared venue outcomes:** the demo used one settlement result for Kalshi and Polymarket even when their simulated reference prices resolved on opposite sides of the threshold. Venue-specific outcomes are now stored and used independently.
- **Reference-source leakage:** exact/reference-mode factors could silently fall back to composite BTC spot when a venue reference was absent. Exact venue-reference mode now rejects the observation; spot substitution is allowed only in explicitly selected diagnostic proxy mode.
- **Open-position mark:** open positions were initially marked at the buy-side quote. Mark-to-market now uses the executable sell side (and configured exit friction), so spread cost appears immediately in drawdown/equity.
- **NO probability diagnostic:** the digital-option probability reference now uses `1 - P(YES)` for NO positions rather than reusing the YES probability.
- **Expiry parsing:** normalized expiries may arrive as ISO strings or Unix seconds/milliseconds/microseconds/nanoseconds. The engine now normalizes these formats explicitly.
- **Missing outcomes:** rows without a known venue outcome are skipped rather than being coerced to false.
- **Descending parameter sweeps:** sweep logic now supports ranges such as `0.70 -> 0.30` rather than silently returning no points.
- **Venue equity-difference curve:** missing timestamps previously reset one side to starting capital. The curve now forward-fills each venue's last known portfolio equity independently.

### Strategy-factor integrity

- **Prediction-shock lookback:** `lookbackSeconds` now changes the actual same-contract probability comparison rather than only changing a UI label.
- **Prediction velocity:** velocity is derived from actual same-contract quote timestamps rather than a fixed precomputed value when the factor runs.
- **BTC move-gate lookback:** `lookbackSeconds` now changes the actual selected BTC-source comparison.
- **Momentum lookback:** `lookbackMinutes` now changes the actual selected BTC-source return window.
- **Cross-market timestamp tolerance:** if venue quote timestamps are present, the Kalshi/Polymarket spread factor now rejects pairs outside the configured matching tolerance.

### Public-data ingestion

- **Kalshi history cutoff:** complete Kalshi trade history is split between live and `/historical/...` APIs. The ingester now reads Kalshi's current cutoff, fetches the appropriate historical/live tiers, and deduplicates the combined result.
- **Historical Kalshi market lookup:** market metadata now falls back to the historical endpoint when the live endpoint returns 404.
- **Kalshi candle routing:** candle ingestion supports `--historical auto|true|false` rather than requiring the caller to know storage tier manually.
- **Timestamp validation:** invalid dates and reversed start/end windows now fail clearly.
- **Polymarket offset cap:** the Data API trade pager now stops at its documented offset limit and warns that the user must ingest narrower time chunks instead of issuing invalid requests.
- **Binance aggregate-trade pagination:** pager progress is validated and output is explicitly clipped to the requested time range.

### Settlement Reference Lab

- **Synthetic-as-exact future hazard:** the exact-source screen previously shared the same in-memory demo dataset, meaning a future adapter flag could have caused synthetic reference rows to render under an Exact label. Exact and demo stores are now physically separate and exact charts remain withheld until verified exact rows are loaded.
- Venue selection now actually controls which reference cards/charts/table columns are shown.
- Non-finite chart values are filtered instead of poisoning the canvas scale.

### Python high-frequency lead/lag engine

- **Sparse-label precision:** a requested `100ms` label could use the next BTC tick much later than 100ms without exposing the delay. Every forward label now records actual delay, with an optional `max_forward_delay_ms` cutoff.
- **Stale backward features:** as-of joins now expose prediction/BTC feature age and can reject stale matches with `max_feature_staleness_ms`.
- **Sample-count inflation:** horizon summaries now report the number of valid labels separately from total qualifying signals.
- Invalid prediction probabilities outside `[0,1]`, nonpositive BTC prices, and null required inputs are removed before analysis.
- The anti-lookahead invariant remains tested: changing future BTC prices cannot alter the historical signal set.

## Regression coverage added

JavaScript tests now explicitly cover:

- missing quotes do not trade;
- same-contract crossing behavior;
- null previous values do not create crosses;
- venue-specific outcomes;
- exact-reference missing-data rejection vs explicit spot-proxy mode;
- ascending and descending sweeps;
- true forward-filled venue-difference curves;
- configurable prediction-shock lookback;
- configurable BTC move-gate lookback;
- both venues and ask/last/midpoint execution variants;
- mixed BTC + prediction factors and early exits.

Python tests now explicitly cover:

- expected 100ms / 1s / expiry labels;
- future-data anti-lookahead;
- forward-label delay rejection;
- backward-feature staleness rejection;
- valid-label sample counts;
- invalid-probability filtering.

## Known feature-engine limitations — not presented as validated edge logic

The browser demo still contains several controls whose **full production meaning requires normalized raw feature data** rather than the current synthetic/precomputed feature fields:

- VWAP session selection and multi-bar confirmation;
- arbitrary EMA fast/slow lengths and candle timeframe;
- order-book imbalance at arbitrary requested depth levels;
- realized-volatility lookback recomputation;
- historical fee schedules and venue/product-specific dynamic fee formulas;
- queue-aware maker/L2 fill reconstruction;
- reconstructed historical Chainlink TWAP calibration for Polymarket.

These are intentionally classified as **remaining feature-engine work**, not validated strategy parameters. The core Test-B timing controls (prediction shock lookback and BTC move gate) are now calculation-active and regression-tested.

## Audit conclusion

The corrected codebase is materially safer for research: it now fails closed on missing execution/reference/outcome data, preserves venue-specific settlement behavior, exposes timestamp quality in the high-frequency backend, and has regression tests for the bugs found during the audit.

This audit validates software behavior, **not historical profitability or the existence of a trading edge**. Real-edge claims still require normalized historical data, correct per-contract rules, historical fee/fill modeling, parameter stability, and walk-forward/out-of-sample validation.
