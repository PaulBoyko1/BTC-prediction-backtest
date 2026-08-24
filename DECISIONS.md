# Approved Research Decisions

Confirmed/recovered through 2026-08-23.

This file contains decisions the user has already made in prior project requirements. It intentionally does not turn recommendations into user decisions when no explicit answer was found; those remain marked open in `QUESTIONS.txt`.

1. **Backtest backend**
   - Use Python for heavy historical research.
   - Preferred stack: Polars + DuckDB + Parquet.
   - Keep the browser/JavaScript app as the interactive strategy-composer and visualization layer.

2. **Initial historical ingestion order**
   - Start with Kalshi BTC 15-minute contracts plus Binance and Coinbase BTC data.
   - Add matching Polymarket BTC contracts immediately after the Kalshi baseline is working.
   - Do not force Kalshi and Polymarket into one normalized contract family when their rules/reference sources differ.

3. **Standard lead/lag output horizons**
   - 100 ms
   - 250 ms
   - 500 ms
   - 1 s
   - 2 s
   - 5 s
   - 10 s
   - 30 s
   - 1 min
   - 3 min
   - 5 min
   - contract expiry

4. **BTC derivatives/microstructure inputs**
   - Include perpetual-futures information where obtainable: funding, basis, open interest, liquidations and perp order-book imbalance.
   - Treat these as possible explanatory variables for prediction-market repricing rather than assuming prediction markets are the original information source.

5. **Execution modeling priority**
   - First search for statistically credible signal edges using conservative executable/taker assumptions.
   - Include fees, bid/ask spread, slippage and funding/other relevant carrying costs in expectancy.
   - Only spend substantial effort on historical L2 reconstruction, partial fills, queue position and maker-fill simulation for strategies that survive the first-stage tests.
   - Do not treat midpoint/last trade as guaranteed executable fills.

6. **Settlement-reference integrity**
   - Never silently substitute Binance/Coinbase/composite spot for CF Benchmarks BRTI or Chainlink Data Streams.
   - If exact reference history is unavailable, exclude reference-specific historical tests or label them as proxy diagnostics.
   - Outcome-only studies may use verified venue settlement outcomes/final metadata even if the full intracontract reference path is unavailable.
   - Continue research/acquisition of exact BRTI and Chainlink historical data.
   - Version contract settlement/reference rule changes rather than pooling them silently.

7. **Validation standard**
   - An attractive historical equity curve is not enough.
   - Require realistic execution, sample-size reporting, multi-window stability, regime analysis and walk-forward/out-of-sample validation before calling a result an edge.
   - Allow the research system to conclude `No Trade` / `Insufficient Evidence` instead of forcing a directional answer.

8. **Historical cost regimes**
   - Production backtests should use the fee/cost structure that actually applied to the market and period being tested whenever that information is available.
   - Market/date fee changes must be versioned rather than represented by one permanent fixed fee assumption.
   - The browser's fixed cents/share fee fields are sensitivity controls, not a claim of historically exact venue fees.

9. **Options data and probability comparisons**
   - Use Deribit as the primary BTC/ETH options source for option-implied probability work.
   - Use secondary venues as cross-checks/fallbacks where useful rather than making them the primary probability surface.
   - Keep risk-neutral option-implied probabilities conceptually separate from real-world/calibrated forecast probabilities.

10. **Probability-model development order**
    - Start with explainable baselines and market-implied references.
    - Include digital N(d2), IV/skew/smile, call-spread binary probabilities, option-implied terminal distributions, Greeks and empirical realized distributions as the data becomes available.
    - Compare empirical/calibrated models against those baselines.
    - More complex boosted-tree/ML models come later and should be calibrated rather than treated as authoritative raw scores.

11. **Anti-overfitting / multiple testing**
    - Parameter sweeps are allowed and encouraged for research, but the number of tested variants must be disclosed.
    - Serious validation should include rolling/expanding walk-forward testing rather than one static in-sample fit.
    - Use purging/embargo where overlapping horizons can leak information.
    - Use bootstrap/permutation and multiple-testing controls where sample size supports them.
    - Parameter stability matters more than one isolated historical optimum.

12. **Regime testing**
    - Break results down by materially different market environments rather than trusting one pooled average.
    - Relevant regimes include BTC direction/trend, realized volatility, time of day, day of week, liquidity/spread, contract probability/price, time to expiry, venue/rule version and fee regime where data supports the split.

13. **Minimum evidence / uncertainty**
    - The system should be able to withhold a strategy conclusion when evidence is thin.
    - Evidence assessment should consider sample size, distinct/de-clustered signal episodes, confidence intervals, out-of-sample observations, drawdown/tails, execution-data quality, parameter stability and regime coverage.
    - Exact universal numeric cutoffs are not fixed yet; they should be calibrated after real sample distributions are available.

14. **No automatic real-money execution in the research phase**
    - The current project is a research/backtesting system, not an automatic trading bot.
    - A later read-only signal-monitoring layer is compatible with the project, but order placement should remain separate unless explicitly authorized as a future project decision.

See `QUESTIONS.txt` for unresolved choices and the normal-language reconstruction of each prior answer.