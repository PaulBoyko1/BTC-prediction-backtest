# Validation Checklist

This file records what automated tests and manual consistency checks protect as the project evolves.

## Browser / JavaScript

- JavaScript modules parse under Node 22.
- Synthetic dataset generation is deterministic and produces sufficient observations.
- Kalshi and Polymarket backtests both execute.
- Ask, last-trade, and midpoint variants execute independently.
- BTC + prediction-market mixed factor strategies execute.
- Target/stop early exits execute without applying binary Kelly incorrectly.
- Ascending and descending parameter sweeps produce numeric results.
- Venue equity-difference data forward-fills each portfolio correctly.
- Missing quotes do not become fabricated 50-cent fills.
- Prediction crossing logic uses the previous observation from the same contract.
- A null/missing previous quote cannot create a false crossing event.
- Kalshi and Polymarket use their own settlement outcomes when they disagree.
- Exact reference mode rejects missing venue-reference data rather than silently substituting BTC spot.
- Explicit BTC-spot diagnostic mode is allowed to use the selected proxy.
- Configurable prediction-shock lookbacks change the actual probability comparison.
- Configurable BTC move-gate lookbacks change the actual BTC comparison.
- Explicit Polymarket NO-token quotes are preferred when present.
- Explicit Binance/Coinbase source selection fails closed rather than silently falling back to composite data.
- Source-specific VWAP behavior is regression-tested.
- Same-timestamp snapshots from unrelated contracts cannot erase a valid BTC crossover.
- Re-entry cooldown is per contract.
- Entry spread/exit friction appears immediately in marked equity.
- Fixed fees change all-in breakeven cost but do not change the underlying probability-calibration input.
- A combined Kalshi/Polymarket row cannot leak a generic settlement outcome into the other venue.
- All-in cost above $1 remains above $1; it is not clamped into an artificial profitable range.
- A 45c->55c style mean-reversion target cycle is regression-tested.
- Repeated low->high volatility-harvesting cycles inside one contract are regression-tested.
- A completed profitable early exit remains profitable even when the contract later settles against the originally purchased side.
- Official `@chainlink/data-streams-sdk` package installs/imports successfully.
- No live order-placement methods exist in this repository.

## Python high-frequency backend

- Python package installs as an editable package.
- Backend modules compile.
- Polars lead/lag engine executes on deterministic timestamped input.
- Prediction shock + muted-BTC condition selects the expected event.
- 100ms / 1s / expiry forward labels resolve to the expected future BTC observations.
- Requested-horizon vs actual-tick delay is measured.
- A future label beyond `max_forward_delay_ms` is nulled and not counted as a valid labeled sample.
- Backward as-of match ages are measured.
- Signals with feature matches older than `max_feature_staleness_ms` are rejected.
- Repeated signal ticks can be de-clustered per contract.
- Summary output distinguishes raw qualifying ticks, de-clustered events, unique contracts and valid labeled samples.
- Prediction probabilities outside `[0,1]` are rejected.
- Anti-lookahead invariant: modifying BTC prices **after** the signal cannot change which historical signals are selected; only future labels may change.
- Reconstructed TWAP uses time weighting rather than trade-count averaging.
- TWAP windows reject missing start coverage.
- Optional start-staleness thresholds fail closed.
- Optional maximum in-window observation gaps fail closed.
- Reconstructed TWAP always carries explicit non-exact proxy provenance.

## Question / decision register verification

The 2026-08-23 requirements-resolution pass also checked that `QUESTIONS.txt` does not confuse recommendations with user decisions.

Resolved decisions were cross-checked against prior project requirements and synchronized into `DECISIONS.md`:

- Python + Polars + DuckDB + Parquet backend;
- Kalshi BTC15m + Binance/Coinbase first, then Polymarket;
- all standard 100ms-through-expiry lead/lag horizons;
- perp/funding/basis/OI/liquidation/order-book inputs as an approved future data layer;
- taker/executable first-stage testing before expensive maker/L2 reconstruction;
- exact settlement-reference integrity / proxy labeling;
- historical execution costs and fee-regime versioning;
- Deribit as primary BTC/ETH options source;
- explainable probability baselines before calibrated ML;
- walk-forward/OOS, purging/embargo where required, multiple-testing awareness and parameter stability;
- regime breakdowns;
- Insufficient Evidence / No Trade as valid research conclusions;
- no automatic real-money execution in the research phase.

Items with no recovered explicit answer remain marked genuinely unanswered rather than being converted into fake decisions: session convention, exact VWAP confirmation semantics, final maker-fill model, universal numeric evidence thresholds, saved-strategy persistence, export priority and detailed saved-strategy comparison UI.

### External accuracy checks performed 2026-08-23

- CME official notice confirms BRTI publication changed from 1s to 200ms on May 18, 2026.
- Chainlink's official Data Streams SDK `getReportsPage` example explicitly says the requested timestamp must be within the last 30 days; standard API credentials do not by themselves prove a multi-year exact archive.
- Kalshi's current Help Center says fees can differ by market and some markets can have maker fees.
- Polymarket's current Help Center documents fee-enabled categories/markets, current maker/taker treatment and category-dependent taker fee formulas, so historical fee regimes must be versioned instead of represented by one permanent fixed fee.
- Deribit's official public API supports BTC/ETH option instruments, strikes, expirations and instrument commission metadata, confirming it is technically appropriate as the primary options source selected for this project.

## Audit status

The v0.5 logical-consistency branch has been validated repeatedly in GitHub Actions during development. Earlier expanded runs intentionally surfaced implementation issues that were fixed and retained as regressions. The exact final branch head must pass the same complete CI workflow before merge.

See `LOGIC_AUDIT.md`, `QUESTIONS.txt`, `DECISIONS.md`, `REFERENCE_DATA_RESEARCH.md` and `STATUS.md` for the detailed reasoning and remaining limitations.

Real historical profitability is **not** validated by these tests. That requires actual normalized venue history, exact contract rules/reference sources, historical costs, realistic fills and serious out-of-sample research.