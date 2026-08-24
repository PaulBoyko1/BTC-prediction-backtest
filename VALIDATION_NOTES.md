# Validation Checklist

This file records what automated tests protect as the project evolves.

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
- Summary output distinguishes total qualifying signals from valid labeled samples at each horizon.
- Prediction probabilities outside `[0,1]` are rejected.
- Anti-lookahead invariant: modifying BTC prices **after** the signal cannot change which historical signals are selected; only future labels may change.

## Audit status

The v0.4 bug-audit branch has been validated repeatedly in GitHub Actions during development. An early expanded run intentionally exposed a null-crossing bug (`Number(null) === 0` behavior); the condition was corrected and retained as a regression test. Subsequent expanded runs passed the JavaScript regression suite, Chainlink SDK import, Python dependency installation/compilation, pytest timing/lead-lag tests, and required-file checks.

See `BUG_AUDIT.md` for the complete list of defects found, fixes made, and feature-engine limitations that remain intentionally unclaimed.

Real historical profitability is **not** validated by these tests. That requires actual normalized venue history, exact contract rules/reference sources, realistic historical costs and out-of-sample research.
