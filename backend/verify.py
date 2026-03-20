import requests
import json

BASE_URL = "http://localhost:8000"

def test_3digit_ticker():
    print("--- Testing 3-Digit Ticker (830) ---")
    url = f"{BASE_URL}/api/predict"
    payload = {"ticker": "830", "asof": "2026-02-20"}
    
    try:
        res = requests.post(url, json=payload)
        print(f"Status Code: {res.status_code}")
        if res.status_code == 400:
            data = res.json()
            print("Response:", json.dumps(data, indent=2, ensure_ascii=False))
            if "candidates" in data.get("detail", {}):
                print("SUCCESS: Candidates returned.")
            else:
                print("FAILURE: No candidates found in error detail.")
        else:
            print(f"FAILURE: Unexpected status code {res.status_code}")
            print(res.text)
    except Exception as e:
        print(f"ERROR: {e}")

def test_hot_picks():
    print("\n--- Testing Hot Picks ---")
    url = f"{BASE_URL}/api/hot-picks"
    try:
        res = requests.get(url)
        print(f"Status Code: {res.status_code}")



        if res.status_code == 200:
            data = res.json()
            picks = []
            if isinstance(data, dict) and "picks" in data:
                picks = data["picks"]
                print(f"Response is Dict. Picks Count: {len(picks)}")
            elif isinstance(data, list):
                picks = data
                print(f"Response is List. Picks Count: {len(picks)}")
            
            for item in picks:
                print(f"- {item.get('ticker')}: {item.get('reason')} (Confidence: {item.get('confidence')})")
            
            # Check for fallback
            if any(item.get("reason") == "Analyst Watch (Fallback)" for item in picks):
                 print("SUCCESS: Fallback picks detected.")
            else:
                 print("INFO: Live picks returned (verify count >= 3).")

        else:
            print(f"FAILURE: Unexpected status code {res.status_code}")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    test_3digit_ticker()
    test_hot_picks()
