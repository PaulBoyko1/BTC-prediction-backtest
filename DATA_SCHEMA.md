# Normalized Data Schema

This document defines the target data contract between raw ingestion and the strategy/backtest engine. It exists to prevent venue-specific response formats, settlement rules, or timestamp assumptions from leaking into strategy logic.

## Design rules

1. Preserve every original source timestamp.
2. Add a normalized UTC timestamp; do not replace the original.
3. Never substitute exchange spot for a venue settlement reference.
4. Keep market rule/resolution metadata versioned with the contract.
5. Store executable bid/ask separately from last trade and midpoint.
6. Derived features must record the lookback/window used.
7. Final outcome and settlement values are labels and may not be exposed to signal computation before settlement.

## `PredictionMarketContract`

One row per listed contract/version.

```text
venue                    Kalshi | Polymarket
market_id                venue market identifier
contract_id              unique normalized contract identifier
event_id                 parent event if applicable
market_family             BTC_UPDOWN | BTC_THRESHOLD | ...
horizon                   5m | 15m | 1h | daily | ...
side_definition           precise YES proposition
start_time_utc
expiry_time_utc
strike                    nullable
comparison_start_value    nullable
settlement_source         e.g. CF_BRTI | CHAINLINK_DATA_STREAM
settlement_rule_version   immutable rule/version hash or identifier
settlement_rule_text      archived rule text or source pointer
final_outcome_yes         label only
final_settlement_value    label only
```

## `PredictionMarketEvent`

Raw/normalized time-series observations.

```text
source_timestamp
source_timestamp_precision
normalized_timestamp_utc
venue
contract_id
event_type                quote | trade | book_delta | ticker | lifecycle

yes_bid
yes_ask
yes_mid
yes_last
no_bid
no_ask
no_mid
no_last

trade_side                nullable
trade_price               nullable
trade_size                nullable
best_bid_size             nullable
best_ask_size             nullable
book_depth_json            nullable/raw pointer
volume                     nullable
```

Do not infer an executable buy from midpoint. For a YES buy, ask is the conservative default. For a NO buy, use the executable NO ask or the correctly complementary YES-side quote according to venue microstructure.

## `BTCMarketEvent`

```text
source_timestamp
source_timestamp_precision
normalized_timestamp_utc
venue                     Binance | Coinbase | ...
instrument                 BTCUSDT | BTC-USD | ...
event_type                 trade | quote | depth
price
bid                        nullable
ask                        nullable
trade_side                 nullable
size                       nullable
book_depth_json            nullable/raw pointer
```

## `BTCBar`

Derived from raw market events for slower technical factors.

```text
bar_start_utc
bar_end_utc
venue_or_composite
timeframe                  1s | 1m | 5m | 15m | 1h | ...
open
high
low
close
volume
vwap
```

## `SettlementReferenceEvent`

Separate table because these values can differ from exchange spot.

```text
source_timestamp
normalized_timestamp_utc
reference_source           CF_BRTI | CHAINLINK_DATA_STREAM | ...
contract_id_or_rule_scope
reference_price
source_precision
is_exact_source            true/false
provenance                 archive/API/source identifier
```

If `is_exact_source=false`, the value may be used only as a diagnostic/proxy and must never be labeled as the actual settlement reference.

## `DerivedFeatureEvent`

Features should be reproducible and explicit about their windows.

Examples:

```text
normalized_timestamp_utc
contract_id
feature_name
feature_value
lookback_ms                nullable
parameters_json
source_set_json
```

Examples of `feature_name`:

- `kalshi_probability_delta`
- `kalshi_probability_velocity`
- `polymarket_probability_delta`
- `pm_book_imbalance_5_levels`
- `btc_return`
- `btc_move_dollars`
- `btc_realized_vol`
- `vwap_distance_pct`
- `ema_fast_minus_slow`
- `reference_minus_spot`
- `reference_minus_strike`
- `prediction_residual_vs_btc`

## Exact-lookback computation

The production feature engine must honor the configured lookback exactly.

Example:

> Kalshi YES rises at least 8 points in 5 seconds while BTC moves no more than $20 in 5 seconds.

At signal time `t`:

```text
kalshi_delta_5s = kalshi_price(t) - kalshi_price(as-of t-5s)
btc_move_5s     = btc_price(t) - btc_price(as-of t-5s)
```

“As-of” lookup must use the latest observation available at or before the requested timestamp. It must not look forward to the next observation.

## Lead/lag output table

For the central Kalshi/Polymarket → BTC hypothesis, each signal event should generate forward-return labels separately from trading simulation:

```text
signal_timestamp_utc
signal_definition_id
contract_id
prediction_venue
prediction_move
btc_move_pre_signal
btc_price_at_signal
btc_return_100ms
btc_return_250ms
btc_return_500ms
btc_return_1s
btc_return_2s
btc_return_5s
btc_return_10s
btc_return_30s
btc_return_1m
btc_return_3m
btc_return_5m
contract_outcome_yes
```

Forward returns are labels and must never be used to decide whether the signal fired.

## Cross-venue matching table

Kalshi/Polymarket discrepancy studies require an explicit match record:

```text
match_id
kalshi_contract_id
polymarket_contract_id
match_quality_score
same_economic_proposition
same_or_equivalent_threshold
expiry_difference_ms
settlement_source_same
rule_difference_notes
valid_for_price_discrepancy_analysis
valid_for_true_arbitrage_analysis
```

A pair can be valid for information-discovery analysis even when it is not valid for risk-free arbitrage.

## Rule-change boundaries

Do not pool contracts across a material settlement-rule change without a regime field. At minimum, analyses should be able to group by:

- venue
- market family
- settlement source
- rule version
- fee regime
- liquidity regime

## Backtest output schema

Each simulated trade should retain:

```text
strategy_definition_id
signal_timestamp
entry_timestamp
exit_timestamp
venue
contract_id
side
entry_observation_type    ask | last | midpoint | maker_model
entry_price_raw
entry_slippage
entry_fee
entry_price_all_in
shares
capital_allocated
exit_reason               expiry | target | stop | time
exit_price_raw
exit_slippage
exit_fee
pnl
portfolio_equity_before
portfolio_equity_after
settlement_outcome_yes
settlement_reference_value
```

This is necessary so a result can be audited rather than represented only by an equity curve.

## Storage recommendation

- Raw events: immutable compressed files partitioned by source/date.
- Normalized events: Parquet partitioned by venue/date/market family.
- Query/backtest: DuckDB / Polars / Python or equivalent columnar engine.
- Browser: receives compact strategy results, not hundreds of millions of raw events.
