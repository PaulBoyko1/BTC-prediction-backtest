# Settlement Reference Data Research

Research checked 2026-08-23 against current first-party/official sources where available.

## Executive conclusion

Exact settlement-reference backtesting is feasible for some layers, but the two venues have different acquisition paths and **we must not assume multi-year oracle tick retention**:

- **Kalshi / CF Benchmarks BRTI:** exact historical BRTI exists back to November 2016 through CME market-data channels/DataMine, but it is licensed/entitled data rather than a zero-auth public archive.
- **Polymarket / Chainlink Data Streams:** Chainlink's official SDK supports latest, timestamped and paginated historical report retrieval with valid Data Streams credentials. However, the official historical-page SDK example explicitly warns that its requested timestamp must be **within the last 30 days**. Credentials therefore do **not** establish that a 1–3 year Chainlink Data Streams archive can be pulled from the normal API. Older exact TWAP history requires a separate archive/provider or must be treated as unavailable.

Outcome-only tests are easier than intracontract oracle-path tests: Kalshi/Polymarket resolved metadata can establish the actual settlement result even when raw oracle ticks are unavailable.

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

### Historical Chainlink access — important retention limit

Chainlink's official Data Streams TypeScript SDK supports:

- `listFeeds()`;
- `getLatestReport(feedId)`;
- `getReportByTimestamp(feedId, timestamp)`;
- `getReportsPage(feedId, startTime, limit?)`;
- `getReportsBulk(feedIds, timestamp)`;
- WebSocket real-time streaming.

It requires valid Chainlink Data Streams API credentials (`API_KEY` and `USER_SECRET`). Mainnet examples use:

- REST: `https://api.dataengine.chain.link`
- WebSocket: `wss://ws.dataengine.chain.link`

But the SDK's own `get-reports-page` example states: **"The timestamp must be within the last 30 days."** We should treat the standard Data Streams historical API as recent-history access unless Chainlink explicitly grants/ documents deeper retention for our account/product.

Official/maintained package information:

- https://www.npmjs.com/package/@chainlink/data-streams-sdk
- https://github.com/smartcontractkit/data-streams-sdk/tree/main/typescript
- https://github.com/smartcontractkit/data-streams-sdk/blob/main/typescript/examples/get-reports-page.ts
- https://chain.link/data-streams

The public Chainlink data pages are informational/delayed and direct users to request access for real-time reports.

### Consequence for older Polymarket reference-path tests

For historical periods outside whatever Data Streams retention our credentials actually provide, we need one of:

1. an official/authorized Chainlink archive with the exact TWAP stream;
2. a third-party archive that proves it captured the exact Chainlink reports and timestamps;
3. our own forward collection going forward.

If none exists, the reference-path test is **unavailable** for that period. Binance/Coinbase may still be shown as a `spot_proxy`, but never as the actual Chainlink resolution series.

### What we can still do without Chainlink history

For Polymarket outcome-only studies we can use Polymarket's own resolved result and market metadata.

For tests that explicitly depend on:

- reference-vs-spot divergence during the contract;
- TWAP trajectory before expiration;
- exact reference distance to the threshold;
- oracle-leading/oracle-lag behavior;

we should require the exact Chainlink historical stream or mark the test unavailable/proxy-only.

---

## 3. Real-history window policy

The UI has 1y / 2y / 3y comparison panels, but real short-duration prediction-market series may have much less than three years of existence/history.

Production behavior must be:

- show the requested window only when the underlying venue/series actually covers it;
- show **N/A / insufficient history** when it does not;
- always display the exact first/last timestamp and sample count used;
- never pad missing prediction-market history with synthetic data;
- never reinterpret a six-month series as a "1-year" result merely because BTC data goes back one year.

Third-party/open datasets already demonstrate Polymarket BTC 15m observations in March 2026, and public Kalshi discussion/pages demonstrate KXBTC15M activity by at least May 2026, but those observations do not establish the exact launch date. The ingestion job should determine actual first-available timestamps from the venue/archive and record them as metadata.

---

## 4. Practical data-quality tiers

### Tier A — exact reference path

Use exact venue settlement reference ticks/reports:

- Kalshi BRTI history.
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

## 5. Next engineering actions

1. Use Python/Polars/DuckDB for large Parquet datasets.
2. Backfill Kalshi BTC15m metadata/trades/results plus Binance/Coinbase first.
3. Add Polymarket contract metadata/trades while preserving each contract's resolution source verbatim.
4. Add derivatives/perp features: funding, basis, OI, liquidations, perp book imbalance.
5. Add credential slots/adapters for:
   - CME DataMine BRTI;
   - Chainlink Data Streams (recent history + forward capture).
6. Investigate an authorized long-history Chainlink archive separately; do not assume the standard SDK retains it.
7. Keep reference-specific charts/tests disabled when exact data is absent.
8. For first-stage edge discovery, use conservative executable/taker assumptions; only build queue-aware maker/L2 reconstruction for surviving strategies.
