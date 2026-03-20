import requests
import json
import time

BASE_URL = "http://localhost:8000/api"

def test_market_ranking():
    print("\n--- Testing Market Ranking ---")
    markets = ["JP", "US", "CRYPTO"]
    for m in markets:
        print(f"Fetching ranking for {m}...")
        try:
            res = requests.get(f"{BASE_URL}/market_ranking?market={m}", timeout=30)
            res.raise_for_status()
            data = res.json()
            print(f"Success! Top Gainer: {data['top_gainers'][0]['ticker']} ({data['top_gainers'][0]['change_pct']:.2f}%)")
            print(f"Top Loser: {data['top_losers'][0]['ticker']} ({data['top_losers'][0]['change_pct']:.2f}%)")
        except Exception as e:
            print(f"Error fetching {m} ranking: {e}")

def test_scan_zen_multimarket():
    print("\n--- Testing Zen Scan Multi-Market ---")
    markets = ["JP", "US", "CRYPTO"]
    for m in markets:
        print(f"Scanning market {m} for Zen signals...")
        try:
            res = requests.get(f"{BASE_URL}/scan_zen?market={m}", timeout=60)
            res.raise_for_status()
            data = res.json()
            print(f"Found {data['signals_count']} signals in {m}.")
            if data['signals']:
                first = data['signals'][0]
                analysis = first['analysis']
                print(f"Sample: {first['ticker']} - BB Squeeze: {analysis['conditions']['bb_squeeze']}, Consecutive Growth: {analysis['conditions']['consecutive_growth']}")
        except Exception as e:
            print(f"Error scanning {m}: {e}")

if __name__ == "__main__":
    # Ensure backend is running before testing
    try:
        test_market_ranking()
        test_scan_zen_multimarket()
    except Exception as e:
        print(f"Test failed: {e}")
