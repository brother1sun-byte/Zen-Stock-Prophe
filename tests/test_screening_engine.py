import sys
import unittest
import math
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402
from daytrade_engine import BoardSnapshot, build_signal_ticket, validate_entry  # noqa: E402


class ScreeningEngineTests(unittest.TestCase):
    def test_normalize_jpx_code_handles_excel_numeric_codes(self):
        self.assertEqual(server._normalize_jpx_code(7203.0), "7203")
        self.assertEqual(server._normalize_jpx_code("4980.0"), "4980")
        self.assertEqual(server._normalize_jpx_code("130A"), "130A")

    def test_smooth_breakout_is_not_rejected_as_overhead_resistance(self):
        prices = [100 + i for i in range(252)]
        highs = [price * 1.02 for price in prices]
        lows = [price * 0.98 for price in prices]

        rr = server.calculate_risk_reward(prices[-1], highs, lows, prices)

        self.assertGreaterEqual(rr["rr_ratio"], 2.0)
        self.assertTrue(rr["is_favorable"])
        self.assertEqual(rr["blocking_resistance_zones"], [])

    def test_display_candidates_keep_watchlist_depth_when_one_treasure_exists(self):
        treasure = [{"ticker": "1803.T", "score": 99}]
        review = [{"ticker": "7203.T", "score": 78}, {"ticker": "6758.T", "score": 76}]
        prefilter = [{"ticker": "7203.T", "score": 72}, {"ticker": "8306.T", "score": 68}]

        merged = server._merge_display_candidates(treasure, review, prefilter)

        self.assertEqual([item["ticker"] for item in merged], ["1803.T", "7203.T", "6758.T", "8306.T"])

    def test_only_dexerials_is_canonical_fixed_watch_candidate(self):
        self.assertEqual(list(server.MUST_INCLUDE), ["4980.T"])
        self.assertIn("4980.T", server.STOCKS)
        self.assertEqual(server.MUST_INCLUDE["4980.T"]["candidate_rank"], 1)
        self.assertEqual(server.MUST_INCLUDE["4980.T"]["candidate_score"], 100)

    def test_publish_watchlist_preserves_dexerials_first(self):
        original_stocks = server.STOCKS
        try:
            published = server._publish_watchlist_candidates([
                {"ticker": "7203.T", "score": 78, "reason": "test", "info": {"name": "Toyota", "emoji": "TY"}},
            ])
        finally:
            server.STOCKS = original_stocks

        self.assertNotIn("6503.T", published)
        self.assertEqual(published["4980.T"]["candidate_rank"], 1)
        self.assertEqual(published["7203.T"]["candidate_rank"], 2)

    def test_stock_payload_uses_live_history_score_for_pinned_candidate(self):
        closes = [100 - index * 0.3 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 1.002 for value in closes],
                "High": [value * 1.01 for value in closes],
                "Low": [value * 0.99 for value in closes],
                "Close": closes,
                "Volume": [200000 for _ in closes],
            },
            index=pd.date_range("2026-01-01", periods=len(closes), freq="B"),
        )

        original_get_stock_data = server.get_stock_data
        try:
            server.get_stock_data = lambda *args, **kwargs: frame
            payload = server._stock_payload("4980.T", server.MUST_INCLUDE["4980.T"])
        finally:
            server.get_stock_data = original_get_stock_data

        self.assertNotEqual(payload["candidateScore"], server.MUST_INCLUDE["4980.T"]["candidate_score"])
        self.assertEqual(payload["publishedCandidateScore"], server.MUST_INCLUDE["4980.T"]["candidate_score"])
        self.assertEqual(payload["candidateRank"], 1)

    def test_market_universe_filters_to_domestic_jpx_issues(self):
        original_path = server.JPX_UNIVERSE_PATH
        original_url = server.JPX_LISTED_ISSUES_URL
        try:
            frame = pd.DataFrame(
                [
                    {"Local Code": "4980", "Name (English)": "Dexerials", "Section/Products": "Prime Market (Domestic)", "33 Sector(name)": "Chemicals"},
                    {"Local Code": "7203", "Name (English)": "Toyota", "Section/Products": "Prime Market (Domestic)", "33 Sector(name)": "Transportation Equipment"},
                    {"Local Code": "9999", "Name (English)": "Foreign Test", "Section/Products": "Prime Market (Foreign)", "33 Sector(name)": "Foreign"},
                ]
            )
            path = ROOT / "tmp_jpx_universe_test.xlsx"
            frame.to_excel(path, index=False)
            server.JPX_UNIVERSE_PATH = str(path)
            server.JPX_LISTED_ISSUES_URL = ""

            universe = server.load_market_universe()
        finally:
            server.JPX_UNIVERSE_PATH = original_path
            server.JPX_LISTED_ISSUES_URL = original_url
            if "path" in locals() and path.exists():
                path.unlink()

        self.assertIn("4980.T", universe)
        self.assertIn("7203.T", universe)
        self.assertNotIn("9999.T", universe)
        self.assertTrue(universe["4980.T"]["must_include"])

    def test_candidate_quality_reports_backtest_and_gates(self):
        prices = [100 + i * 0.35 + math.sin(i / 3) * 2 for i in range(90)]
        highs = [price * 1.01 for price in prices]
        lows = [price * 0.99 for price in prices]
        volumes = [200000 + i * 1000 for i in range(90)]

        quality = server.build_candidate_quality(
            prices,
            highs,
            lows,
            volumes,
            rr={"rr_ratio": 2.4},
            vcp_ok=True,
            accum_ok=True,
        )

        self.assertGreater(quality["qualityScore"], 70)
        self.assertGreater(quality["backtest"]["sampleCount"], 0)
        self.assertTrue(any(gate["id"] == "backtest" for gate in quality["gates"]))
        self.assertIn("momentum5", quality["metrics"])

    def test_execution_plan_reprices_far_limit_for_daytrade(self):
        plan = server.TechnicalAnalyzer.build_execution_plan(
            raw_signal="BUY",
            confidence=70,
            current_price=3048,
            buy_limit=2698,
            sell_limit=3165,
            stop_loss=2644,
        )

        self.assertEqual(plan["decision"], "REPRICE_FOR_DAYTRADE")
        self.assertLess(plan["entryGapPct"], -3)

    def test_execution_plan_marks_near_limit_as_daytrade_entry_candidate(self):
        plan = server.TechnicalAnalyzer.build_execution_plan(
            raw_signal="BUY",
            confidence=70,
            current_price=3048,
            buy_limit=3054,
            sell_limit=3180,
            stop_loss=2990,
        )

        self.assertEqual(plan["decision"], "DAYTRADE_ENTRY_OK")
        self.assertTrue(plan["marketAllowed"])

    def test_entry_validation_rejects_subthreshold_gap(self):
        board = BoardSnapshot("4980.T", 2720, 2721, 10000, 5000, 0.5, 2720, 2720)

        valid, reasons = validate_entry(
            gap_pct=2.9,
            board=board,
            has_news=True,
            atr_pct=2,
            volume_rank=1,
            ml_probability=0.7,
            minutes_after_open=1,
        )

        self.assertFalse(valid)
        self.assertIn("gap_abs_below_3.0pct", reasons)

    def test_ready_ticket_has_risk_and_round_lot_size(self):
        ticket = build_signal_ticket(
            ticker="4980.T",
            name="Dexerials",
            gap_pct=3.2,
            board=BoardSnapshot("4980.T", 2720, 2721, 10000, 5000, 0.5, 2720, 2720),
            has_news=True,
            atr_pct=2,
            volume_rank=1,
            ml_probability=0.7,
            minutes_after_open=1,
        )

        self.assertEqual(ticket["state"], "READY")
        self.assertGreater(ticket["riskJpy"], 0)
        self.assertEqual(ticket["shares"] % 100, 0)


if __name__ == "__main__":
    unittest.main()
