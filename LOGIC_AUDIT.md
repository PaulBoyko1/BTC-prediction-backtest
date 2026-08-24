# Idea-to-Code Logical Consistency Audit — v0.5

This audit cross-checks the implemented system against the project ideas and research rules, not merely against syntax or unit-level correctness. It follows the v0.4 bug audit and focuses on whether a control or statistic means what its label says it means.

## Core invariants now enforced

### Execution and binary-contract economics

- Ask remains the canonical executable-buy assumption; last trade and midpoint are sensitivity variants.
- The browser still runs all three fill variants. The "Displayed primary result" selector only chooses which completed result is surfaced first.
- Missing executable quotes fail closed.
- Re-entry cooldown is **per contract**, so a signal in contract A cannot suppress an otherwise valid entry in contract B.
- `once`, `limited`, and `repeat` entry modes remain contract-scoped.
- Open positions mark to the executable sell side, and an immediate post-entry equity point records spread/exit friction without waiting for another observation.
- Entry cost is not artificially capped below `$1.00`. If explicit friction makes a binary unit cost exceed its maximum payout, a winning settlement can correctly produce a loss.
- Fixed-percentage sizing does not pretend to use `minEdgePct`; the browser labels that field as a Kelly-only posterior-edge gate.
- Binary Kelly remains restricted to hold-to-expiry studies. Arbitrary target/stop/time exits use fixed sizing instead.

### YES / NO consistency

- Kalshi/Polymarket settlement outcomes remain venue-specific.
- Combined rows do not borrow a generic outcome for a venue whose own outcome is missing.
- Polymarket YES and NO are modeled as separate outcome-token books when explicit NO quotes exist. Complementary `1 - YES` reconstruction is only a fallback for schemas that genuinely expose only YES-side quotes.
- Probability calibration uses the observed side-specific market probability, preferably midpoint, rather than all-in cost after fees/slippage.

### BTC-source consistency

When BTC source is explicitly Binance or Coinbase, the engine no longer silently falls back to another venue.

The selected source is now honored for:

- spot price;
- VWAP feature value;
- EMA feature values;
- prior-day high/low/close;
- prior-week average/high/low/close;
- realized volatility input;
- round-level distance;
- return momentum;
- BTC-move gates;
- reference-vs-spot comparisons;
- digital-probability diagnostic inputs.

BTC crossover tests use a previous observation from an **earlier timestamp**, not merely the globally previous prediction-contract row. Another contract snapshot sharing the same timestamp cannot erase or fabricate a BTC crossover.

### Prediction-market signal consistency

- Contract-price crossing is same-contract.
- Probability shock lookbacks are same-contract and calculation-active.
- Probability velocity uses actual same-contract elapsed time.
- Cross-market spread checks can enforce quote timestamp tolerance.
- Repeated high-frequency Test-B shocks can be de-clustered per contract with `signal_cooldown_ms`.
- Lead/lag summaries report raw qualifying ticks, de-clustered qualifying events, unique contracts, and valid labels separately so one persistent repricing episode is not silently presented as many independent observations.

### High-frequency time integrity

- Historical features are backward as-of only.
- Future BTC values are labels only.
- Feature staleness is observable/cappable.
- Forward-label delay is observable/cappable.
- The anti-lookahead mutation test remains in force.
- Raw source timestamps are preserved before any optional aggregation.

## Polymarket settlement-reference logic

Current short-duration Polymarket BTC Up/Down markets use Chainlink BTC/USD TWAP streams. Exact Chainlink history remains a different data tier from exchange spot.

v0.5 adds `backend/twap_proxy.py`, which computes a **reconstructed, piecewise-constant time-weighted average** from irregular BTC ticks for 30s/60s or other windows. It:

- requires a price observation at or before the requested window start;
- can reject an overly stale carried-forward starting price;
- records window completeness and provenance;
- always emits `is_exact_source = false`;
- is intended for Binance, Coinbase, or an explicitly constructed composite proxy;
- must never be labeled exact Chainlink Data Streams.

