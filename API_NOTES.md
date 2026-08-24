# API / Data Notes

Verified against current first-party documentation on 2026-08-23.

## Principle

The strategy engine consumes a normalized data model. Venue APIs and historical archives are acquisition sources, not strategy logic. This keeps the same signal definitions testable across Kalshi, Polymarket, Binance, Coinbase, and exact settlement-reference feeds.

## Kalshi

### REST

Recommended production root:

`https://external-api.kalshi.com/trade-api/v2`

Public market-data endpoints can be used without authentication. The repository adapter currently includes:

- Market listing / metadata
- Market lookup
- Public trades with time filters and cursor pagination
- Current order book
- Market candlesticks
- Historical cutoff lookup
- Historical market candlestick path

Kalshi exposes dedicated historical endpoints for data before its historical cutoff. The ingestion process must inspect the cutoff and route requests correctly rather than assuming one endpoint covers every date.

### WebSocket

Recommended production endpoint:

`wss://external-api-ws.kalshi.com/trade-api/ws/v2`

Kalshi requires API-key authentication to establish the WebSocket connection, including for public market-data channels. Public REST market data does not require that authentication.

Useful real-time channels include public trades/ticker and order-book updates. These are important for the Kalshi-leads-BTC test because candle data cannot establish sub-second ordering.

### BTC 15-minute settlement reference

Current BTC 15-minute market rules describe the **CF Benchmarks Bitcoin Real-Time Index (BRTI)**. The current rule examples collect 60 RTI observations, one per second during the final minute, and use the simple average for settlement comparison.

Therefore a Kalshi BTC15m backtest should preserve at least:

- market rule version
- comparison/start value
- strike/reference value as applicable
- expiry window
- exact BRTI observations or a verified reconstruction source
- final settlement value

Do **not** label Binance/Coinbase spot as BRTI.

Historical BRTI tick availability/licensing still needs to be resolved before the app can claim exact reference-price backtests for every historical Kalshi contract. Until then, exchange spot is a separate diagnostic only.

## Polymarket

### Market metadata / discovery

Gamma API:

`https://gamma-api.polymarket.com`

The market metadata layer is useful for condition IDs, token IDs, market dates, active/closed status, and resolution metadata.

### CLOB data

CLOB API:

`https://clob.polymarket.com`

The repository adapter currently includes:

- Price history
- Current order book
- Midpoint

The public market WebSocket endpoint is recorded for later live/order-book ingestion.

### Trade history

Data API:

`https://data-api.polymarket.com`

The repository adapter includes market/condition-scoped trades with timestamp filtering. Market/event-scoped historical queries can cover long windows, but pagination/limits still need to be handled in the production ingestion job.

### BTC Up/Down settlement reference

Current BTC Up/Down market pages identify **Chainlink BTC/USD Data Streams** as the resolution source and explicitly distinguish that source from ordinary exchange spot.

Therefore Polymarket rows keep a distinct `polyReferencePrice` field. An exact historical reference backtest should use the Chainlink stream that matches the market rule. If an authorized historical stream/archive is unavailable, the UI should mark the reference series unavailable rather than silently substituting Coinbase, Binance, or a composite.

## Binance

Public spot root currently used by the adapter:

`https://api.binance.com/api/v3`

Adapter coverage:

- BTCUSDT ticker
- Klines
- Aggregate trades
- Current depth

For lead/lag research, aggregate/raw trades and depth events are more useful than 1-minute/5-minute candles. Candle bars are appropriate for VWAP/EMA/prior-period feature construction, not for proving a 200ms–2s lead.

## Coinbase

The repository uses the public Coinbase Exchange market-data surface for simple unauthenticated BTC-USD acquisition:

`https://api.exchange.coinbase.com`

Adapter coverage:

- BTC-USD ticker
- Historical candles
- Public trades
- Order book

Coinbase is primarily a robustness cross-check against Binance and can also participate in a configurable composite BTC price.

## BTC source modes

The UI currently supports:

- Composite (Binance + Coinbase) — default research view
- Binance
- Coinbase

In production, the composite definition must be explicit. A simple average is acceptable only as a diagnostic; a serious composite should define timestamp matching, stale-quote handling, and possibly weighting.

## Why raw timestamps are the preferred acquisition target

Raw timestamps preserve the ordering supplied by each venue. If Kalshi moves at 12:00:00.240 and Binance moves at 12:00:00.610, a 1-second bucket makes both events look simultaneous.

Preferred workflow:

1. Preserve original source timestamp and precision.
2. Convert to a common UTC representation without discarding the source timestamp.
3. Correct/measure clock alignment when possible.
4. Derive 100ms / 250ms / 500ms / 1s / 5s / 1m buckets afterward.

You can aggregate high-resolution data later. You cannot recover lost ordering from pre-aggregated bars.

## Historical-data architecture

Three years of second-level observations is already roughly 95 million timestamps before trade/order-book events. Raw event data is substantially larger.

Production path:

1. API/archive ingestion
2. Immutable raw files by source/date
3. Normalization into Parquet or another columnar format
4. Feature generation
5. DuckDB/Polars/Python or equivalent heavy backtest processing
6. Compact results returned to the browser UI

The browser should not repeatedly download and process multi-year raw tick history.

## Required normalized prediction fields

At minimum:

- source timestamp
- normalized UTC timestamp
- venue
- market/event/contract IDs
- market family/horizon
- YES bid / ask / midpoint / last trade
- NO prices or enough information to reconstruct executable complements
- trade size/direction where available
- order-book depth/imbalance where available
- contract start/expiry
- strike/comparison value
- settlement source
- rule/version identifier
- final outcome
- final settlement value

## Required normalized BTC fields

At minimum:

- source timestamp
- normalized UTC timestamp
- venue
- spot price
- bid / ask where available
- trade price/size/direction where available
- order-book depth where available

Derived bars/features can then add VWAP, EMA, returns, realized volatility, prior-day/week levels, round-level distance, and lead/lag features.

## Feature lookback requirement

Factors such as “Kalshi +8¢ in 5 seconds” or “BTC moved less than $20 in 5 seconds” must eventually be computed from timestamp-indexed history for the exact configured lookback. The current synthetic demo stores representative derived values so UI/execution behavior can be exercised; it is not the production feature engine.

## Fee / execution history

Real backtests should eventually version fees by venue and date. The UI currently exposes explicit entry/exit fee and slippage allowances so conservative sensitivity testing can begin before a full historical fee schedule is encoded.

Order-book-depth and maker-fill simulation should be added only where historical depth is actually available; midpoint must never be treated as a guaranteed fill.

## Current adapter status

Connected in source code:

- Kalshi public REST
- Polymarket Gamma / CLOB / Data API
- Binance public REST
- Coinbase public Exchange REST
- current WebSocket endpoint constants

Not yet completed:

- multi-year local historical backfill/cache
- authenticated Kalshi WebSocket signer
- live stream normalization
- exact historical CF Benchmarks BRTI tick archive
- exact historical Chainlink Data Streams archive
- historical fee schedules
- historical L2 reconstruction

This distinction is intentional: an API client existing in code is not the same thing as having a complete, correctly normalized 1–3 year dataset.
