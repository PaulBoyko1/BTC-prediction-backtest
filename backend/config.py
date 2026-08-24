"""Shared research configuration.

Raw timestamps are represented as integer nanoseconds since Unix epoch.  We keep the
source timestamp at its native precision during ingestion and only aggregate later.
"""

FORWARD_HORIZONS_MS = (
    100,
    250,
    500,
    1_000,
    2_000,
    5_000,
    10_000,
    30_000,
    60_000,
    180_000,
    300_000,
)

FORWARD_HORIZON_LABELS = {
    100: "100ms",
    250: "250ms",
    500: "500ms",
    1_000: "1s",
    2_000: "2s",
    5_000: "5s",
    10_000: "10s",
    30_000: "30s",
    60_000: "1m",
    180_000: "3m",
    300_000: "5m",
}

DEFAULT_PREDICTION_SHOCK_LOOKBACK_MS = 5_000
DEFAULT_PREDICTION_SHOCK_POINTS = 0.08
DEFAULT_MAX_BTC_MOVE_USD = 20.0

REFERENCE_DATA_TIERS = (
    "exact_reference",
    "exact_outcome_only",
    "spot_proxy",
)

BTC_SOURCE_MODES = (
    "binance",
    "coinbase",
    "composite",
)
