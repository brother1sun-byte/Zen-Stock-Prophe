
import requests
import time
import os
import json

BASE_URL = "http://localhost:8000"

def test_ops_endpoints():
    print("--- Testing Ops Metrics Endpoints ---")
    
    # 1. Trigger some requests to ensure the manager is active (though they won't show in logs until flush)
    try:
        requests.get(f"{BASE_URL}/") 
        requests.get(f"{BASE_URL}/docs")
    except: pass

    # 2. Check Latest
    url = f"{BASE_URL}/api/ops/metrics/latest"
    try:
        res = requests.get(url)
        print(f"GET {url} -> {res.status_code}")
        print(f"Body: {res.text}")
        if res.status_code != 200:
            print("FAIL: Expected 200")
            return
    except Exception as e:
        print(f"FAIL: {e}")
        return

    # 3. Check History
    url = f"{BASE_URL}/api/ops/metrics/history"
    try:
        res = requests.get(url)
        print(f"GET {url} -> {res.status_code}")
        print(f"Body (len): {len(res.json())}")
        if res.status_code != 200:
            print("FAIL: Expected 200")
            return
    except Exception as e:
        print(f"FAIL: {e}")
        return

if __name__ == "__main__":
    # Wait for server reload
    time.sleep(2) 
    test_ops_endpoints()
