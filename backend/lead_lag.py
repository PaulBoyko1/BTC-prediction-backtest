"""Lead/lag research primitives for prediction-market -> BTC tests.

The core Test-B hypothesis is:

    prediction market reprices by X over Y milliseconds
    while BTC itself moved no more than Z dollars over the same lookback
    -> measure BTC forward returns from 100 ms through 5 minutes / expiry.

All joins are *as-of* joins.  Historical features use backward-only joins and
forward labels use forward-only joins, which makes the lookahead boundary
explicit and auditable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

import polars as pl

from .config import (
    DEFAULT_MAX_BTC_MOVE_USD,
    DEFAULT_PREDICTION_SHOCK_LOOKBACK_MS,
    DEFAULT_PREDICTION_SHOCK_POINTS,
    FORWARD_HORIZONS_MS,
    FORWARD_HORIZON_LABELS,
)

Direction = Literal["up", "down", "either"]


@dataclass(frozen=True)
class LeadLagConfig:
    lookback_ms: int = DEFAULT_PREDICTION_SHOCK_LOOKBACK_MS
    shock_points: float = DEFAULT_PREDICTION_SHOCK_POINTS
    max_btc_move_usd: float = DEFAULT_MAX_BTC_MOVE_USD
    direction: Direction = "either"
    horizons_ms: tuple[int, ...] = FORWARD_HORIZONS_MS
    probability_col: str = "yes_mid"
    timestamp_col: str = "timestamp_ns"
    contract_col: str = "contract_id"
    btc_price_col: str = "price"
    expiry_col: str = "expiry_ns"


def _require_columns(frame: pl.DataFrame, columns: Iterable[str], label: str) -> None:
    missing = [name for name in columns if name not in frame.columns]
    if missing:
        raise ValueError(f"{label} is missing required columns: {', '.join(missing)}")


def _validate_config(config: LeadLagConfig) -> None:
    if config.lookback_ms <= 0:
        raise ValueError("lookback_ms must be > 0")
    if not 0 < config.shock_points < 1:
        raise ValueError("shock_points must be between 0 and 1 (probability units)")
    if config.max_btc_move_usd < 0:
        raise ValueError("max_btc_move_usd must be >= 0")
    if config.direction not in {"up", "down", "either"}:
        raise ValueError("direction must be up, down, or either")
    if any(h <= 0 for h in config.horizons_ms):
        raise ValueError("all forward horizons must be > 0")


def _prediction_lag_features(
    prediction: pl.DataFrame,
    *,
    config: LeadLagConfig,
) -> pl.DataFrame:
    """Attach the last prediction observation at/before t-lookback.

    The `by=contract_id` boundary prevents a lookback from leaking across
    adjacent contracts.
    """

    ts = config.timestamp_col
    contract = config.contract_col
    probability = config.probability_col
    lookback_ns = int(config.lookback_ms * 1_000_000)

    left = (
        prediction
        .with_columns((pl.col(ts) - lookback_ns).alias("_lookback_ns"))
        .sort([contract, "_lookback_ns"])
    )

    right = (
        prediction
        .select(
            pl.col(contract),
            pl.col(ts).alias("pm_lag_timestamp_ns"),
            pl.col(probability).alias("pm_lag_probability"),
        )
        .sort([contract, "pm_lag_timestamp_ns"])
    )

    return (
        left.join_asof(
            right,
            left_on="_lookback_ns",
            right_on="pm_lag_timestamp_ns",
            by=contract,
            strategy="backward",
        )
        .with_columns(
            (pl.col(probability) - pl.col("pm_lag_probability")).alias("pm_change"),
            ((pl.col(ts) - pl.col("pm_lag_timestamp_ns")) / 1_000_000).alias(
                "pm_effective_lookback_ms"
            ),
        )
    )


def _btc_lag_features(
    signals: pl.DataFrame,
    btc: pl.DataFrame,
    *,
    config: LeadLagConfig,
) -> pl.DataFrame:
    """Attach BTC at/before t-lookback and BTC at/before signal time."""

    ts = config.timestamp_col
    btc_price = config.btc_price_col

    btc_right = (
        btc.select(
            pl.col(ts).alias("btc_timestamp_ns"),
            pl.col(btc_price).alias("btc_price"),
        )
        .sort("btc_timestamp_ns")
    )

    with_now = (
        signals.sort(ts)
        .join_asof(
            btc_right,
            left_on=ts,
            right_on="btc_timestamp_ns",
            strategy="backward",
        )
    )

    btc_lag = (
        btc.select(
            pl.col(ts).alias("btc_lag_timestamp_ns"),
            pl.col(btc_price).alias("btc_lag_price"),
        )
        .sort("btc_lag_timestamp_ns")
    )

    return (
        with_now.sort("_lookback_ns")
        .join_asof(
            btc_lag,
            left_on="_lookback_ns",
            right_on="btc_lag_timestamp_ns",
            strategy="backward",
        )
        .with_columns(
            (pl.col("btc_price") - pl.col("btc_lag_price")).alias(
                "btc_lookback_move_usd"
            ),
            (
                (pl.col("btc_price") / pl.col("btc_lag_price") - 1.0) * 10_000
            ).alias("btc_lookback_return_bps"),
        )
        .sort(ts)
    )


def _signal_expression(config: LeadLagConfig) -> pl.Expr:
    if config.direction == "up":
        prediction_condition = pl.col("pm_change") >= config.shock_points
    elif config.direction == "down":
        prediction_condition = pl.col("pm_change") <= -config.shock_points
    else:
        prediction_condition = pl.col("pm_change").abs() >= config.shock_points

    return (
        prediction_condition
        & (pl.col("btc_lookback_move_usd").abs() <= config.max_btc_move_usd)
        & pl.col("pm_lag_probability").is_not_null()
        & pl.col("btc_lag_price").is_not_null()
        & pl.col("btc_price").is_not_null()
    )


def _attach_forward_btc(
    signals: pl.DataFrame,
    btc: pl.DataFrame,
    *,
    config: LeadLagConfig,
    horizon_ms: int,
) -> pl.DataFrame:
    ts = config.timestamp_col
    btc_price = config.btc_price_col
    label = FORWARD_HORIZON_LABELS.get(horizon_ms, f"{horizon_ms}ms")
    target_col = f"_target_{horizon_ms}_ns"
    future_ts_col = f"btc_future_{label}_timestamp_ns"
    future_px_col = f"btc_future_{label}_price"

    right = (
        btc.select(
            pl.col(ts).alias(future_ts_col),
            pl.col(btc_price).alias(future_px_col),
        )
        .sort(future_ts_col)
    )

    return (
        signals
        .with_columns((pl.col(ts) + horizon_ms * 1_000_000).alias(target_col))
        .sort(target_col)
        .join_asof(
            right,
            left_on=target_col,
            right_on=future_ts_col,
            strategy="forward",
        )
        .with_columns(
            (pl.col(future_px_col) - pl.col("btc_price")).alias(
                f"btc_move_{label}_usd"
            ),
            (
                (pl.col(future_px_col) / pl.col("btc_price") - 1.0) * 10_000
            ).alias(f"btc_return_{label}_bps"),
            (
                (pl.col(future_px_col) - pl.col("btc_price"))
                * pl.col("pm_change").sign()
            ).alias(f"directional_move_{label}_usd"),
        )
        .drop(target_col)
        .sort(ts)
    )


def _attach_expiry_btc(
    signals: pl.DataFrame,
    btc: pl.DataFrame,
    *,
    config: LeadLagConfig,
) -> pl.DataFrame:
    if config.expiry_col not in signals.columns:
        return signals

    btc_right = (
        btc.select(
            pl.col(config.timestamp_col).alias("btc_expiry_timestamp_ns"),
            pl.col(config.btc_price_col).alias("btc_expiry_price"),
        )
        .sort("btc_expiry_timestamp_ns")
    )

    return (
        signals.sort(config.expiry_col)
        .join_asof(
            btc_right,
            left_on=config.expiry_col,
            right_on="btc_expiry_timestamp_ns",
            strategy="forward",
        )
        .with_columns(
            (pl.col("btc_expiry_price") - pl.col("btc_price")).alias(
                "btc_move_expiry_usd"
            ),
            (
                (pl.col("btc_expiry_price") / pl.col("btc_price") - 1.0) * 10_000
            ).alias("btc_return_expiry_bps"),
            (
                (pl.col("btc_expiry_price") - pl.col("btc_price"))
                * pl.col("pm_change").sign()
            ).alias("directional_move_expiry_usd"),
        )
        .sort(config.timestamp_col)
    )


def build_lead_lag_events(
    prediction: pl.DataFrame,
    btc: pl.DataFrame,
    config: LeadLagConfig | None = None,
) -> pl.DataFrame:
    """Return qualifying prediction shocks with future BTC labels.

    Required prediction columns:
      timestamp_ns, contract_id, yes_mid (configurable), and optionally expiry_ns.

    Required BTC columns:
      timestamp_ns, price.

    `timestamp_ns` must be UTC Unix nanoseconds.  The BTC input should already
    represent the chosen source (Binance, Coinbase, or a deliberately constructed
    composite) rather than mixing venues implicitly.
    """

    config = config or LeadLagConfig()
    _validate_config(config)

    _require_columns(
        prediction,
        [config.timestamp_col, config.contract_col, config.probability_col],
        "prediction frame",
    )
    _require_columns(
        btc,
        [config.timestamp_col, config.btc_price_col],
        "BTC frame",
    )

    pred = prediction.with_columns(
        pl.col(config.timestamp_col).cast(pl.Int64),
        pl.col(config.probability_col).cast(pl.Float64),
    )

    btc_clean = (
        btc.with_columns(
            pl.col(config.timestamp_col).cast(pl.Int64),
            pl.col(config.btc_price_col).cast(pl.Float64),
        )
        .drop_nulls([config.timestamp_col, config.btc_price_col])
        .sort(config.timestamp_col)
    )

    featured = _prediction_lag_features(pred, config=config)
    featured = _btc_lag_features(featured, btc_clean, config=config)
    signals = featured.filter(_signal_expression(config))

    for horizon_ms in config.horizons_ms:
        signals = _attach_forward_btc(
            signals,
            btc_clean,
            config=config,
            horizon_ms=horizon_ms,
        )

    signals = _attach_expiry_btc(signals, btc_clean, config=config)

    return signals.sort(config.timestamp_col)


def summarize_lead_lag(
    events: pl.DataFrame,
    horizons_ms: Iterable[int] = FORWARD_HORIZONS_MS,
) -> pl.DataFrame:
    """Create a compact horizon-by-horizon diagnostic table."""

    rows: list[dict[str, float | int | str | None]] = []
    n = events.height

    for horizon_ms in horizons_ms:
        label = FORWARD_HORIZON_LABELS.get(horizon_ms, f"{horizon_ms}ms")
        move_col = f"btc_move_{label}_usd"
        return_col = f"btc_return_{label}_bps"
        directional_col = f"directional_move_{label}_usd"
        if move_col not in events.columns:
            continue

        stats = events.select(
            pl.col(move_col).mean().alias("mean_move"),
            pl.col(move_col).median().alias("median_move"),
            pl.col(return_col).mean().alias("mean_return_bps"),
            (pl.col(move_col) > 0).mean().alias("btc_up_rate"),
            (pl.col(directional_col) > 0).mean().alias("directional_hit_rate"),
            pl.col(directional_col).mean().alias("mean_directional_move"),
        ).row(0, named=True)

        rows.append(
            {
                "horizon": label,
                "horizon_ms": horizon_ms,
                "signals": n,
                "mean_btc_move_usd": stats["mean_move"],
                "median_btc_move_usd": stats["median_move"],
                "mean_btc_return_bps": stats["mean_return_bps"],
                "btc_up_rate": stats["btc_up_rate"],
                "directional_hit_rate": stats["directional_hit_rate"],
                "mean_directional_move_usd": stats["mean_directional_move"],
            }
        )

    if "btc_move_expiry_usd" in events.columns:
        stats = events.select(
            pl.col("btc_move_expiry_usd").mean().alias("mean_move"),
            pl.col("btc_move_expiry_usd").median().alias("median_move"),
            pl.col("btc_return_expiry_bps").mean().alias("mean_return_bps"),
            (pl.col("btc_move_expiry_usd") > 0).mean().alias("btc_up_rate"),
            (pl.col("directional_move_expiry_usd") > 0)
            .mean()
            .alias("directional_hit_rate"),
            pl.col("directional_move_expiry_usd")
            .mean()
            .alias("mean_directional_move"),
        ).row(0, named=True)
        rows.append(
            {
                "horizon": "expiry",
                "horizon_ms": None,
                "signals": n,
                "mean_btc_move_usd": stats["mean_move"],
                "median_btc_move_usd": stats["median_move"],
                "mean_btc_return_bps": stats["mean_return_bps"],
                "btc_up_rate": stats["btc_up_rate"],
                "directional_hit_rate": stats["directional_hit_rate"],
                "mean_directional_move_usd": stats["mean_directional_move"],
            }
        )

    return pl.DataFrame(rows)
