"""Reconstructed BTC TWAP proxy utilities.

This module is intentionally *not* a Chainlink replica. It computes a transparent
piecewise-constant time-weighted average from an explicitly chosen BTC source
(Binance, Coinbase, or a documented composite). Results must be labeled
`spot_proxy` / reconstructed and never presented as exact Chainlink Data Streams.

For irregular event timestamps, each observed price is assumed to remain in force
until the next observation. A target window is valid only when a price observation
exists at or before the window start; this prevents silently inventing the opening
segment of a 30s/60s TWAP.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import polars as pl


@dataclass(frozen=True)
class TwapProxyConfig:
    window_seconds: int = 60
    timestamp_col: str = "timestamp_ns"
    price_col: str = "price"
    target_timestamp_col: str = "timestamp_ns"
    source_label: str = "btc_spot_proxy"
    max_start_staleness_ms: int | None = None


def _validate(config: TwapProxyConfig) -> None:
    if config.window_seconds <= 0:
        raise ValueError("window_seconds must be > 0")
    if config.max_start_staleness_ms is not None and config.max_start_staleness_ms < 0:
        raise ValueError("max_start_staleness_ms must be >= 0 or None")


def _clean_ticks(ticks: pl.DataFrame, config: TwapProxyConfig) -> list[tuple[int, float]]:
    required = {config.timestamp_col, config.price_col}
    missing = required.difference(ticks.columns)
    if missing:
        raise ValueError(f"ticks missing required columns: {', '.join(sorted(missing))}")

    frame = (
        ticks.select(
            pl.col(config.timestamp_col).cast(pl.Int64, strict=False).alias("_ts"),
            pl.col(config.price_col).cast(pl.Float64, strict=False).alias("_price"),
        )
        .drop_nulls(["_ts", "_price"])
        .filter(pl.col("_price") > 0)
        .sort("_ts")
        # If a source publishes multiple events at one timestamp, the last event
        # is the state carried forward from that timestamp.
        .unique(subset=["_ts"], keep="last", maintain_order=True)
    )
    return [(int(ts), float(price)) for ts, price in frame.iter_rows()]


def _twap_one(
    clean_ticks: list[tuple[int, float]],
    target_ns: int,
    config: TwapProxyConfig,
) -> dict[str, int | float | bool | str | None]:
    window_ns = int(config.window_seconds * 1_000_000_000)
    start_ns = target_ns - window_ns

    # Binary search for the last observation at/before the window start.
    low, high, start_index = 0, len(clean_ticks) - 1, -1
    while low <= high:
        mid = (low + high) // 2
        if clean_ticks[mid][0] <= start_ns:
            start_index = mid
            low = mid + 1
        else:
            high = mid - 1

    if start_index < 0:
        return {
            config.target_timestamp_col: target_ns,
            "twap_proxy": None,
            "window_seconds": config.window_seconds,
            "source_label": config.source_label,
            "is_exact_source": False,
            "complete_window": False,
            "start_price_timestamp_ns": None,
            "start_staleness_ms": None,
            "observations_in_window": 0,
        }

    start_tick_ns, current_price = clean_ticks[start_index]
    start_staleness_ms = (start_ns - start_tick_ns) / 1_000_000
    if (
        config.max_start_staleness_ms is not None
        and start_staleness_ms > config.max_start_staleness_ms
    ):
        return {
            config.target_timestamp_col: target_ns,
            "twap_proxy": None,
            "window_seconds": config.window_seconds,
            "source_label": config.source_label,
            "is_exact_source": False,
            "complete_window": False,
            "start_price_timestamp_ns": start_tick_ns,
            "start_staleness_ms": start_staleness_ms,
            "observations_in_window": 0,
        }

    integral = 0.0
    cursor_ns = start_ns
    observations = 0

    for tick_ns, price in clean_ticks[start_index + 1 :]:
        if tick_ns > target_ns:
            break
        if tick_ns <= start_ns:
            current_price = price
            continue
        integral += current_price * (tick_ns - cursor_ns)
        cursor_ns = tick_ns
        current_price = price
        observations += 1

    if cursor_ns < target_ns:
        integral += current_price * (target_ns - cursor_ns)

    twap = integral / window_ns if window_ns > 0 else None
    return {
        config.target_timestamp_col: target_ns,
        "twap_proxy": twap,
        "window_seconds": config.window_seconds,
        "source_label": config.source_label,
        "is_exact_source": False,
        "complete_window": True,
        "start_price_timestamp_ns": start_tick_ns,
        "start_staleness_ms": start_staleness_ms,
        "observations_in_window": observations,
    }


def build_twap_proxy(
    ticks: pl.DataFrame,
    targets: pl.DataFrame | Iterable[int],
    config: TwapProxyConfig | None = None,
) -> pl.DataFrame:
    """Compute reconstructed TWAP values for target timestamps.

    `targets` may be a DataFrame containing `target_timestamp_col` or an iterable
    of Unix-nanosecond timestamps. The output explicitly carries
    `is_exact_source=False` and `complete_window` provenance.
    """

    config = config or TwapProxyConfig()
    _validate(config)
    clean = _clean_ticks(ticks, config)

    if isinstance(targets, pl.DataFrame):
        if config.target_timestamp_col not in targets.columns:
            raise ValueError(
                f"targets missing required column: {config.target_timestamp_col}"
            )
        target_values = (
            targets.select(
                pl.col(config.target_timestamp_col).cast(pl.Int64, strict=False)
            )
            .drop_nulls()
            .get_column(config.target_timestamp_col)
            .to_list()
        )
    else:
        target_values = [int(value) for value in targets]

    rows = [_twap_one(clean, int(target), config) for target in target_values]
    if not rows:
        return pl.DataFrame(
            schema={
                config.target_timestamp_col: pl.Int64,
                "twap_proxy": pl.Float64,
                "window_seconds": pl.Int64,
                "source_label": pl.String,
                "is_exact_source": pl.Boolean,
                "complete_window": pl.Boolean,
                "start_price_timestamp_ns": pl.Int64,
                "start_staleness_ms": pl.Float64,
                "observations_in_window": pl.Int64,
            }
        )
    return pl.DataFrame(rows).sort(config.target_timestamp_col)
