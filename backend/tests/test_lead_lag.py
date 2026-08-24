import polars as pl

from backend.lead_lag import LeadLagConfig, build_lead_lag_events, summarize_lead_lag


def ns(seconds: float) -> int:
    return int(seconds * 1_000_000_000)


def sample_frames():
    prediction = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(5), ns(10)],
            "contract_id": ["c1", "c1", "c1"],
            "yes_mid": [0.50, 0.60, 0.61],
            "expiry_ns": [ns(15), ns(15), ns(15)],
        }
    )

    btc = pl.DataFrame(
        {
            "timestamp_ns": [
                ns(0),
                ns(5),
                ns(5.1),
                ns(5.25),
                ns(5.5),
                ns(6),
                ns(10),
                ns(15),
            ],
            "price": [
                100_000.0,
                100_010.0,
                100_020.0,
                100_025.0,
                100_030.0,
                100_050.0,
                100_040.0,
                100_100.0,
            ],
        }
    )
    return prediction, btc


def test_lead_lag_signal_and_forward_labels():
    prediction, btc = sample_frames()
    config = LeadLagConfig(
        lookback_ms=5_000,
        shock_points=0.08,
        max_btc_move_usd=20.0,
        direction="up",
        horizons_ms=(100, 1_000),
    )

    events = build_lead_lag_events(prediction, btc, config)

    assert events.height == 1
    event = events.row(0, named=True)
    assert event["timestamp_ns"] == ns(5)
    assert abs(event["pm_change"] - 0.10) < 1e-12
    assert event["pm_lag_staleness_ms"] == 0
    assert event["btc_now_age_ms"] == 0
    assert event["btc_lag_age_ms"] == 0
    assert event["btc_lookback_move_usd"] == 10.0
    assert event["btc_move_100ms_usd"] == 10.0
    assert event["btc_future_100ms_delay_ms"] == 0
    assert event["btc_move_1s_usd"] == 40.0
    assert event["btc_move_expiry_usd"] == 90.0
    assert event["directional_move_100ms_usd"] > 0

    summary = summarize_lead_lag(events, config.horizons_ms)
    assert summary["horizon"].to_list() == ["100ms", "1s", "expiry"]
    assert summary["signals"].to_list() == [1, 1, 1]
    assert summary["qualifying_signals"].to_list() == [1, 1, 1]
    assert summary["max_label_delay_ms"].to_list() == [0.0, 0.0, 0.0]


def test_future_btc_cannot_change_signal_selection():
    prediction, btc = sample_frames()
    config = LeadLagConfig(
        lookback_ms=5_000,
        shock_points=0.08,
        max_btc_move_usd=20.0,
        direction="up",
        horizons_ms=(100,),
    )

    baseline = build_lead_lag_events(prediction, btc, config)

    changed_future = btc.with_columns(
        pl.when(pl.col("timestamp_ns") > ns(5))
        .then(pl.lit(500_000.0))
        .otherwise(pl.col("price"))
        .alias("price")
    )
    modified = build_lead_lag_events(prediction, changed_future, config)

    assert baseline.select("timestamp_ns", "contract_id").equals(
        modified.select("timestamp_ns", "contract_id")
    )
    assert baseline["btc_move_100ms_usd"][0] != modified["btc_move_100ms_usd"][0]


def test_forward_delay_tolerance_nulls_stale_label_and_summary_counts_it_out():
    prediction = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(5)],
            "contract_id": ["c1", "c1"],
            "yes_mid": [0.50, 0.60],
        }
    )
    btc = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(5), ns(5.25)],
            "price": [100_000.0, 100_010.0, 100_030.0],
        }
    )
    config = LeadLagConfig(
        lookback_ms=5_000,
        shock_points=0.08,
        max_btc_move_usd=20.0,
        direction="up",
        horizons_ms=(100,),
        max_forward_delay_ms=100,
    )

    events = build_lead_lag_events(prediction, btc, config)
    assert events.height == 1
    assert events["btc_future_100ms_delay_ms"][0] == 150.0
    assert events["btc_move_100ms_usd"][0] is None

    summary = summarize_lead_lag(events, config.horizons_ms)
    assert summary["qualifying_signals"][0] == 1
    assert summary["signals"][0] == 0


def test_feature_staleness_tolerance_rejects_old_asof_match():
    prediction = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(5.5)],
            "contract_id": ["c1", "c1"],
            "yes_mid": [0.50, 0.60],
        }
    )
    btc = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(0.5), ns(5.5), ns(6)],
            "price": [100_000.0, 100_001.0, 100_010.0, 100_020.0],
        }
    )
    loose = LeadLagConfig(
        lookback_ms=5_000,
        shock_points=0.08,
        max_btc_move_usd=20.0,
        direction="up",
        horizons_ms=(100,),
    )
    strict = LeadLagConfig(
        lookback_ms=5_000,
        shock_points=0.08,
        max_btc_move_usd=20.0,
        direction="up",
        horizons_ms=(100,),
        max_feature_staleness_ms=100,
    )

    loose_events = build_lead_lag_events(prediction, btc, loose)
    strict_events = build_lead_lag_events(prediction, btc, strict)
    assert loose_events.height == 1
    assert loose_events["pm_lag_staleness_ms"][0] == 500.0
    assert strict_events.height == 0


def test_invalid_probability_rows_are_removed_before_signal_generation():
    prediction = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(5), ns(10)],
            "contract_id": ["c1", "c1", "c1"],
            "yes_mid": [0.50, 1.20, 0.60],
        }
    )
    btc = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(5), ns(10), ns(10.1)],
            "price": [100_000.0, 100_005.0, 100_010.0, 100_020.0],
        }
    )
    config = LeadLagConfig(
        lookback_ms=5_000,
        shock_points=0.08,
        max_btc_move_usd=20.0,
        direction="up",
        horizons_ms=(100,),
    )
    events = build_lead_lag_events(prediction, btc, config)
    assert events.height == 1
    assert events["timestamp_ns"][0] == ns(10)
