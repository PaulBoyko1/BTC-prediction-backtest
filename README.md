# BTC Prediction Backtest

A research workbench for testing whether BTC prediction markets, BTC market structure, and venue settlement references contain repeatable short-horizon statistical edges.

**Status:** v0.2 foundation. The strategy/execution/portfolio engine and public read-only API adapters are in the repository. The included backtest dataset is synthetic demo data; real multi-year historical ingestion is the next data-engineering phase. Demo profits are not evidence of a real edge.

## Core workflow

1. Start from either **Prediction Markets** or **BTC**.
2. Once inside the strategy, freely combine factors from all three families:
   - Prediction-market factors
   - BTC factors
   - Settlement-reference factors
3. Define the **trade target** separately:
   - Kalshi or Polymarket
   - YES or NO
   - 5m / 15m / 1h
4. Define **entry/re-entry/exit** behavior separately from the signal.
5. Run one test to generate:
   - 1-year Kalshi result
   - 1-year Polymarket result
   - 1-year venue-equity difference
   - the same three views for 2 years
   - the same three views for 3 years
   - ask / last-trade / midpoint execution variants
6. Inspect edge, robustness, advanced diagnostics, trades, and parameter sweeps.

## Signal factors currently exposed

### Prediction market

- Contract price threshold / crossing
- Probability shock
- Probability velocity
- Order-book imbalance
- Kalshi ↔ Polymarket spread
- Time to expiry
- Strike / threshold geometry relative to BTC or nearest round level
- Prediction move unexplained by contemporaneous BTC

### BTC

- VWAP setups:
  - Bullish bias
  - Bearish bias
  - Reversal up/down
  - Continuation up/down
  - Support hold
  - Resistance hold
  - Breakthrough up/down
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

The reference family exists because prediction-market resolution prices are not automatically the same thing as Binance or Coinbase spot.

## Execution model

The trade target and execution logic are independent of the signal factors.

Supported controls include:

- Primary venue: Kalshi / Polymarket
- Side: YES / NO
- Horizon: 5m / 15m / 1h
- One entry per contract
- Limited multiple entries
- Repeated entries with cooldown
- Hold to settlement
- Exit at contract-price target (for example enter around 45¢, exit around 55¢)
- Target + stop
- Time-based exit before expiry
- Entry and exit slippage allowances
- Entry and exit fee allowances

### Fill assumptions

**Ask is the canonical fair-buy result.** Every full run also calculates last-trade and midpoint variants automatically. The UI highlights large divergence because a strategy that works only at midpoint may not be executable.

For ask-mode early exits, the engine uses the sell-side executable quote rather than pretending the position can exit at the ask.

## Portfolio model

- Starting capital
- Fixed-percent sizing
- Fractional Kelly for hold-to-expiry binary trades
- Kelly uses only previously resolved trades (no future leakage)
- Bayesian prior smoothing for empirical Kelly probabilities
- Maximum position size
- Maximum simultaneous exposure
- Capital remains reserved while contracts are open
- Compounding occurs only from actually realized exits/settlements

Binary Kelly is intentionally not applied to arbitrary early-exit payoff distributions. Early-exit tests fall back to fixed-percent sizing unless a later payoff-specific sizing model is implemented.

All caps are research parameters, not recommendations. The objective is to determine whether an edge survives sensible/conservative assumptions—not to make an edge-less strategy survive through position sizing.

## Output / diagnostics

Default output includes:

- Trade count
- Profit win rate
- Settlement-direction win rate
- Average all-in entry probability
- Historical probability edge = settlement win rate − average entry price
- Ending capital
- Total return
- CAGR
- Maximum drawdown
- Trade-return Sharpe-like diagnostic
- Trade ledger
- 1y / 2y / 3y separate portfolio charts
- Kalshi / Polymarket separate charts
- Kalshi − Polymarket difference chart

Advanced diagnostics include:

