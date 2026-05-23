import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import server  # noqa: E402


def make_history(closes: list[float]) -> pd.DataFrame:
    today = pd.Timestamp(server.dt.date.today())
    prior_dates = pd.date_range(end=today - pd.Timedelta(days=1), periods=max(len(closes) - 1, 0), freq="B")
    dates = prior_dates.append(pd.DatetimeIndex([today]))
    return pd.DataFrame(
        {
            "Open": [price * 0.995 for price in closes],
            "High": [price * 1.012 for price in closes],
            "Low": [price * 0.988 for price in closes],
            "Close": closes,
            "Volume": [620_000 + index * 8_000 for index, _ in enumerate(closes)],
        },
        index=dates,
    )


class PortfolioExitPlanTests(unittest.TestCase):
    def test_exit_plan_scales_out_after_gain_reaches_first_target(self):
        closes = [2220 + index * 8.2 + math.sin(index / 4) * 18 for index in range(80)]
        closes[-1] = 2880
        hist = make_history(closes)

        plan = server.build_exit_plan(
            ticker="4980.T",
            shares=100,
            avg_cost=2648,
            hist=hist,
            market_context={"tone": "NORMAL", "riskOff": False, "summary": "normal"},
        )

        self.assertEqual(plan["action"], "SCALE_OUT")
        self.assertEqual(plan["sellReviewShares"], 100)
        self.assertGreaterEqual(plan["targetPrice"], 2859)
        self.assertGreater(plan["stopLoss"], 2648)
        self.assertIn("5日", plan["marketResearch"][0]["label"])

    def test_exit_plan_marks_risk_exit_when_cost_basis_breaks(self):
        closes = [2820 - index * 4 for index in range(80)]
        closes[-1] = 2480
        hist = make_history(closes)

        plan = server.build_exit_plan(
            ticker="4980.T",
            shares=100,
            avg_cost=2648,
            hist=hist,
            market_context={"tone": "RISK_OFF", "riskOff": True, "summary": "risk off"},
        )

        self.assertEqual(plan["action"], "RISK_EXIT")
        self.assertFalse(plan["holdAllowed"])
        self.assertLess(plan["reviewPrice"], 2648)

    def test_manual_position_api_records_holding_and_returns_exit_plan(self):
        hist = make_history([2500 + index * 5 for index in range(80)])
        old_db = server.DB_PATH
        with tempfile.TemporaryDirectory() as tmp:
            server.DB_PATH = Path(tmp) / "simulator.db"
            try:
                server.init_db()
                client = TestClient(server.app)
                with patch.object(server, "get_stock_data", return_value=hist):
                    response = client.post(
                        "/api/portfolio/positions",
                        json={
                            "ticker": "4980",
                            "name": "デクセリアルズ",
                            "shares": 100,
                            "entryPrice": 2648,
                            "note": "本日買付",
                        },
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.json()["success"])

                    portfolio = client.get("/api/portfolio").json()

                holding = next(item for item in portfolio["holdings"] if item["ticker"] == "4980.T")
                self.assertEqual(holding["shares"], 100)
                self.assertEqual(holding["avgCost"], 2648)
                self.assertEqual(holding["entryNotional"], 264800)
                self.assertIn("exitPlan", holding)
                self.assertEqual(holding["exitPlan"]["source"], "local_market_research")
            finally:
                server.DB_PATH = old_db

    def test_portfolio_lifecycle_keeps_closed_holding_in_ledger(self):
        hist = make_history([2500 + index * 5 for index in range(80)])
        old_db = server.DB_PATH
        with tempfile.TemporaryDirectory() as tmp:
            server.DB_PATH = Path(tmp) / "simulator.db"
            try:
                server.init_db()
                client = TestClient(server.app)
                with patch.object(server, "get_stock_data", return_value=hist):
                    create_response = client.post(
                        "/api/portfolio/positions",
                        json={
                            "ticker": "4980",
                            "name": "デクセリアルズ",
                            "shares": 100,
                            "entryPrice": 2648,
                            "note": "manual test entry",
                        },
                    )
                    self.assertEqual(create_response.status_code, 200)

                    close_response = client.post(
                        "/api/portfolio/positions/4980/lifecycle",
                        json={
                            "action": "VOIDED",
                            "reason": "入力ミスの訂正",
                        },
                    )
                    self.assertEqual(close_response.status_code, 200)
                    self.assertEqual(close_response.json()["status"], "VOIDED")

                    portfolio = client.get("/api/portfolio").json()
                    transactions = client.get("/api/transactions").json()

                self.assertFalse([item for item in portfolio["holdings"] if item["ticker"] == "4980.T"])
                ledger_item = next(item for item in portfolio["archivedHoldings"] if item["ticker"] == "4980.T")
                self.assertEqual(ledger_item["status"], "VOIDED")
                self.assertEqual(ledger_item["lifecycleReason"], "入力ミスの訂正")
                self.assertTrue(any(item["action"] == "MANUAL_VOID" for item in transactions))
            finally:
                server.DB_PATH = old_db

    def test_sold_lifecycle_adds_cash_and_keeps_ledger_history(self):
        hist = make_history([2500 + index * 5 for index in range(80)])
        old_db = server.DB_PATH
        with tempfile.TemporaryDirectory() as tmp:
            server.DB_PATH = Path(tmp) / "simulator.db"
            try:
                server.init_db()
                client = TestClient(server.app)
                with patch.object(server, "get_stock_data", return_value=hist):
                    client.post(
                        "/api/portfolio/positions",
                        json={
                            "ticker": "4980",
                            "shares": 100,
                            "entryPrice": 2000,
                            "note": "manual test entry",
                        },
                    )
                    close_response = client.post(
                        "/api/portfolio/positions/4980.T/lifecycle",
                        json={
                            "action": "SOLD",
                            "price": 2500,
                            "reason": "売却済み",
                        },
                    )
                    self.assertEqual(close_response.status_code, 200)
                    portfolio = client.get("/api/portfolio").json()

                self.assertEqual(portfolio["cash"], 1_050_000)
                self.assertFalse(portfolio["holdings"])
                self.assertEqual(portfolio["archivedHoldings"][0]["status"], "SOLD")
            finally:
                server.DB_PATH = old_db

    def test_stock_detail_reports_freshness_and_recent_window(self):
        hist = make_history([2500 + index * 5 for index in range(80)])
        with patch.object(server, "get_stock_data", return_value=hist):
            detail = server.get_stock_detail("4980.T")

        self.assertEqual(detail["latestBarDate"], pd.Timestamp(server.dt.date.today()).date().isoformat())
        self.assertTrue(detail["freshness"]["priceOk"])
        self.assertIn("priceChangePct", detail["recentWindow"])
        self.assertIn("volumeRatio", detail["recentWindow"])
        self.assertGreater(detail["changePct"], 0)


if __name__ == "__main__":
    unittest.main()
