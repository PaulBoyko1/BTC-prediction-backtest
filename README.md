# BTC Prediction Backtest

A research workbench for testing whether BTC prediction markets, BTC market structure, and venue settlement references contain repeatable short-horizon statistical edges.

**Status:** v0.3 research foundation. The browser strategy/execution/portfolio engine, public read-only API adapters, Python/Polars high-frequency backend, credentialed settlement-reference hooks and automated validation are in the repository. The included browser backtest dataset is synthetic demo data; demo profits are not evidence of a real edge.

## Core workflow

1. Start from either **Prediction Markets** or **BTC**.
2. Once inside the strategy, freely combine prediction-market, BTC and settlement-reference factors.
3. Define the **trade target** separately: Kalshi/Polymarket, YES/NO, 5m/15m/1h.
4. Define entry/re-entry/exit behavior separately from the signal.
5. Compare Kalshi and Polymarket, ask/last/midpoint execution assumptions, parameter sweeps and advanced diagnostics.
6. For real high-frequency work, normalize raw source timestamps to Parquet and run the Python backend rather than processing years of raw events in the browser.

## Browser strategy factors

### Prediction market

- Contract price threshold / crossing
- Probability shock / probability velocity
- Order-book imbalance
- Kalshi ↔ Polymarket spread
- Time to expiry
- Strike / threshold geometry relative to BTC or round levels
- Prediction move unexplained by contemporaneous BTC

### BTC

- VWAP bullish/bearish/reversal/continuation/support/resistance/breakthrough setups
- EMA relationship / cross
- Yesterday high / low / close
- Prior-week average / high / low / close
- Momentum / return
- Realized volatility regime
- Round-number proximity
- BTC-move gate for lead/lag tests

### Settlement reference

- Settlement reference vs contract strike
- Settlement reference vs selected BTC spot/composite

Reference and exchange spot are deliberately separate fields.

## Execution model

Supported controls include:

- Kalshi / Polymarket
- YES / NO
- 5m / 15m / 1h
- One / limited / repeated entries with cooldown
- Hold to settlement
- Contract-price target
- Target + stop
- Time-based exit before expiry
- Entry/exit slippage and fee allowances

**Ask is the canonical fair-buy result.** Last-trade and midpoint variants are sensitivity checks. A strategy that works only at midpoint is not presented as executable.

## Portfolio model

- Starting capital
- Fixed-percent sizing
- Fractional Kelly for hold-to-expiry binary trades
- Kelly learns only from previously resolved trades
- Bayesian prior smoothing
- Maximum position / simultaneous exposure
- Capital reserved while positions remain open
- Compounding only from realized exits/settlements

Binary Kelly is intentionally not applied to arbitrary early-exit payoff distributions.

## Output / diagnostics

Browser reports include trade count, profit win rate, settlement-direction win rate, average all-in entry probability, historical settlement edge, ending capital, total return, CAGR, max drawdown, trade ledger, Kalshi/Polymarket paths, venue difference, parameter sweeps and advanced statistics including Brier/log loss/calibration/confidence interval/significance/expectancy/profit factor/Sortino/Calmar/streaks/VaR/CVaR.

## Python high-frequency backend

The heavy research layer uses **Python + Polars + DuckDB + Parquet**.

Install:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python -m pip install -e '.[dev]'
npm install
```

The first implemented high-frequency experiment is Test B:

> prediction probability changes by X over Y milliseconds while BTC itself moved no more than Z dollars over the same backward-looking period → measure subsequent BTC.

Standard labels are:

- 100ms
- 250ms
- 500ms
- 1s
- 2s
- 5s
- 10s
- 30s
- 1m
- 3m
- 5m
- expiry

Example:

```bash
python -m backend.cli lead-lag \
  --prediction data/normalized/kalshi_btc15m.parquet \
  --btc data/normalized/binance_btc.parquet \
  --lookback-ms 5000 \
  --shock-points 0.08 \
  --max-btc-move-usd 20 \
  --output data/cache/kalshi_lead_lag.parquet
