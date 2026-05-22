import unittest

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from alert_engine import evaluate_stock_alert  # noqa: E402


class AlertEngineTests(unittest.TestCase):
    def test_waiting_stock_alerts_when_limit_is_close(self):
        item = evaluate_stock_alert(
            ticker="1803.T",
            stock_info={"name": "清水建設", "candidate_score": 94},
            analysis={
                "signal": "WAIT",
                "confidence": 70,
                "reason": "指値まで待つ",
                "execution": {"decision": "WAIT_FOR_PULLBACK", "entryGapPct": -1.2},
                "strategy": {"buy_limit": 1000, "sell_limit": 1120, "stop_loss": 960, "rr_ratio": 3},
            },
            current_price=1012,
            market_context={"riskOff": False},
        )

        self.assertTrue(item["notify"])
        self.assertEqual(item["severity"], "SOON")

    def test_waiting_stock_does_not_alert_when_limit_is_far(self):
        item = evaluate_stock_alert(
            ticker="1803.T",
            stock_info={"name": "清水建設", "candidate_score": 94},
            analysis={
                "signal": "WAIT",
                "confidence": 70,
                "reason": "指値まで待つ",
                "execution": {"decision": "WAIT_FOR_PULLBACK", "entryGapPct": -8.0},
                "strategy": {"buy_limit": 1000, "sell_limit": 1120, "stop_loss": 960, "rr_ratio": 3},
            },
            current_price=1080,
            market_context={"riskOff": False},
        )

        self.assertFalse(item["notify"])
        self.assertEqual(item["severity"], "WAIT")

    def test_risk_off_market_keeps_alert_but_marks_caution(self):
        item = evaluate_stock_alert(
            ticker="4911.T",
            stock_info={"name": "資生堂", "candidate_score": 99},
            analysis={
                "signal": "BUY",
                "confidence": 75,
                "reason": "指値圏内",
                "execution": {"decision": "BUY_LIMIT_OK", "entryGapPct": -0.2},
                "strategy": {"buy_limit": 1000, "sell_limit": 1120, "stop_loss": 960, "rr_ratio": 3},
            },
            current_price=998,
            market_context={"riskOff": True},
        )

        self.assertTrue(item["notify"])
        self.assertEqual(item["severity"], "MARKET_CAUTION")


if __name__ == "__main__":
    unittest.main()