This closes the mechanical "we can calculate a TWAP" gap while preserving oracle-source honesty.

## Contract geometry

The normalized schema must keep the economic comparison threshold separate from source-specific rule text.

- Kalshi BTC15M currently resolves its final-minute BRTI average against a contract Target Price.
- Polymarket BTC Up/Down resolves according to the specific Chainlink TWAP rule and beginning-of-interval comparison defined by that contract.
- A normalized `strike`/comparison threshold can support common distance calculations **only after** the source contract's actual target/comparison value is mapped correctly.
- `rule_version`, `settlement_source`, and `comparison_start_value` remain mandatory provenance for real cross-venue analysis.

## Browser semantic guardrails

The browser synthetic workbench intentionally always compares both prediction venues. The old `predictionSource` selector did not actually remove a venue from the synthetic run, so v0.5 disables/relabels that browser control rather than allowing a cosmetic switch to masquerade as calculation logic. Real backend studies remain venue-specific by the input dataset supplied.

Likewise, the browser `timestampResolution` selector did not aggregate synthetic observations. It is disabled/relabelled in demo mode; resolution changes belong in normalized backend processing.

For target/stop/time exits, the browser robustness card no longer treats `settlement win rate - all-in entry price` as the accept/reject rule. That statistic remains diagnostic, while realized payoff distribution, return, average P/L, profit factor, drawdown, sample size and fill sensitivity are the relevant evaluation family.

## Still intentionally incomplete / guarded

These are not hidden; the UI and status documents identify them as feature-engine work:

1. Arbitrary VWAP session definitions and multi-bar confirmation are not yet recomputed from raw normalized bars.
2. Arbitrary EMA fast/slow lengths and selected candle timeframe are not yet recomputed from raw bars.
3. Arbitrary order-book imbalance depth is not yet rebuilt from full L2 snapshots.
4. Realized-volatility lookback selection is not yet recomputed from raw returns.
5. Prediction-market residual-vs-BTC is still a precomputed demo feature; source-specific residual production must be generated in the normalized feature engine before Binance-vs-Coinbase residual comparisons are treated as real evidence.
6. Historical fee schedules/product-specific fee formulas are not yet versioned into each trade.
7. Partial fills, queue position, maker fill probability and adverse selection remain future L2 work.
8. Real 1y/2y/3y output still depends on actual product history and cannot be synthetic-padded.
9. Statistical multiple-testing control, regime breakdowns and walk-forward/OOS orchestration remain required before calling a discovered parameter grid an edge.
10. BTC derivatives/perpetual features (funding, basis, OI, liquidations and perp order-book imbalance) remain an approved next data layer.

## What v0.5 validation protects

JavaScript adversarial tests now cover:

- explicit Polymarket NO books;
- strict selected-BTC-source failure behavior;
- source-specific VWAP behavior;
- same-timestamp BTC crossover integrity;
- per-contract cooldown behavior;
- immediate spread drawdown;
- fee/cost separation from probability calibration;
- combined-row settlement-outcome isolation;
- all-in unit cost above `$1.00`.

Python tests now additionally cover:

- per-contract signal de-clustering;
- raw vs de-clustered signal counts;
- unique-contract counts;
- irregular-tick time-weighted TWAP math;
- incomplete TWAP window rejection;
- starting-price staleness rejection;
- explicit non-exact proxy provenance.

## Audit conclusion

The core execution, source selection, timing, settlement-outcome, fill-sensitivity and Test-B mechanics are now internally consistent with the stated research design. Where the browser cannot yet honor an advanced parameter from raw data, it is explicitly guarded rather than silently pretending the setting is active.

This still does **not** establish a trading edge. Real normalized history, rule-versioned settlement data, historical costs, de-correlated event statistics, parameter-stability checks and walk-forward/OOS validation remain necessary before any strategy conclusion is credible.
