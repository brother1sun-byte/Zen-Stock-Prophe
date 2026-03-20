import unittest
import os
import json
import shutil
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient
from main import app
import routers.performance

class TestPortfolioAPI(unittest.TestCase):
    def setUp(self):
        """Set up test environment."""
        self.client = TestClient(app)
        self.test_data_dir = os.path.join(os.path.dirname(__file__), "test_data_portfolio")
        os.makedirs(self.test_data_dir, exist_ok=True)
        
        # Override portfolio file path
        self.original_portfolio_file = routers.performance.PORTFOLIO_FILE
        routers.performance.PORTFOLIO_FILE = os.path.join(self.test_data_dir, "portfolio.json")
    
    def tearDown(self):
        """Clean up test environment."""
        routers.performance.PORTFOLIO_FILE = self.original_portfolio_file
        if os.path.exists(self.test_data_dir):
            shutil.rmtree(self.test_data_dir)
    
    def test_get_portfolio_empty(self):
        """Test GET /api/portfolio when no portfolio exists."""
        response = self.client.get("/api/portfolio")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["tickers"], [])
        self.assertIn("updated_at", data)
    
    def test_save_and_get_portfolio(self):
        """Test POST and GET /api/portfolio."""
        # Save portfolio
        tickers = ["7203.T", "9101.T", "6758.T"]
        response = self.client.post("/api/portfolio", json={"tickers": tickers})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["tickers"], tickers)
        
        # Get portfolio
        response = self.client.get("/api/portfolio")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["tickers"], tickers)
    
    def test_duplicate_removal(self):
        """Test that duplicate tickers are removed."""
        tickers = ["7203.T", "9101.T", "7203.T", "6758.T", "9101.T"]
        response = self.client.post("/api/portfolio", json={"tickers": tickers})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # Should have 3 unique tickers
        self.assertEqual(len(data["tickers"]), 3)
        self.assertIn("7203.T", data["tickers"])
        self.assertIn("9101.T", data["tickers"])
        self.assertIn("6758.T", data["tickers"])
    
    def test_ticker_limit(self):
        """Test that exceeding 50 tickers returns 422 (Pydantic validation)."""
        tickers = [f"TICK{i}.T" for i in range(51)]
        response = self.client.post("/api/portfolio", json={"tickers": tickers})
        self.assertEqual(response.status_code, 422)  # Pydantic validation error
    
    def test_empty_tickers_allowed(self):
        """Test that empty ticker list is allowed."""
        response = self.client.post("/api/portfolio", json={"tickers": []})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["tickers"], [])
    
    def test_invalid_ticker_format(self):
        """Test that invalid ticker format is rejected."""
        tickers = ["7203.T", "INVALID@TICKER", "9101.T"]
        response = self.client.post("/api/portfolio", json={"tickers": tickers})
        self.assertEqual(response.status_code, 422)  # Validation error

if __name__ == "__main__":
    unittest.main()
