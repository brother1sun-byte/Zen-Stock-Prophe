
import requests
import time

BASE_URL = "http://localhost:8000"

def test_prediction_creates_log():
    print("--- Testing Prediction & Log Creation ---")
    # 1. Trigger a prediction to generate a log entry
    payload = {
        "ticker": "7203",
        "period": "1d",
        "capital": 1000000,
        "entry_price": 3000,
        "shares": 100
    }
    try:
        response = requests.post(f"{BASE_URL}/predict", json=payload)
        if response.status_code == 200:
            print("Prediction successful.")
            data = response.json()
            print(f"Decision: {data['recommendation']}")
            print(f"Super Score: {data.get('super_score', 'N/A')}")
        else:
            print(f"Prediction Failed: {response.text}")
    except Exception as e:
        print(f"Error calling predict: {e}")

def test_analytics_endpoints():
    print("\n--- Testing Analytics Endpoints ---")
    endpoints = ["/api/analytics/reasons", "/api/analytics/market-phases", "/api/analytics/trends"]
    
    for ep in endpoints:
        try:
            res = requests.get(f"{BASE_URL}{ep}")
            if res.status_code == 200:
                print(f"Success {ep}: {len(res.json())} items")
                if len(res.json()) > 0:
                    print(f"Sample: {res.json()[0]}")
            else:
                print(f"Failed {ep}: {res.status_code}")
        except Exception as e:
            print(f"Error calling {ep}: {e}")

if __name__ == "__main__":
    # Wait a bit for server reload if needed
    time.sleep(2)
    test_prediction_creates_log()
    time.sleep(1) # Wait for file write
    test_analytics_endpoints()
