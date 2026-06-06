import json
import math
import sys
import unittest
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
        self.assertIn("not investment advice", report["disclaimer"])
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
        self.assertTrue(any("spread" in item.lower() for item in report["fakeoutFilters"]))
        self.assertTrue(any("earnings" in item.lower() for item in report["fakeoutFilters"]))

    def test_daytrade_analysis_rejects_unsupported_interval(self):
        with self.assertRaises(ValueError):
            build_daytrade_analysis("6503.T", self.make_intraday_frame(), interval="30m")

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


if __name__ == "__main__":
    unittest.main()
