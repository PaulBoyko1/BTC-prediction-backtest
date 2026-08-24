# Approved Research Decisions

Confirmed on 2026-08-23.

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
   - Only spend substantial effort on historical L2 reconstruction, partial fills, queue position and maker-fill simulation for strategies that survive the first-stage tests.

6. **Settlement-reference integrity**
   - Never silently substitute Binance/Coinbase/composite spot for CF Benchmarks BRTI or Chainlink Data Streams.
   - If exact reference history is unavailable, exclude reference-specific historical tests or label them as proxy diagnostics.
   - Continue research/acquisition of exact BRTI and Chainlink historical data.

7. **Validation standard**
   - An attractive historical equity curve is not enough.
   - Require realistic execution, sample-size reporting, multi-window stability, regime analysis and walk-forward/out-of-sample validation before calling a result an edge.
