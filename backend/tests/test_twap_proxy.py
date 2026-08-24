import polars as pl

from backend.twap_proxy import TwapProxyConfig, build_twap_proxy


def ns(seconds: float) -> int:
    return int(seconds * 1_000_000_000)


def test_irregular_ticks_use_time_weighting_not_trade_count_average():
    ticks = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(10), ns(50), ns(60)],
            "price": [100.0, 200.0, 300.0, 400.0],
        }
    )
    result = build_twap_proxy(
        ticks,
        [ns(60)],
        TwapProxyConfig(window_seconds=60, source_label="test-composite"),
    )
    # 0-10s @100, 10-50s @200, 50-60s @300 = 200 TWAP.
    assert result.height == 1
    assert result["twap_proxy"][0] == 200.0
    assert result["complete_window"][0] is True
    assert result["is_exact_source"][0] is False
    assert result["source_label"][0] == "test-composite"


def test_window_requires_price_at_or_before_start():
    ticks = pl.DataFrame(
        {
            "timestamp_ns": [ns(10), ns(20), ns(60)],
            "price": [100.0, 110.0, 120.0],
        }
    )
    result = build_twap_proxy(ticks, [ns(60)], TwapProxyConfig(window_seconds=60))
    assert result["twap_proxy"][0] is None
    assert result["complete_window"][0] is False


def test_start_staleness_can_fail_closed():
    ticks = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(40), ns(70)],
            "price": [100.0, 110.0, 120.0],
        }
    )
    result = build_twap_proxy(
        ticks,
        [ns(70)],
        TwapProxyConfig(window_seconds=60, max_start_staleness_ms=5_000),
    )
    # Window starts at t=10 but latest known price is t=0, 10s stale.
    assert result["start_staleness_ms"][0] == 10_000.0
    assert result["twap_proxy"][0] is None
    assert result["complete_window"][0] is False


def test_multiple_targets_and_30_second_window():
    ticks = pl.DataFrame(
        {
            "timestamp_ns": [ns(0), ns(15), ns(30), ns(45), ns(60)],
            "price": [100.0, 110.0, 120.0, 130.0, 140.0],
        }
    )
    targets = pl.DataFrame({"timestamp_ns": [ns(30), ns(60)]})
    result = build_twap_proxy(
        ticks,
        targets,
        TwapProxyConfig(window_seconds=30, source_label="binance-proxy"),
    )
    assert result["twap_proxy"].to_list() == [105.0, 125.0]
    assert result["complete_window"].to_list() == [True, True]
    assert result["window_seconds"].to_list() == [30, 30]
