# Validation Checklist

This file records what automated tests protect as the project evolves.

## Browser / JavaScript

- JavaScript modules parse under Node 22.
- Synthetic dataset generation is deterministic and produces sufficient observations.
- Kalshi and Polymarket backtests both execute.
- Ask, last-trade, and midpoint variants execute independently.
- BTC + prediction-market mixed factor strategies execute.
- Target/stop early exits execute without applying binary Kelly incorrectly.
- Parameter sweeps produce numeric results.
- Venue equity-difference data remains finite.
- Official `@chainlink/data-streams-sdk` package installs/imports successfully.
- No live order-placement methods exist in this repository.

## Python high-frequency backend

- Python package installs as an editable package.
- Backend modules compile.
- Polars lead/lag engine executes on deterministic timestamped input.
- Prediction shock + muted-BTC condition selects the expected event.
- 100ms / 1s / expiry forward labels resolve to the expected future BTC observations.
- Anti-lookahead invariant: modifying BTC prices **after** the signal cannot change which historical signals are selected; only future labels may change.

## Latest expanded validation

The corrected v0.3 validation run completed successfully after fixing Python package discovery. It covered Node install/syntax, browser-engine smoke tests, Chainlink SDK import, Python dependency installation/compilation, pytest lead/lag tests, and required-file checks.

Temporary validation pull requests are closed without merging their probe files.

Real historical profitability is **not** validated by these tests. That requires actual normalized venue history, exact contract rules/reference sources, realistic costs and out-of-sample research.
