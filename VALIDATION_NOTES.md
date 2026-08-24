# Validation Checklist

This file records what automated tests protect as the project evolves.

## Browser / JavaScript engine

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
- A generic outcome on a combined row cannot leak into a venue whose outcome is missing.
- Exact reference mode rejects missing venue-reference data rather than silently substituting BTC spot.
- Explicit BTC-spot diagnostic mode is allowed to use the selected proxy.
- Configurable prediction-shock lookbacks change the actual probability comparison.
- Configurable BTC move-gate lookbacks change the actual BTC comparison.
- Explicit Polymarket NO bid/ask/mid/last quotes are preferred over complementary YES inference.
- Explicit Binance/Coinbase source selection fails closed when that source is missing.
- Source-specific BTC technical features are actually used when present.
- BTC crossover logic uses an earlier timestamp rather than an unrelated same-timestamp prediction row.
- Re-entry cooldown applies per contract rather than globally.
- Entry spread is represented immediately in marked equity/drawdown.
- Fixed entry fees change cost/breakeven but do not alter market-probability Brier calibration.
- All-in cost above `$1.00` remains above `$1.00`; a winning settlement may therefore still lose money.
- Official `@chainlink/data-streams-sdk` package installs/imports successfully.
- No live order-placement methods exist in this repository.

## Browser semantic guardrails

`src/uiGuardrails.js` is syntax-validated and keeps the synthetic browser honest about controls that are not production feature-engine operations:

- primary fill selection controls the displayed ask/last/midpoint result while all variants still run;
- synthetic prediction-source selection is locked to Both rather than exposing a cosmetic venue switch;
- synthetic timestamp aggregation is locked to raw/generated timestamps;
- `minEdgePct` is visibly Kelly-only;
- early-exit robustness output is guarded from using binary settlement edge as an accept/reject rule;
- precomputed-feature controls are visibly identified.

These DOM behaviors are not yet covered by a full headless-browser integration suite; they are intentionally listed as presentation guardrails rather than proof of production data behavior.

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
- Summary output distinguishes valid labels, de-clustered qualifying events, raw qualifying ticks and unique contracts.
- Per-contract `signal_cooldown_ms` removes repeated same-contract ticks without suppressing another contract.
- Prediction probabilities outside `[0,1]` are rejected.
- Anti-lookahead invariant: modifying BTC prices **after** the signal cannot change which historical signals are selected; only future labels may change.

## Reconstructed TWAP proxy

Automated Python tests verify that:

- irregular ticks are integrated by elapsed time, not averaged by trade count;
- 30s and 60s-style windows are ordinary configurable window lengths;
- a target fails closed when no price exists at/before the window start;
- an overly stale start price can invalidate a window;
- multiple target timestamps are supported;
- proxy outputs explicitly report `is_exact_source = false`.

## Audit status

The v0.4 bug audit corrected software defects in execution, history ingestion, reference handling and timing quality. The v0.5 logic audit then cross-checked the code against the project's intended research semantics and added adversarial cases for source selection, NO-token execution, cooldown scope, probability-vs-cost separation, repeated-signal dependence and TWAP reconstruction.

See `BUG_AUDIT.md` and `LOGIC_AUDIT.md`.

Real historical profitability is **not** validated by these tests. That requires actual normalized venue history, rule-versioned contract mapping, realistic historical costs, dependence/multiple-testing controls, regime analysis and walk-forward/out-of-sample research.