```

Historical signal inputs use backward as-of joins. Forward prices are attached only as labels. The automated test suite mutates future BTC prices and verifies that selected historical signals cannot change.

See `backend/README.md`.

## Public data / API layer

Read-only acquisition exists for:

- Kalshi public REST market/trade/book/candle/history endpoints
- Polymarket Gamma / CLOB / Data API
- Binance public market-data-only BTC endpoints
- Coinbase public BTC-USD endpoints

`scripts/ingest.mjs` saves raw public responses locally. Raw/cache/normalized data files are git-ignored.

## Exact settlement references

### Kalshi / CF Benchmarks BRTI

CME confirms BRTI history is available back to November 2016 through its market-data channels. Raw history is licensed/entitled rather than an anonymous free archive. The repo includes a CME DataMine client for files already entitled to the configured API account.

BRTI publication frequency changed from 1 second to 200ms on May 18, 2026. Contract rules—not the maximum source publication frequency—still determine which observations are used for settlement.

Kalshi resolved-market metadata can still provide exact target/final/outcome information for outcome-only studies when raw intracontract BRTI is unavailable.

### Polymarket / Chainlink Data Streams

Polymarket BTC Up/Down markets must preserve the **actual per-contract resolution source**. In August 2026, 5-minute contracts have used both Chainlink BTC/USD 30-second and 60-second TWAP streams, so the app must not hard-code `5m = one TWAP rule`.

The repo uses the official `@chainlink/data-streams-sdk` for credentialed report retrieval/decoding. The official SDK's historical-page example documents a timestamp requirement within the last 30 days, so normal Data Streams credentials do **not** prove multi-year historical TWAP availability. Older exact oracle paths need an authorized archive/provider or must be marked unavailable.

Reference data quality labels:

- `exact_reference`
- `exact_outcome_only`
- `spot_proxy`

A `spot_proxy` must never be shown as the actual settlement source.

See `REFERENCE_DATA_RESEARCH.md` and `.env.example`.

## Real-history window policy

The UI layout supports 1y / 2y / 3y comparisons, but real short-duration prediction-market series may have less history. Production results must show actual first/last timestamps and sample counts and render unsupported windows as **N/A / insufficient history**. Missing prediction-market periods must never be padded with synthetic data or BTC-only history.

## Data integrity / validation rules

- Preserve raw source timestamps before aggregation.
- No future information in signals or sizing.
- No midpoint presented as executable unless maker fills are explicitly modeled.
- No silent substitution of Binance/Coinbase for BRTI/Chainlink.
- No silent mixing of market rule versions.
- Capital stays locked while positions are open.
- Large fill-assumption sensitivity is surfaced.
- Parameter discovery must be followed by walk-forward/out-of-sample validation.
- A strategy without a persistent edge should be rejected rather than rescued by aggressive sizing.

## Run browser UI locally

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

Repository validation:

```bash
npm run check
npm test
pytest -q
```

## Repository layout

- `index.html`, `styles.css` — browser UI shell/styles
- `src/app.js` — strategy composer/views
- `src/catalog.js` — factor definitions
- `src/backtest.js` — browser execution/portfolio/metrics/sweeps
- `src/mockData.js` — synthetic demo data
- `src/dataAdapters.js` — public API clients
- `reference.html`, `src/referenceLab.js` — settlement-reference UI
- `scripts/ingest.mjs` — public raw-data ingestion
- `scripts/chainlink-reference.mjs` — credentialed Chainlink Data Streams reader
- `backend/lead_lag.py` — high-frequency lead/lag engine
- `backend/reference_sources.py` — CME DataMine entitled-file client
- `backend/cli.py` — Python research CLI
- `backend/tests/` — anti-lookahead/runtime tests
- `DECISIONS.md` — approved architecture decisions
- `REFERENCE_DATA_RESEARCH.md` — exact reference-source findings
- `API_NOTES.md`, `DATA_SCHEMA.md`, `STATUS.md`, `QUESTIONS.txt` — data/method/project documentation
