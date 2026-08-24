# Validation Checklist

This file records what the automated smoke test is intended to protect as the project evolves.

- JavaScript modules parse under Node 22.
- Synthetic dataset generation is deterministic and produces sufficient observations.
- Kalshi and Polymarket backtests both execute.
- Ask, last-trade, and midpoint variants execute independently.
- BTC + prediction-market mixed factor strategies execute.
- Target/stop early exits execute without applying binary Kelly incorrectly.
- Parameter sweeps produce numeric results.
- Venue equity-difference data remains finite.
- No live order-placement methods exist in this repository.

Real historical profitability is **not** validated by these smoke tests. That requires actual normalized venue history, exact contract rules/reference sources, and out-of-sample research.
