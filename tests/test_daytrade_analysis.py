import json
import math
import sys
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402
from daytrade_analysis import build_daytrade_analysis  # noqa: E402


class DaytradeAnalysisTests(unittest.TestCase):
    def make_intraday_frame(self, periods=120):
        dates = pd.date_range("2026-06-01 09:00", periods=periods, freq="5min")
        closes = [1000 + index * 0.8 + math.sin(index / 5) * 4 for index in range(periods)]
        return pd.DataFrame(
            {
                "Open": [value * 0.999 for value in closes],
                "High": [value * 1.006 for value in closes],
                "Low": [value * 0.994 for value in closes],
                "Close": closes,
                "Volume": [120_000 + index * 1500 for index in range(periods)],
            },
            index=dates,
        )

    def test_daytrade_analysis_returns_scored_evidence_and_backtest(self):
        report = build_daytrade_analysis(
            "6503.T",
            self.make_intraday_frame(),
            interval="5m",
            quote_context={"bid": 1090, "ask": 1091, "quoteAgeSec": 1.2, "bookRatio": 1.7},
            event_context={"tone": "neutral", "hasRecentMaterial": False, "hasUpcomingEarnings": False, "source": "TEST"},
        )

        self.assertEqual(report["ticker"], "6503.T")
        self.assertEqual(report["interval"], "5m")
        self.assertGreaterEqual(report["score"], 0)
        self.assertLessEqual(report["score"], 100)
        self.assertIn(report["signal"], {"STRONG_LONG_REVIEW", "LONG_REVIEW", "WAIT", "AVOID"})
        self.assertIn("vwap", report["indicators"])
        self.assertIn("rsi", report["indicators"])
        self.assertIn("macd", report["indicators"])
        self.assertIn("bollinger", report["indicators"])
        self.assertIn("volumeSeasonality", report["indicators"])
        self.assertIn("microstructure", report["indicators"])
        self.assertIn("eventRisk", report["indicators"])
        self.assertIn("entryCandidate", report["levels"])
        self.assertIn("takeProfitCandidate", report["levels"])
        self.assertIn("stopLossCandidate", report["levels"])
        self.assertTrue(any(item["id"] == "vwap" for item in report["evidence"]))
        self.assertTrue(any(item["id"] == "volume_seasonality" for item in report["evidence"]))
        self.assertTrue(any(item["id"] == "spread" for item in report["evidence"]))
        self.assertTrue(any(item["id"] == "event_risk" for item in report["evidence"]))
        self.assertIn("winRatePct", report["backtest"])
        self.assertIn("maxDrawdownPct", report["backtest"])
        self.assertIn("stabilityPct", report["walkForward"])
        self.assertIn("投資助言ではありません", report["disclaimer"])
        self.assertIn("シミュレーション専用", report["disclaimer"])
        self.assertNotIn("強い買い", report["label"])
        self.assertNotIn("買い検討", report["label"])
        visible_copy = " ".join(
            [item["label"] + " " + item["detail"] for item in report["evidence"]]
            + report["fakeoutFilters"]
            + report["explanations"]
            + [report["label"]]
        )
        for english_fragment in (
            "Trend alignment",
            "VWAP support",
            "RSI tradable zone",
            "MACD momentum",
            "Volume expansion",
            "Volatility range",
            "Session volume seasonality",
            "News / earnings exclusion",
            "Fakeout filters",
        ):
            self.assertNotIn(english_fragment, visible_copy)
        json.dumps(report)

    def test_event_and_spread_risk_reduce_signal_quality(self):
        report = build_daytrade_analysis(
            "6503.T",
            self.make_intraday_frame(),
            interval="5m",
            quote_context={"bid": 1000, "ask": 1010, "quoteAgeSec": 1.0, "bookRatio": 0.4},
            event_context={
                "tone": "negative",
                "hasRecentMaterial": True,
                "hasUpcomingEarnings": True,
                "latestTitle": "下方修正",
                "source": "TEST",
            },
        )

        self.assertEqual(report["indicators"]["microstructure"]["verdict"], "WIDE")
        self.assertEqual(report["indicators"]["eventRisk"]["verdict"], "BLOCK")
        self.assertTrue(any("スプレッド" in item for item in report["fakeoutFilters"]))
        self.assertTrue(any("決算" in item for item in report["fakeoutFilters"]))

    def test_daytrade_analysis_rejects_unsupported_interval(self):
        with self.assertRaises(ValueError):
            build_daytrade_analysis("6503.T", self.make_intraday_frame(), interval="30m")

    def test_unavailable_event_context_remains_cautionary(self):
        report = build_daytrade_analysis(
            "6503.T",
            self.make_intraday_frame(),
            interval="5m",
            event_context={"source": "UNAVAILABLE", "tone": "unknown", "items": []},
        )

        event_risk = report["indicators"]["eventRisk"]
        self.assertEqual(event_risk["verdict"], "CAUTION")
        self.assertTrue(any("一次情報" in reason for reason in event_risk["reasons"]))

    def test_daytrade_api_uses_requested_interval_period(self):
        frame = self.make_intraday_frame()
        calls = []
        original_get_stock_data = server.get_stock_data
        original_quote = server._fetch_daytrade_quote_context
        original_events = server._fetch_daytrade_event_context
        try:
            server.DAYTRADE_ANALYSIS_CACHE.clear()
            server.get_stock_data = lambda ticker, period, interval: calls.append((ticker, period, interval)) or frame
            server._fetch_daytrade_quote_context = lambda ticker: {"source": "TEST", "bid": 1000, "ask": 1001, "quoteAgeSec": 1}
            server._fetch_daytrade_event_context = lambda ticker: {"source": "TEST", "tone": "neutral", "hasRecentMaterial": False, "hasUpcomingEarnings": False}
            payload = server.get_daytrade_analysis("6503.T", interval="15m")
        finally:
            server.get_stock_data = original_get_stock_data
            server._fetch_daytrade_quote_context = original_quote
            server._fetch_daytrade_event_context = original_events
            server.DAYTRADE_ANALYSIS_CACHE.clear()

        self.assertEqual(calls, [("6503.T", "60d", "15m")])
        self.assertEqual(payload["interval"], "15m")
        self.assertEqual(payload["cacheStatus"], "MISS")

    def test_daytrade_api_reuses_recent_cached_analysis(self):
        frame = self.make_intraday_frame()
        calls = []
        original_get_stock_data = server.get_stock_data
        original_quote = server._fetch_daytrade_quote_context
        original_events = server._fetch_daytrade_event_context
        try:
            server.DAYTRADE_ANALYSIS_CACHE.clear()
            server.get_stock_data = lambda ticker, period, interval: calls.append((ticker, period, interval)) or frame
            server._fetch_daytrade_quote_context = lambda ticker: {"source": "TEST", "bid": 1000, "ask": 1001, "quoteAgeSec": 1}
            server._fetch_daytrade_event_context = lambda ticker: {"source": "TEST", "tone": "neutral", "hasRecentMaterial": False, "hasUpcomingEarnings": False}
            first = server.get_daytrade_analysis("6503.T", interval="5m")
            second = server.get_daytrade_analysis("6503.T", interval="5m")
        finally:
            server.get_stock_data = original_get_stock_data
            server._fetch_daytrade_quote_context = original_quote
            server._fetch_daytrade_event_context = original_events
            server.DAYTRADE_ANALYSIS_CACHE.clear()

        self.assertEqual(len(calls), 1)
        self.assertEqual(first["cacheStatus"], "MISS")
        self.assertEqual(second["cacheStatus"], "HIT")
        self.assertEqual(second["score"], first["score"])

    def test_daytrade_api_coalesces_concurrent_analysis_requests(self):
        frame = self.make_intraday_frame()
        calls = []
        original_get_stock_data = server.get_stock_data
        original_build = server.build_daytrade_analysis
        original_contexts = server._fetch_daytrade_contexts
        try:
            server.DAYTRADE_ANALYSIS_CACHE.clear()
            server.DAYTRADE_ANALYSIS_INFLIGHT.clear()
            server.get_stock_data = lambda ticker, period, interval: frame
            server._fetch_daytrade_contexts = lambda ticker: ({"source": "TEST"}, {"source": "TEST"})

            def slow_build(ticker, hist, **kwargs):
                calls.append(ticker)
                time.sleep(0.05)
                return {"ticker": ticker, "interval": kwargs["interval"], "score": 50}

            server.build_daytrade_analysis = slow_build
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _index: server.get_daytrade_analysis("6503.T", interval="5m"), range(2)))
        finally:
            server.get_stock_data = original_get_stock_data
            server.build_daytrade_analysis = original_build
            server._fetch_daytrade_contexts = original_contexts
            server.DAYTRADE_ANALYSIS_CACHE.clear()
            server.DAYTRADE_ANALYSIS_INFLIGHT.clear()

        self.assertEqual(calls, ["6503.T"])
        self.assertEqual(sorted(item["cacheStatus"] for item in results), ["HIT", "MISS"])

    def test_optional_daytrade_context_timeout_does_not_block_analysis(self):
        original_quote = server._fetch_daytrade_quote_context
        original_events = server._fetch_daytrade_event_context
        try:
            server.DAYTRADE_CONTEXT_CACHE.clear()
            server._fetch_daytrade_quote_context = lambda ticker: time.sleep(0.2) or {"source": "LATE_QUOTE"}
            server._fetch_daytrade_event_context = lambda ticker: time.sleep(0.2) or {"source": "LATE_EVENTS"}
            started = time.perf_counter()
            quote, events = server._fetch_daytrade_contexts("6503.T", timeout_sec=0.02)
            elapsed = time.perf_counter() - started
        finally:
            server._fetch_daytrade_quote_context = original_quote
            server._fetch_daytrade_event_context = original_events
            server.DAYTRADE_CONTEXT_CACHE.clear()

        self.assertLess(elapsed, 0.15)
        self.assertEqual(quote["source"], "UNAVAILABLE")
        self.assertEqual(events["source"], "UNAVAILABLE")
        self.assertEqual(quote["errorCode"], "OPTIONAL_CONTEXT_TIMEOUT")
        self.assertEqual(events["errorCode"], "OPTIONAL_CONTEXT_TIMEOUT")
        self.assertNotIn("quote:6503.T", server.DAYTRADE_CONTEXT_CACHE)
        self.assertNotIn("events:6503.T", server.DAYTRADE_CONTEXT_CACHE)


if __name__ == "__main__":
    unittest.main()
