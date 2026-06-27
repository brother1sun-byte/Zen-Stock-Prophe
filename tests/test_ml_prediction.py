import math
import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from ml_prediction import build_ml_prediction  # noqa: E402


class MlPredictionTests(unittest.TestCase):
    def make_frame(self, periods=180, *, source="yfinance", synthetic=False):
        start = pd.Timestamp.now().normalize() - pd.offsets.BDay(periods - 1)
        dates = pd.date_range(start, periods=periods, freq="B")
        closes = [
            100
            + index * 0.18
            + math.sin(index / 5) * 2.0
            + (1.8 if index % 17 in {0, 1, 2, 3, 4} else -0.4)
            for index in range(periods)
        ]
        frame = pd.DataFrame(
            {
                "Open": [value * 0.997 for value in closes],
                "High": [value * 1.018 for value in closes],
                "Low": [value * 0.984 for value in closes],
                "Close": closes,
                "Volume": [900_000 + (index % 13) * 45_000 for index in range(periods)],
            },
            index=dates,
        )
        frame.attrs["source"] = source
        frame.attrs["synthetic"] = synthetic
        return frame

    def test_market_history_builds_local_ml_verification_payload(self):
        report = build_ml_prediction("6503.T", self.make_frame())

        self.assertEqual(report["roleLabel"], "AI検証補助")
        self.assertIn(report["status"], {"usable", "review", "contradiction"})
        self.assertGreaterEqual(report["sampleCount"], 18)
        self.assertGreaterEqual(report["trainingSampleCount"], 100)
        self.assertGreaterEqual(report["probabilityUpPct"], 0)
        self.assertLessEqual(report["probabilityUpPct"], 100)
        self.assertIn("baselineHitRatePct", report)
        self.assertIn("edgePct", report)
        self.assertTrue(any(item["label"] == "確率だけで買い判断にしない" and item["ok"] for item in report["guardrails"]))
        self.assertIn("投資助言ではありません", report["disclaimer"])

    def test_short_history_is_insufficient(self):
        report = build_ml_prediction("6503.T", self.make_frame(periods=55))

        self.assertEqual(report["status"], "insufficient")
        self.assertEqual(report["label"], "データ不足")
        self.assertLess(report["sampleCount"], 70)
        self.assertTrue(report["warnings"])

    def test_synthetic_history_is_reference_only(self):
        report = build_ml_prediction("6503.T", self.make_frame(source="synthetic", synthetic=True))

        self.assertEqual(report["status"], "reference_only")
        self.assertEqual(report["label"], "参考表示")
        self.assertFalse(report["sourcePolicy"]["usableForMl"])
        self.assertTrue(report["sourcePolicy"]["synthetic"])
        self.assertTrue(any("補完データ" in warning for warning in report["warnings"]))
        self.assertEqual(report["probabilityUpPct"], 0)

    def test_cache_history_is_reference_only(self):
        frame = self.make_frame(source="cache")
        frame.attrs["cached"] = True

        report = build_ml_prediction("6503.T", frame)

        self.assertEqual(report["status"], "reference_only")
        self.assertTrue(report["sourcePolicy"]["cached"])
        self.assertTrue(any("一時保存データ" in warning for warning in report["warnings"]))


if __name__ == "__main__":
    unittest.main()
