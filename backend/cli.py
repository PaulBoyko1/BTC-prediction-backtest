"""Command-line entry points for the heavy historical research backend."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import polars as pl

from .config import FORWARD_HORIZONS_MS
from .lead_lag import LeadLagConfig, build_lead_lag_events, summarize_lead_lag
from .reference_sources import CMEDataMineClient, CMEDataMineCredentials
from .twap_proxy import TwapProxyConfig, build_twap_proxy


def _parse_horizons(text: str) -> tuple[int, ...]:
    values = tuple(int(part.strip()) for part in text.split(",") if part.strip())
    if not values:
        raise argparse.ArgumentTypeError("at least one horizon is required")
    if any(value <= 0 for value in values):
        raise argparse.ArgumentTypeError("horizons must be positive milliseconds")
    return values


def _read_parquet(path: str | Path) -> pl.DataFrame:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    return pl.read_parquet(path)


def _cme_client() -> CMEDataMineClient:
    api_id = os.environ.get("CME_DATAMINE_API_ID", "")
    password = os.environ.get("CME_DATAMINE_API_PASSWORD", "")
    if not api_id or not password:
        raise RuntimeError(
            "Set CME_DATAMINE_API_ID and CME_DATAMINE_API_PASSWORD. "
            "These credentials must be entitled to the requested CME DataMine files."
        )
    return CMEDataMineClient(CMEDataMineCredentials(api_id, password))


def command_lead_lag(args: argparse.Namespace) -> int:
    prediction = _read_parquet(args.prediction)
    btc = _read_parquet(args.btc)

    config = LeadLagConfig(
        lookback_ms=args.lookback_ms,
        shock_points=args.shock_points,
        max_btc_move_usd=args.max_btc_move_usd,
        direction=args.direction,
        horizons_ms=args.horizons_ms,
        probability_col=args.probability_col,
        timestamp_col=args.timestamp_col,
        contract_col=args.contract_col,
        btc_price_col=args.btc_price_col,
        expiry_col=args.expiry_col,
        max_feature_staleness_ms=args.max_feature_staleness_ms,
        max_forward_delay_ms=args.max_forward_delay_ms,
        signal_cooldown_ms=args.signal_cooldown_ms,
    )

    events = build_lead_lag_events(prediction, btc, config)
    summary = summarize_lead_lag(events, config.horizons_ms)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    events.write_parquet(output, compression="zstd")

    summary_output = (
        Path(args.summary_output)
        if args.summary_output
        else output.with_name(f"{output.stem}_summary.parquet")
    )
    summary_output.parent.mkdir(parents=True, exist_ok=True)
    summary.write_parquet(summary_output, compression="zstd")

    raw_signals = (
        int(events["raw_qualifying_signal_count"][0])
        if events.height and "raw_qualifying_signal_count" in events.columns
        else events.height
    )
    print(f"raw qualifying signals: {raw_signals:,}")
    print(f"de-clustered signals:   {events.height:,}")
    print(f"signal cooldown:        {config.signal_cooldown_ms:,} ms")
    print(f"events:                 {output}")
    print(f"summary:                {summary_output}")
    if summary.height:
        print(summary)
    return 0


def command_twap_proxy(args: argparse.Namespace) -> int:
    btc = _read_parquet(args.btc)
    targets = _read_parquet(args.targets)
    config = TwapProxyConfig(
        window_seconds=args.window_seconds,
        timestamp_col=args.timestamp_col,
        price_col=args.price_col,
        target_timestamp_col=args.target_timestamp_col,
        source_label=args.source_label,
        max_start_staleness_ms=args.max_start_staleness_ms,
        max_observation_gap_ms=args.max_observation_gap_ms,
    )
    result = build_twap_proxy(btc, targets, config)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.write_parquet(output, compression="zstd")
    complete = int(result.filter(pl.col("complete_window")).height) if result.height else 0
    print(f"targets:          {result.height:,}")
    print(f"complete windows: {complete:,}")
    print(f"window:           {config.window_seconds}s")
    print(f"source label:     {config.source_label}")
    print("classification:   reconstructed spot_proxy (NOT exact Chainlink)")
    print(f"output:           {output}")
    return 0


def command_cme_list(args: argparse.Namespace) -> int:
    payload = _cme_client().list_entitled_files(
        category_code=args.category_code,
        dataset_code=args.dataset_code,
        period_date=args.period_date,
        limit=args.limit,
        offset=args.offset,
    )
    text = json.dumps(payload, indent=2)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"{text}\n", encoding="utf-8")
        print(f"saved {output}")
    else:
        print(text)
    return 0


def command_cme_download(args: argparse.Namespace) -> int:
    output = _cme_client().download_file(args.file_id, args.output)
    print(f"saved {output}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="btc-research",
        description="High-frequency BTC prediction-market research backend",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    lead_lag = subparsers.add_parser(
        "lead-lag",
        help="Test prediction-market shocks conditioned on muted BTC movement",
    )
    lead_lag.add_argument("--prediction", required=True, help="Normalized prediction Parquet")
    lead_lag.add_argument("--btc", required=True, help="Normalized BTC Parquet")
    lead_lag.add_argument("--output", required=True, help="Output event Parquet")
    lead_lag.add_argument("--summary-output", help="Optional summary Parquet path")
    lead_lag.add_argument("--lookback-ms", type=int, default=5_000)
    lead_lag.add_argument("--shock-points", type=float, default=0.08)
    lead_lag.add_argument("--max-btc-move-usd", type=float, default=20.0)
    lead_lag.add_argument(
        "--direction",
        choices=("up", "down", "either"),
        default="either",
    )
    lead_lag.add_argument(
        "--horizons-ms",
        type=_parse_horizons,
        default=FORWARD_HORIZONS_MS,
        help="Comma-separated milliseconds, e.g. 100,250,500,1000,5000",
    )
    lead_lag.add_argument(
        "--max-feature-staleness-ms",
        type=int,
        help="Optional maximum age of backward as-of feature matches. Older matches are rejected.",
    )
    lead_lag.add_argument(
        "--max-forward-delay-ms",
        type=int,
        help="Optional maximum delay after each target horizon. Later labels are set null.",
    )
    lead_lag.add_argument(
        "--signal-cooldown-ms",
        type=int,
        default=0,
        help=(
            "Per-contract de-clustering cooldown between kept signals. "
            "0 keeps every qualifying tick; use e.g. the shock lookback to study distinct episodes."
        ),
    )
    lead_lag.add_argument("--probability-col", default="yes_mid")
    lead_lag.add_argument("--timestamp-col", default="timestamp_ns")
    lead_lag.add_argument("--contract-col", default="contract_id")
    lead_lag.add_argument("--btc-price-col", default="price")
    lead_lag.add_argument("--expiry-col", default="expiry_ns")
    lead_lag.set_defaults(func=command_lead_lag)

    twap = subparsers.add_parser(
        "twap-proxy",
        help="Build a reconstructed BTC TWAP proxy from irregular spot ticks",
    )
    twap.add_argument("--btc", required=True, help="BTC tick Parquet")
    twap.add_argument("--targets", required=True, help="Target timestamp Parquet")
    twap.add_argument("--output", required=True, help="Output TWAP proxy Parquet")
    twap.add_argument("--window-seconds", type=int, default=60)
    twap.add_argument("--timestamp-col", default="timestamp_ns")
    twap.add_argument("--price-col", default="price")
    twap.add_argument("--target-timestamp-col", default="timestamp_ns")
    twap.add_argument(
        "--source-label",
        default="btc_spot_proxy",
        help="Explicit provenance such as binance, coinbase, or binance_coinbase_composite",
    )
    twap.add_argument(
        "--max-start-staleness-ms",
        type=int,
        help="Optional maximum age of the carried-forward price at the window start.",
    )
    twap.add_argument(
        "--max-observation-gap-ms",
        type=int,
        help="Optional maximum gap between observations inside a proxy window.",
    )
    twap.set_defaults(func=command_twap_proxy)

    cme_list = subparsers.add_parser(
        "cme-list",
        help="List CME DataMine files already entitled to this API account",
    )
    cme_list.add_argument("--category-code")
    cme_list.add_argument("--dataset-code")
    cme_list.add_argument("--period-date", help="CME period date filter")
    cme_list.add_argument("--limit", type=int, default=100)
    cme_list.add_argument("--offset", type=int, default=0)
    cme_list.add_argument("--output", help="Optional JSON output path")
    cme_list.set_defaults(func=command_cme_list)

    cme_download = subparsers.add_parser(
        "cme-download",
        help="Download one already-entitled CME DataMine file by file ID",
    )
    cme_download.add_argument("--file-id", required=True)
    cme_download.add_argument("--output", required=True)
    cme_download.set_defaults(func=command_cme_download)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
