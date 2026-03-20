
import requests
import json
import os
import shutil
import time

LOG_PATH = r"c:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\backend\logs\ops_metrics_log.json"
BACKUP_PATH = LOG_PATH + ".bak"
API_URL = "http://localhost:8000/api/ops/metrics/history"

def main():
    print("--- Verify Ops Injection ---")
    
    # 1. Backup
    if os.path.exists(LOG_PATH):
        shutil.copy(LOG_PATH, BACKUP_PATH)
    
    try:
        # 2. Inject Data
        dummy_data = [
            {
                "timestamp": "2026-02-07T12:00:00",
                "latency": {"p50": 0.1, "p95": 0.5, "avg": 0.2, "max": 1.0},
                "rates": {"success": 100, "degraded": 0, "cache_hit": 50},
                "counts": {"total": 10, "error_429": 0}
            }
        ]
        with open(LOG_PATH, 'w', encoding='utf-8') as f:
            json.dump(dummy_data, f, indent=2)
        print("Injected dummy data.")
        
        # 3. Call API
        time.sleep(1) # Wait a bit
        try:
            res = requests.get(API_URL)
            print(f"API Status: {res.status_code}")
            data = res.json()
            print(f"API Data Length: {len(data)}")
            if len(data) > 0:
                print("SUCCESS: API returned injected data.")
            else:
                print("FAIL: API returned empty data.")
        except Exception as e:
            print(f"API Call Failed: {e}")

    finally:
        # 4. Restore
        if os.path.exists(BACKUP_PATH):
            shutil.move(BACKUP_PATH, LOG_PATH)
            print("Restored log.")

if __name__ == "__main__":
    main()
