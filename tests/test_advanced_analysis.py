import math
import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from advanced_analysis import build_advanced_report  # noqa: E402


class AdvancedAnalysisTests(unittest.TestCase):
    def make_frame(self, periods=120, *, start=None, source="yfinance", synthetic=False):
        if start is None:
            start = pd.Timestamp.now().normalize() - pd.offsets.BDay(periods - 1)
        dates = pd.date_range(start, periods=periods, freq="B")
        closes = [100 + index * 0.55 + math.sin(index / 4) * 1.8 for index in range(periods)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.996 for value in closes],
                "High": [value * 1.015 for value in closes],
                "Low": [value * 0.985 for value in closes],
                "Close": closes,
                "Volume": [1_200_000 + index * 2500 for index in range(periods)],
            },
            index=dates,
        )
        frame.attrs["source"] = source
        frame.attrs["synthetic"] = synthetic
        return frame

    def test_report_contains_probabilistic_and_position_outputs(self):
        frame = self.make_frame(periods=90)

        report = build_advanced_report("6503.T", frame, capital_jpy=1_000_000, risk_pct=1)

        self.assertEqual(report["ticker"], "6503.T")
        self.assertIn(report["verdict"], {"ADVANCED_READY", "WATCHLIST", "DEFENSIVE"})
        self.assertGreater(report["compositeScore"], 40)
        self.assertEqual(report["monteCarlo"]["sampleCount"], 1200)
        self.assertEqual(len(report["scenarios"]), 3)
        self.assertIn("riskReward", report["positionPlan"])
        self.assertIn("avgTurnover20Jpy", report["positionPlan"])
        self.assertIn("mlPrediction", report)
        self.assertEqual(report["mlPrediction"]["roleLabel"], "AI検証補助")
        self.assertIn(report["mlPrediction"]["status"], {"usable", "review", "contradiction", "insufficient"})
        self.assertGreater(report["positionPlan"]["suggestedShares"], 0)
        self.assertIn(report["analysisReliability"]["grade"], {"strong", "moderate", "weak", "insufficient"})
        self.assertIn("evidenceStrength", report["walkForward"])
        self.assertTrue(any(item["label"] == "RR 1.4以上" for item in report["guardrails"]))
        self.assertTrue(any(item["label"] == "検証強度が中以上" for item in report["guardrails"]))
        self.assertTrue(any(item["label"] == "売買代金が十分" for item in report["guardrails"]))
        self.assertTrue(any(item["label"] == "参加率1%以内" for item in report["guardrails"]))
        self.assertTrue(any(item["label"] == "実注文は作成しない" and item["ok"] for item in report["guardrails"]))
        self.assertIn("実注文は作成しません", report["disclaimer"])
        self.assertTrue(all("繧" not in item["label"] and "????" not in item["label"] for item in report["guardrails"]))

    def test_thin_absolute_liquidity_blocks_advanced_position_sizing(self):
        frame = self.make_frame(periods=120)
        frame["Volume"] = [900 + index * 3 for index in range(120)]

        report = build_advanced_report("THIN.T", frame, capital_jpy=1_000_000, risk_pct=1)

        self.assertEqual(report["verdict"], "DEFENSIVE")
        self.assertFalse(report["factors"]["liquidity"]["absoluteLiquidityOk"])
        self.assertEqual(report["positionPlan"]["suggestedShares"], 0)
        self.assertGreater(report["positionPlan"]["maxRiskBudgetShares"], 0)
        self.assertEqual(report["positionPlan"]["notionalJpy"], 0)
        liquidity_gate = next(item for item in report["guardrails"] if item["label"] == "売買代金が十分")
        participation_gate = next(item for item in report["guardrails"] if item["label"] == "参加率1%以内")
        self.assertFalse(liquidity_gate["ok"])
        self.assertFalse(participation_gate["ok"])

    def test_synthetic_history_is_not_treated_as_high_quality_advanced_analysis(self):
        frame = self.make_frame(source="synthetic", synthetic=True)

        report = build_advanced_report("6503.T", frame, capital_jpy=1_000_000, risk_pct=1)

        self.assertEqual(report["verdict"], "DEFENSIVE")
        self.assertEqual(report["dataQuality"]["source"], "synthetic")
        self.assertTrue(report["dataQuality"]["synthetic"])
        self.assertFalse(report["dataQuality"]["sourceOk"])
        self.assertEqual(report["dataQuality"]["sourceReliabilityGrade"], "synthetic")
        self.assertEqual(report["mlPrediction"]["status"], "reference_only")
        self.assertEqual(report["mlPrediction"]["label"], "参考表示")
        self.assertLess(report["dataQuality"]["score"], 65)
        source_gate = next(item for item in report["guardrails"] if item["label"] == "実データソース")
        self.assertFalse(source_gate["ok"])

    def test_stale_latest_bar_blocks_advanced_ready(self):
        frame = self.make_frame(start="2025-01-01", source="yfinance", synthetic=False)

        report = build_advanced_report("6503.T", frame, capital_jpy=1_000_000, risk_pct=1)

        self.assertEqual(report["verdict"], "DEFENSIVE")
        self.assertFalse(report["dataQuality"]["priceOk"])
        self.assertEqual(report["dataQuality"]["priceFreshnessVerdict"], "stale")
        self.assertGreater(report["dataQuality"]["latestBarAgeDays"], 30)
        freshness_gate = next(item for item in report["guardrails"] if item["label"] == "直近日足が新鮮")
        self.assertFalse(freshness_gate["ok"])

    def test_short_history_is_rejected(self):
        frame = pd.DataFrame({"Close": [100, 101], "High": [101, 102], "Low": [99, 100], "Volume": [1, 1]})

        with self.assertRaises(ValueError):
            build_advanced_report("6503.T", frame)


if __name__ == "__main__":
    unittest.main()
