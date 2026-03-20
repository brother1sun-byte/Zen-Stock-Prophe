import sys
import os
import shutil
import unittest
import json
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

# Add backend to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
import routers.performance

class TestScoringAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.test_data_dir = os.path.join(os.path.dirname(__file__), "test_data_scoring")
        os.makedirs(self.test_data_dir, exist_ok=True)
        self.original_dir = routers.performance.DIARY_BASE_DIR
        routers.performance.DIARY_BASE_DIR = self.test_data_dir

    def tearDown(self):
        routers.performance.DIARY_BASE_DIR = self.original_dir
        if os.path.exists(self.test_data_dir):
            shutil.rmtree(self.test_data_dir)

    def test_scoring_empty_data(self):
        response = self.client.get("/api/scoring?ticker=7203.T&asof=2026-02-08")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["total_entries"], 0)
        self.assertEqual(data["win_rate"], 0)
        self.assertEqual(data["execution_rate"], 0)

    def test_scoring_mixed_results(self):
        ticker = "MIXED.T"
        # Create entries: 1 win, 1 loss, 1 skip on Feb 08, 07, 06
        entries = [
            {"date": "2026-02-08", "ticker": ticker, "result": "win", "scenario_type": "range", "planned_action": "a", "actual_action": "b"},
            {"date": "2026-02-07", "ticker": ticker, "result": "loss", "scenario_type": "range", "planned_action": "a", "actual_action": "b"},
            {"date": "2026-02-06", "ticker": ticker, "result": "skip", "scenario_type": "range", "planned_action": "a", "actual_action": "b"}
        ]
        # Save to Feb directory
        feb_dir = os.path.join(self.test_data_dir, "2026-02")
        os.makedirs(feb_dir, exist_ok=True)
        with open(os.path.join(feb_dir, f"{ticker}.json"), "w") as f:
            json.dump(entries, f)

        response = self.client.get(f"/api/scoring?ticker={ticker}&asof=2026-02-08")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total_entries"], 3)
        self.assertEqual(data["total_trades"], 2) # excluding skip
        self.assertEqual(data["win_count"], 1)
        self.assertEqual(data["win_rate"], 0.5) # 1/2
        self.assertEqual(data["execution_rate"], round(2/3, 4))
        self.assertEqual(data["skip_rate"], round(1/3, 4))

    def test_scoring_month_crossing(self):
        ticker = "CROSS.T"
        jan_entries = [{"date": "2026-01-31", "ticker": ticker, "result": "win", "scenario_type": "range", "planned_action": "a", "actual_action": "b"}]
        feb_entries = [{"date": "2026-02-01", "ticker": ticker, "result": "skip", "scenario_type": "range", "planned_action": "a", "actual_action": "b"}]
        
        jan_dir = os.path.join(self.test_data_dir, "2026-01")
        feb_dir = os.path.join(self.test_data_dir, "2026-02")
        os.makedirs(jan_dir, exist_ok=True); os.makedirs(feb_dir, exist_ok=True)
        
        with open(os.path.join(jan_dir, f"{ticker}.json"), "w") as f: json.dump(jan_entries, f)
        with open(os.path.join(feb_dir, f"{ticker}.json"), "w") as f: json.dump(feb_entries, f)

        response = self.client.get(f"/api/scoring?ticker={ticker}&asof=2026-02-02")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total_entries"], 2)
        self.assertEqual(data["total_trades"], 1)
        self.assertEqual(data["win_rate"], 1.0)

    def test_aggregate_scoring(self):
        # Ticker A: 2 trades (1 win), Ticker B: 1 trade (1 win)
        ticker_a = "TIC_A.T"; ticker_b = "TIC_B.T"
        feb_dir = os.path.join(self.test_data_dir, "2026-02")
        os.makedirs(feb_dir, exist_ok=True)
        
        with open(os.path.join(feb_dir, f"{ticker_a}.json"), "w") as f:
            json.dump([
                {"date": "2026-02-08", "ticker": ticker_a, "result": "win", "scenario_type": "gap_up", "planned_action": "a", "actual_action": "b"},
                {"date": "2026-02-07", "ticker": ticker_a, "result": "loss", "scenario_type": "range", "planned_action": "a", "actual_action": "b"}
            ], f, indent=4)
        with open(os.path.join(feb_dir, f"{ticker_b}.json"), "w") as f:
            json.dump([
                {"date": "2026-02-08", "ticker": ticker_b, "result": "win", "scenario_type": "range", "planned_action": "a", "actual_action": "b"}
            ], f, indent=4)

        response = self.client.get(f"/api/scoring/aggregate?tickers={ticker_a},{ticker_b}&asof=2026-02-08")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total_entries"], 3)
        self.assertEqual(data["total_trades"], 3)
        self.assertEqual(data["win_count"], 2) # A(1) + B(1)
        self.assertEqual(data["win_rate"], round(2/3, 4))
        self.assertEqual(data["tickers_count"], 2)
        self.assertEqual(len(data["per_ticker"]), 2)

    def test_rule_scoring(self):
        ticker = "RULE.T"
        feb_dir = os.path.join(self.test_data_dir, "2026-02")
        os.makedirs(feb_dir, exist_ok=True)
        
        entries = [
            {"date": "2026-02-08", "ticker": ticker, "result": "win", "scenario_type": "gap_up", "planned_action": "a", "actual_action": "b"},
            {"date": "2026-02-07", "ticker": ticker, "result": "loss", "scenario_type": "gap_up", "planned_action": "a", "actual_action": "b"},
            {"date": "2026-02-06", "ticker": ticker, "result": "win", "scenario_type": "range", "planned_action": "a", "actual_action": "b"}
        ]
        with open(os.path.join(feb_dir, f"{ticker}.json"), "w") as f:
            json.dump(entries, f, indent=4)

        response = self.client.get(f"/api/scoring/by_rule?ticker={ticker}&asof=2026-02-08")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("gap_up", data["rules"])
        self.assertEqual(data["rules"]["gap_up"]["total_trades"], 2)
        self.assertEqual(data["rules"]["gap_up"]["win_rate"], 0.5)
        self.assertEqual(data["rules"]["range"]["total_trades"], 1)
        self.assertEqual(data["rules"]["range"]["win_rate"], 1.0)

if __name__ == "__main__":
    unittest.main()
