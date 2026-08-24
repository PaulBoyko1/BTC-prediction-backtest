# Settlement Reference Data Research

Research checked 2026-08-23 against current first-party/official sources where available.

## Executive conclusion

Exact settlement-reference backtesting is feasible, but the two venues have different acquisition paths:

- **Kalshi / CF Benchmarks BRTI:** exact historical BRTI exists back to November 2016 through CME market-data channels/DataMine, but it is licensed/entitled data rather than a zero-auth public archive.
- **Polymarket / Chainlink Data Streams:** Chainlink's Data Streams SDK supports historical report retrieval by feed ID/timestamp and paginated historical access, but valid Data Streams credentials are required. Public Chainlink product pages show delayed informational data and direct users to request access for real-time reports.

This means neither exact source is a dead end. The project should support credentialed/licensed adapters rather than replacing them with exchange spot.

---

## 1. Kalshi — CF Benchmarks BRTI

### What Kalshi actually settles from

Current Kalshi BTC 15-minute market pages state that the price source is CF Benchmarks' BRTI. During the final minute before expiration, 60 RTI prices are collected and their simple average becomes the official final value, rounded to two decimals.

A useful property of Kalshi's resolved market pages is that they expose:

- the target / "To Beat" value;
- the final averaged BRTI value;
- the resolved YES/NO outcome;
- the exact market time window.

Therefore, for a simple hold-to-expiry outcome backtest, Kalshi's own resolved market metadata may be sufficient even before raw BRTI ticks are acquired. Raw BRTI is still required for strategies that use the reference path *before expiry* as an input signal.

### Historical BRTI availability

CME states that BRTI historical data is available back to the rate's inception in **November 2016** through its market-data channels. CME DataMine supports historical benchmark data and provides a REST API for entitled/purchased files.

Relevant official pages:

- https://www.cmegroup.com/education/bitcoin/frequently-asked-questions
- https://www.cmegroup.com/datamine.html
- https://www.cmegroup.com/datamine/datamine-api.html
- https://www.cmegroup.com/market-data/browse-data/cryptocurrency-data.html
- https://www.cfbenchmarks.com/data/indices/BRTI

CF Benchmarks separately states that real-time or historic BRTI access for a product/service requires contacting its licensing team.

### Important publication-frequency regime change

CME changed BRTI publication frequency on **May 18, 2026** from once per second to once per **200 milliseconds**.

Official notice:

- https://www.cmegroup.com/notices/electronic-trading/2026/05/20260518.html

The historical ingestion layer must preserve this regime change. However, a Kalshi contract's own settlement rule still controls which observations are sampled/averaged. Do not infer Kalshi's settlement sampling merely from the maximum publication frequency of BRTI.

### Recommended acquisition order

1. Backfill Kalshi contract metadata/resolved outcomes first.
2. Use Kalshi-resolved target/final values for exact settlement outcomes where available.
3. Acquire a CME DataMine historical BRTI trial/order or licensed third-party feed if we want pre-expiry BRTI-path signals.
4. Store raw BRTI timestamps at native resolution and only aggregate later.

---

## 2. Polymarket — Chainlink BTC/USD TWAP Data Streams

### What Polymarket actually settles from

Current Polymarket BTC Up/Down rules explicitly state that the market resolves from a Chainlink BTC/USD TWAP Data Stream rather than Coinbase, Binance or generic spot.

Examples of the official resolution-source URLs used by contracts include:

- `https://data.chain.link/streams/btc-usd-twap-30s-streams`
- `https://data.chain.link/streams/btc-usd-twap-60s-streams`

### Critical rule-version finding: do not hard-code horizon -> TWAP window

Polymarket's BTC 5-minute rule changed during August 2026.

Examples found:

- 5m contracts opened around Aug 7–10 referenced the **30-second** TWAP stream.
- 5m contracts opened around Aug 16–19 referenced the **60-second** TWAP stream.

Therefore the normalization schema must capture, per contract:

- full `resolutionSource` URL;
- parsed stream slug/feed ID when available;
- TWAP lookback/window;
- rule text/version/hash;
- contract open and expiry timestamps.

Never assume all 5m contracts use the same TWAP source. The same principle applies to future rule changes on 15m/1h/etc.

Official Polymarket examples:

- https://polymarket.com/event/btc-updown-5m-1786169700
- https://polymarket.com/event/btc-updown-5m-1786478700
- https://polymarket.com/event/btc-updown-5m-1786977900
- https://polymarket.com/event/btc-updown-5m-1787236500

### Historical Chainlink access

Chainlink's official Data Streams SDK/API supports:

- latest report retrieval;
- historical report retrieval for a feed at a timestamp;
- paginated historical report access;
- WebSocket real-time streaming.

It requires valid Chainlink Data Streams API credentials (`API_KEY` and user secret). Mainnet REST endpoint examples use `https://api.dataengine.chain.link`.

Official/maintained package information:

- https://www.npmjs.com/package/@chainlink/data-streams-sdk
- https://chain.link/data-streams
- https://data.chain.link/streams/btc-usd-cexprice-streams

The public Chainlink data pages are informational/delayed and direct users to request access for real-time reports. We should therefore implement a credentialed Data Streams adapter rather than expect anonymous historical downloads.

### What we can still do without Chainlink credentials

For Polymarket outcome-only studies we can use Polymarket's own resolved result and market metadata.

For tests that explicitly depend on:

- reference-vs-spot divergence during the contract;
- TWAP trajectory before expiration;
- exact reference distance to the threshold;
- oracle-leading/oracle-lag behavior;

we should require the exact Chainlink historical stream or mark the test unavailable/proxy-only.

---

## 3. Practical data-quality tiers

### Tier A — exact

Use exact venue settlement reference:

- Kalshi BRTI history / Kalshi-published final BRTI values.
- Chainlink Data Streams reports for the exact Polymarket resolution stream.

Allowed label: `exact_reference`.

### Tier B — exact outcome, no intracontract reference path

Use venue-resolved target/final/outcome metadata but no raw reference ticks.

Useful for entry-price -> settlement studies.

Allowed label: `exact_outcome_only`.

### Tier C — proxy diagnostic

Use Binance/Coinbase/composite BTC price solely to study correlation or approximate mechanics.

Allowed label: `spot_proxy`.

Tier C must never be presented as the actual settlement source.

---

## 4. Next engineering actions

1. Add a Python/Polars/DuckDB backend for large Parquet datasets.
2. Backfill Kalshi BTC15m metadata/trades/results plus Binance/Coinbase first.
3. Add Polymarket contract metadata/trades while preserving each contract's resolution source verbatim.
4. Add derivatives/perp features: funding, basis, OI, liquidations, perp book imbalance.
5. Add credential slots/adapters for:
   - CME DataMine BRTI;
   - Chainlink Data Streams.
6. Keep reference-specific charts/tests disabled when exact data is absent.
7. For first-stage edge discovery, use conservative executable/taker assumptions; only build queue-aware maker/L2 reconstruction for surviving strategies.
