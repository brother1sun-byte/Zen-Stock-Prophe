import math
import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from advanced_analysis import build_advanced_report  # noqa: E402


class AdvancedAnalysisTests(unittest.TestCase):
    def test_report_contains_probabilistic_and_position_outputs(self):
        dates = pd.date_range("2026-01-01", periods=90, freq="B")
        closes = [100 + index * 0.55 + math.sin(index / 4) * 1.8 for index in range(90)]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.996 for value in closes],
                "High": [value * 1.015 for value in closes],
                "Low": [value * 0.985 for value in closes],
                "Close": closes,
                "Volume": [220000 + index * 1800 for index in range(90)],
            },
            index=dates,
        )

        report = build_advanced_report("6503.T", frame, capital_jpy=1_000_000, risk_pct=1)

        self.assertEqual(report["ticker"], "6503.T")
        self.assertIn(report["verdict"], {"ADVANCED_READY", "WATCHLIST", "DEFENSIVE"})
        self.assertGreater(report["compositeScore"], 50)
        self.assertEqual(report["monteCarlo"]["sampleCount"], 1200)
        self.assertEqual(len(report["scenarios"]), 3)
        self.assertIn("riskReward", report["positionPlan"])
        self.assertTrue(any(item["label"] == "RR 1.4以上" for item in report["guardrails"]))

    def test_short_history_is_rejected(self):
        frame = pd.DataFrame({"Close": [100, 101], "High": [101, 102], "Low": [99, 100], "Volume": [1, 1]})

        with self.assertRaises(ValueError):
            build_advanced_report("6503.T", frame)


if __name__ == "__main__":
    unittest.main()
