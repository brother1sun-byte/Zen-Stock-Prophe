import requests
import json

BASE_URL = "http://localhost:8000/api"

def test_market_ranking(market):
    print(f"Testing /market_ranking?market={market}...")
    try:
        response = requests.get(f"{BASE_URL}/market_ranking", params={"market": market})
        response.raise_for_status()
        data = response.json()
        print(f"Success! Found {len(data.get('top_gainers', []))} gainers and {len(data.get('top_losers', []))} losers.")
        # print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Error testing ranking for {market}: {e}")

def test_scan_zen(market):
    print(f"Testing /scan_zen?market={market}...")
    try:
        response = requests.get(f"{BASE_URL}/scan_zen", params={"market": market})
        response.raise_for_status()
        data = response.json()
        print(f"Success! Found {len(data)} signals for {market}.")
        if data:
            first = data[0]
            print(f"Sample signal: {first.get('ticker')} (BB Squeeze: {first.get('bb_squeeze')}, 3+ Green: {first.get('consecutive_positive')})")
    except Exception as e:
        print(f"Error testing scan_zen for {market}: {e}")

if __name__ == "__main__":
    markets = ["JP", "US", "CRYPTO"]
    for m in markets:
        test_market_ranking(m)
        test_scan_zen(m)
