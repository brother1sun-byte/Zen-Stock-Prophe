import sys
import os
import shutil
import unittest
import json
import threading
from datetime import datetime
from fastapi.testclient import TestClient

# Add backend to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
import routers.performance

class TestDiaryAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        # Use a separate test data directory
        self.test_data_dir = os.path.join(os.path.dirname(__file__), "test_data_diary")
        os.makedirs(self.test_data_dir, exist_ok=True)
        # Override the base dir in the module for testing
        self.original_dir = routers.performance.DIARY_BASE_DIR
        routers.performance.DIARY_BASE_DIR = self.test_data_dir

    def tearDown(self):
        # Restore original dir
        routers.performance.DIARY_BASE_DIR = self.original_dir
        if os.path.exists(self.test_data_dir):
            shutil.rmtree(self.test_data_dir)

    def test_save_and_retrieve_diary(self):
        # 1. Save entry
        entry_data = {
            "date": "2026-02-08",
            "ticker": "7203.T",
            "scenario_type": "range",
            "planned_action": "Wait for signal",
            "actual_action": "Executed",
            "result": "win",
            "pnl_yen": 10000,
            "notes": "Test entry"
        }
        response = self.client.post("/api/diary", json=entry_data)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        
        saved_id = response.json()["entry"]["id"]
        
        # 2. Retrieve entry
        response = self.client.get("/api/diary?ticker=7203.T&from=2026-02-01&to=2026-02-28")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], saved_id)

    def test_monthly_partitioning(self):
        # Entries in different months
        dates = ["2026-01-15", "2026-02-08", "2026-03-01"]
        for d in dates:
            self.client.post("/api/diary", json={
                "date": d,
                "ticker": "9984.T",
                "scenario_type": "gap_up",
                "planned_action": "Buy",
                "actual_action": "Bought",
                "result": "win"
            })
            
        # Verify directory structure
        for d in dates:
            ym = d[:7]
            path = os.path.join(self.test_data_dir, ym, "9984.T.json")
            self.assertTrue(os.path.exists(path), f"File should exist: {path}")

        # Search covering all months
        response = self.client.get("/api/diary?ticker=9984.T&from=2026-01-01&to=2026-03-31")
        self.assertEqual(len(response.json()["items"]), 3)

    def test_validation_strict(self):
        # Invalid scenario type
        entry = {
            "date": "2026-02-08",
            "ticker": "7203.T",
            "scenario_type": "invalid",
            "planned_action": "x",
            "actual_action": "y",
            "result": "win"
        }
        response = self.client.post("/api/diary", json=entry)
        self.assertEqual(response.status_code, 422)

    def test_atomic_write_simulation(self):
        # Rapid saves to the same file
        ticker = "ATOMIC.T"
        def save():
            for i in range(5):
                self.client.post("/api/diary", json={
                    "date": "2026-02-08",
                    "ticker": ticker,
                    "scenario_type": "range",
                    "planned_action": f"A{i}",
                    "actual_action": "B",
                    "result": "skip"
                })

        threads = [threading.Thread(target=save) for _ in range(3)]
        for t in threads: t.start()
        for t in threads: t.join()

        response = self.client.get(f"/api/diary?ticker={ticker}")
        self.assertEqual(len(response.json()["items"]), 15)

if __name__ == "__main__":
    unittest.main()
