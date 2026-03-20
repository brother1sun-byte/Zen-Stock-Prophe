import requests
import json
import time

BASE_URL = "http://127.0.0.1:8000"

def test_health():
    print("Testing Health Check...")
    res = requests.get(f"{BASE_URL}/")
    print(f"Status: {res.status_code}, Body: {res.json()}")
    assert res.status_code == 200

def test_prediction_basic():
    print("\nTesting Basic Prediction (Toyota 7203)...")
    payload = {"ticker": "7203", "period": "7d"}
    res = requests.post(f"{BASE_URL}/predict", json=payload)
    data = res.json()
    print(f"Status: {res.status_code}")
    print(f"Company: {data.get('company_name')}")
    print(f"Price: {data.get('current_price')}")
    print(f"Last Sync: {data.get('last_sync')}")
    assert res.status_code == 200
    assert "last_sync" in data

def test_exit_strategy():
    print("\nTesting Exit Strategy Logic...")
    payload = {
        "ticker": "7203", 
        "period": "7d",
        "entry_price": 2500.0,
        "shares": 100
    }
    res = requests.post(f"{BASE_URL}/predict", json=payload)
    data = res.json()
    print(f"Status: {res.status_code}")
    exit_strat = data.get("exit_strategy")
    if exit_strat:
        print(f"PNL: {exit_strat['current_status']['pnl']}")
        print(f"Candidates: {len(exit_strat['candidates'])}")
        for cand in exit_strat['candidates']:
            print(f" - {cand['label']}: ¥{cand['price']}")
    assert res.status_code == 200
    assert exit_strat is not None

if __name__ == "__main__":
    try:
        test_health()
        test_prediction_basic()
        test_exit_strategy()
        print("\n[SUCCESS] Backend Verification Passed.")
    except Exception as e:
        print(f"\n[FAILURE] {e}")
