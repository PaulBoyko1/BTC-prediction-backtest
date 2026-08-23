# API / Data Notes (verified 2026-08-23)

## Recommended first-party sources

### Kalshi — primary prediction-market source

Use Kalshi's Predictions REST API for market discovery, trades, candlesticks and current order books. The public trade examples are plain GET requests and support ticker + timestamp filters with cursor pagination. Kalshi also exposes dedicated historical endpoints for archived trades/markets/candlesticks.

For real-time lead/lag research, use Kalshi WebSocket channels for order-book updates, market ticker updates and public trades. The WebSocket connection itself requires API-key authentication even when subscribing to public market-data channels.

Important for BTC research: Kalshi also documents CF Benchmarks and Pyth value feeds, which can help align the prediction contract with the underlying reference/index used by the market.

### Polymarket — secondary prediction-market / discrepancy source

Use Polymarket market discovery + CLOB/data APIs for market metadata, order books, market activity and price history. Its prediction-market Market WebSocket is public and streams real-time order-book, price and lifecycle updates.

The comparison engine must only pair contracts after normalizing expiry, side, strike/threshold and resolution source. A price difference between superficially similar contracts is not automatically arbitrage.

### Binance — primary BTC microstructure reference

Use Binance Spot REST/WebSocket market data for BTC reference prices, aggregate trades, depth and klines. The current Spot REST API supports 1-second klines as well as 1m/5m/15m/etc. intervals, which is useful for coarse historical feature construction. For sub-second lead/lag tests, use raw/aggregate trade and depth event streams rather than candle bars.

### Coinbase — independent BTC cross-check

Use Coinbase Advanced Trade REST for market data and WebSocket for live prices/order book. It is useful as an independent U.S. venue so a strategy is not accidentally learning quirks of a single BTC exchange.

### Chainlink / settlement reference

Where a prediction contract resolves from Chainlink/TWAP or another oracle/index, ingest that settlement source separately. Backtests must be versioned by actual resolution rule; do not silently mix contracts whose oracle or rule changed.

## Historical-data architecture

Do not make the browser UI repeatedly pull years of tick/order-book history. The planned production path should be:

1. Download/API-ingest raw venue data.
2. Store immutable raw files by source/date.
3. Normalize into Parquet (preferred) or another columnar format.
4. Build derived feature tables (VWAP, EMA, prior-day/week levels, PM residuals, book imbalance, etc.).
5. Run the heavy backtest engine outside the rendering thread (Python/Polars/DuckDB or equivalent).
6. Send compact trade/equity/statistics results to the UI.

This matters because three years of second-level data is already ~95 million timestamps before adding order-book events; raw event data is much larger.

## First real-data ingestion order

1. Kalshi market metadata + trades + resolutions for BTC 15m / 5m / 1h families.
2. Binance BTCUSDT trades / 1s bars aligned in UTC.
3. Kalshi live/historical order-book data where obtainable at sufficient granularity.
4. Polymarket equivalent BTC markets for discrepancy / confirmation tests.
5. Coinbase BTC data as robustness cross-check.
6. Options data (Deribit/Binance where available) for digital probability / implied distribution comparisons.

## Critical backtest fields

Every normalized prediction-market observation should retain:

- venue
- event / market / contract identifiers
- exact timestamp and source timestamp precision
- YES/NO bid and ask (or enough book data to reconstruct them)
- last trade and taker direction when available
- size / depth
- expiry / settlement timestamp
- strike or comparison/reference price
- market horizon (5m / 15m / 1h / etc.)
- resolution source
- rule version
- final outcome

Every BTC observation should retain venue + timestamp + price and, when available, bid/ask, trade direction, quantity and depth.

## Execution default

For research that says a contract "hits 45¢", the recommended default is **first realistically executable ask at or below 45¢**, not midpoint or last trade. Maker simulation should be a separate execution mode because fill probability and adverse selection must be modeled.
