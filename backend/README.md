# Python Research Backend

This directory contains the heavy historical-research layer for the BTC prediction-market project. The browser UI remains the strategy composer and visualization surface; Python/Polars/DuckDB/Parquet handle large event datasets.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python -m pip install -e '.[dev]'
```

JavaScript dependencies, including the official Chainlink Data Streams SDK:

```bash
npm install
```

## Core Test B

The first high-frequency lead/lag test is:

1. Prediction-market probability changes by at least `X` over lookback `Y`.
2. BTC moves by no more than `Z` dollars over the same backward-looking window.
3. The event becomes a signal.
4. Measure BTC after 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s, 1m, 3m, 5m and expiry.

Example:

```bash
python -m backend.cli lead-lag \
  --prediction data/normalized/kalshi_btc15m.parquet \
  --btc data/normalized/binance_btc.parquet \
  --lookback-ms 5000 \
  --shock-points 0.08 \
  --max-btc-move-usd 20 \
  --direction either \
  --max-feature-staleness-ms 250 \
  --max-forward-delay-ms 100 \
  --output data/cache/kalshi_lead_lag.parquet
```

The engine uses backward `join_asof` operations for historical features and forward `join_asof` operations only for labels. The test suite explicitly changes future BTC prices and verifies that selected signals do not change.

### Timing-quality controls

A nominal horizon is not enough for high-frequency research. If the requested `100ms` target has no BTC observation until 600ms later, that must not silently be called a 100ms return.

The event output therefore records:

- `pm_effective_lookback_ms` — actual age between signal and matched prediction observation;
- `pm_lag_staleness_ms` — how far before the exact lookback target the prediction match occurred;
- `btc_now_age_ms` — age of the BTC observation used at signal time;
- `btc_lag_age_ms` — age of the BTC observation used at the backward lookback target;
- `btc_future_<horizon>_delay_ms` — how late the actual BTC label arrives after the requested forward target;
- `btc_expiry_delay_ms` — same concept for expiry.

`--max-feature-staleness-ms` rejects signals whose backward as-of matches are older than the chosen tolerance. `--max-forward-delay-ms` keeps the signal but nulls a future label whose observation arrives too late. Summaries report both `qualifying_signals` and the number of valid labeled `signals` per horizon.

Choose tolerances based on the native data frequency and hypothesis. A tolerance appropriate for a 5-minute technical study may be completely unacceptable for a 100ms lead/lag claim.

## Minimum normalized inputs

Prediction-market Parquet:

- `timestamp_ns` — UTC Unix nanoseconds.
- `contract_id`.
- `yes_mid` — or another probability column selected through CLI/config.
- `expiry_ns` — optional but required for expiry-return labels.

BTC Parquet:

- `timestamp_ns` — UTC Unix nanoseconds.
- `price`.

Keep Binance, Coinbase and any composite as distinct datasets or explicitly identified columns. Do not create an unnamed blended price.

Rows with invalid prediction probabilities outside `[0,1]`, missing required timestamps/probabilities, or nonpositive BTC prices are rejected before signal generation.

## Exact settlement-reference sources

### CME DataMine / BRTI

CME DataMine requires an API ID/password entitled to the files being requested. Put credentials in a local `.env`/environment, never in Git:

```text
CME_DATAMINE_API_ID=...
CME_DATAMINE_API_PASSWORD=...
```

List entitled files:

```bash
python -m backend.cli cme-list --limit 100
```

Download an entitled file after obtaining its DataMine file ID:

```bash
python -m backend.cli cme-download \
  --file-id <FID> \
  --output data/raw/cme/brti-file.dat
```

The code does not purchase data and does not bypass CME entitlements.

### Chainlink Data Streams

Set credentials granted by Chainlink:

```text
CHAINLINK_API_KEY=...
CHAINLINK_USER_SECRET=...
```

Then inspect feeds/reports with:

```bash
npm run chainlink:reference -- feeds BTC
npm run chainlink:reference -- latest <feedId> data/raw/chainlink/latest.json
npm run chainlink:reference -- page <feedId> <startUnixSeconds> 100 data/raw/chainlink/page.json
```

The official SDK's historical-page example documents a last-30-days timestamp constraint. Do **not** assume the normal Data Streams API provides 1–3 years of historical TWAP reports. Older exact Polymarket reference-path tests require an authorized archive; a reconstructed Binance/Coinbase TWAP may be used only as a clearly labeled proxy/calibration series.

## Data-quality labels

Every reference-based result should use one of these labels:

- `exact_reference` — exact BRTI/Chainlink path is available.
- `exact_outcome_only` — exact venue outcome/final settlement known, but intracontract oracle path unavailable.
- `spot_proxy` — Binance/Coinbase/composite/reconstructed TWAP used only as a diagnostic proxy.

A `spot_proxy` must never be displayed as the contract's actual resolution source.

## Real-history coverage

The UI may request 1y / 2y / 3y comparisons, but a short-duration prediction series may have less history than that. Production reports must show the actual first/last timestamp and sample size and render unavailable windows as `N/A`; missing prediction-market history must never be padded with synthetic rows.