- Brier score
- Log loss
- Calibration error
- Wilson 95% interval for win rate
- Approximate significance test vs average entry probability
- Expectancy
- Profit factor
- Sortino-like ratio
- Calmar ratio
- Longest win/loss streaks
- Trade VaR / CVaR
- Digital-option `N(d2)` probability reference in the engine

Each advanced statistic has a plain-English explanation in the UI.

## Parameter sweep

Any numeric field on a selected factor can be swept across a range. Example:

- Contract entry threshold: 0.30 → 0.70
- Step: 0.01 or 0.05
- Venue: Kalshi or Polymarket
- Window: 1y / 2y / 3y

The output shows trades, settlement win rate, observed edge, total return and drawdown for each point. Historical best points should not be treated as validated without out-of-sample testing.

## Lead/lag test B

A central intended use is testing conditions such as:

> Kalshi 15m probability rises X points over Y seconds while BTC has moved no more than Z dollars, then measure future BTC returns and/or enter a prediction contract.

The production data pipeline should preserve raw event timestamps first, then compute forward BTC returns at horizons such as 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s, 1m and 5m. Aggregation can happen afterward.

## Cross-venue discrepancy tab

Kalshi ↔ Polymarket comparison is separated from the normal strategy builder. Before a spread is considered meaningful, contracts must be normalized for:

- Economic wording
- Side
- Threshold
- Expiry
- Timestamp
- Settlement source
- Fees
- Market microstructure

A price difference is not automatically arbitrage when the contracts resolve from different reference mechanisms.

## Data / API layer

`src/dataAdapters.js` currently contains read-only public adapters for:

- Kalshi REST market data / historical endpoints
- Polymarket Gamma / CLOB / Data API
- Binance BTCUSDT public market data
- Coinbase BTC-USD public Exchange market data

It also records current WebSocket endpoints. The UI includes a GET-only connection test.

**Connected adapter does not mean multi-year history is already downloaded.** Three years of raw event data should be ingested/cached outside the browser and normalized before backtesting.

See `API_NOTES.md` and `DATA_SCHEMA.md`.

## Settlement references

Current market rules must be stored with the data because they can change over time.

- Current Kalshi BTC 15m contracts use the CF Benchmarks BRTI final-minute mechanism described in their market rules.
- Current Polymarket BTC Up/Down pages identify Chainlink BTC/USD Data Streams as their resolution source.

The app therefore keeps:

- Binance price
- Coinbase price
- composite BTC price
- Kalshi settlement-reference price
- Polymarket settlement-reference price

as separate fields.

If exact historical reference ticks are unavailable, the app must say so instead of substituting ordinary BTC spot and labeling it as the settlement reference.

## Run locally

No application dependency install is required to serve the UI:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

Node is used only for repository validation:

```bash
npm run check
npm test
```

## Repository layout

- `index.html` — browser shell
- `styles.css` — UI
- `src/app.js` — views, state and strategy composer
- `src/catalog.js` — factor definitions and defaults
- `src/backtest.js` — execution, portfolio simulation, metrics and sweeps
- `src/mockData.js` — deterministic synthetic demo dataset
- `src/dataAdapters.js` — public read-only API clients
- `tests/smoke.mjs` — deterministic runtime smoke tests
- `.github/workflows/validate.yml` — syntax/runtime validation workflow
- `API_NOTES.md` — current data-source notes
- `DATA_SCHEMA.md` — normalized real-data contract
- `QUESTIONS.txt` — remaining open design/data decisions

## Non-negotiable backtest rules

- No future information in signals or sizing.
- No midpoint execution presented as executable unless explicitly modeled as a maker fill.
- No silent substitution of exchange spot for a settlement reference.
- No silent mixing of incompatible market rule versions.
- Capital stays locked while positions are open.
- Large fill-assumption sensitivity is surfaced rather than hidden.
- Discovery results must eventually be validated out of sample / walk-forward.
- A strategy without a persistent edge should be rejected rather than rescued with aggressive sizing.
