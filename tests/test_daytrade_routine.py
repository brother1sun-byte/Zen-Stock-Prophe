import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402
from daytrade_analysis import build_daytrade_analysis  # noqa: E402
from daytrade_routine import build_commute_daytrade_routine  # noqa: E402


class DaytradeRoutineTests(unittest.TestCase):
    def make_frame(self, periods=140):
        dates = pd.date_range("2026-06-01 09:00", periods=periods, freq="5min")
        closes = [1000 + index * 0.9 for index in range(periods)]
        return pd.DataFrame(
            {
                "Open": [value * 0.999 for value in closes],
                "High": [value * 1.006 for value in closes],
                "Low": [value * 0.994 for value in closes],
                "Close": closes,
                "Volume": [100_000 + index * 1200 for index in range(periods)],
            },
            index=dates,
        )

    def test_routine_returns_evening_commute_and_work_phases(self):
        analysis = build_daytrade_analysis(
            "6503.T",
            self.make_frame(),
            interval="5m",
            quote_context={"bid": 1110, "ask": 1111, "quoteAgeSec": 1.0, "bookRatio": 1.4},
            event_context={"tone": "neutral", "hasRecentMaterial": False, "hasUpcomingEarnings": False, "source": "TEST"},
        )

        routine = build_commute_daytrade_routine(analysis)

        self.assertEqual(routine["routineMode"], "MANUAL_COMMUTE_DAYTRADE")
        self.assertFalse(routine["liveBrokerOrdersEnabled"])
        self.assertTrue(routine["simulatorOnly"])
        self.assertEqual([phase["id"] for phase in routine["phases"]], ["evening", "commute", "work_monitor"])
        self.assertIn("orderUpperLimit", routine["mobileSummary"])
        self.assertIn(routine["verdict"], {"PRIMARY_REVIEW", "SECONDARY_REVIEW", "WATCH_ONLY", "SKIP"})
        self.assertIn("注文送信", routine["manualOnlyNotice"])

    def test_blocked_event_removes_manual_order_candidate(self):
        analysis = build_daytrade_analysis(
            "6503.T",
            self.make_frame(),
            interval="5m",
            quote_context={"bid": 1110, "ask": 1111, "quoteAgeSec": 1.0, "bookRatio": 1.4},
            event_context={"tone": "negative", "hasRecentMaterial": True, "hasUpcomingEarnings": True, "source": "TEST"},
        )

        routine = build_commute_daytrade_routine(analysis)
        commute_phase = next(phase for phase in routine["phases"] if phase["id"] == "commute")

        self.assertEqual(routine["verdict"], "SKIP")
        self.assertFalse(commute_phase["checks"][0]["ok"])

    def test_daytrade_routine_api_reuses_analysis_path(self):
        frame = self.make_frame()
        calls = []
        original_get_stock_data = server.get_stock_data
        original_quote = server._fetch_daytrade_quote_context
        original_events = server._fetch_daytrade_event_context
        try:
            server.DAYTRADE_ANALYSIS_CACHE.clear()
            server.get_stock_data = lambda ticker, period, interval: calls.append((ticker, period, interval)) or frame
            server._fetch_daytrade_quote_context = lambda ticker: {"source": "TEST", "bid": 1000, "ask": 1001, "quoteAgeSec": 1}
            server._fetch_daytrade_event_context = lambda ticker: {"source": "TEST", "tone": "neutral", "hasRecentMaterial": False, "hasUpcomingEarnings": False}
            routine = server.get_daytrade_routine("6503.T", interval="5m")
        finally:
            server.get_stock_data = original_get_stock_data
            server._fetch_daytrade_quote_context = original_quote
            server._fetch_daytrade_event_context = original_events
            server.DAYTRADE_ANALYSIS_CACHE.clear()

        self.assertEqual(calls, [("6503.T", "60d", "5m")])
        self.assertEqual(routine["ticker"], "6503.T")
        self.assertEqual(routine["sourceInterval"], "5m")
        self.assertEqual(routine["analysisCacheStatus"], "MISS")


if __name__ == "__main__":
    unittest.main()
