
import requests
import json
import os

LOG_PATH = r"c:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\backend\logs\ops_metrics_log.json"
ARTIFACTS_DIR = r"C:\Users\BRB33\.gemini\antigravity\brain\03b8cffd-9a5a-4df8-a649-32cc52a8c74a"
API_BASE = "http://localhost:8000"

def collect_raw_evidence():
    print("=== Phase 8 RAW Verification Evidence ===")
    
    # (A') Log Record (Last one, full)
    print("\n[A'] ops_metrics_log.json (Last Record):")
    try:
        with open(LOG_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if data:
                print(json.dumps(data[-1], indent=2))
            else:
                print("Log is empty.")
    except Exception as e:
        print(f"Error reading log: {e}")

    # (B') API Responses
    print("\n[B'] GET /api/ops/metrics/latest:")
    try:
        res = requests.get(f"{API_BASE}/api/ops/metrics/latest")
        print(json.dumps(res.json(), indent=2))
    except Exception as e:
        print(f"Error calling API: {e}")

    print("\n[B'] GET /api/ops/metrics/history?hours=24 (Last Item):")
    try:
        res = requests.get(f"{API_BASE}/api/ops/metrics/history?hours=24")
        history = res.json()
        if history:
             print(json.dumps(history[-1], indent=2))
        else:
             print("[]")
    except Exception as e:
        print(f"Error calling API: {e}")

    # (C') Artifact Existence
    print("\n[C'] Artifact Directory Listing:")
    try:
        files = os.listdir(ARTIFACTS_DIR)
        for f in files:
            if "phase8_ops_dashboard.png" in f:
                size = os.path.getsize(os.path.join(ARTIFACTS_DIR, f))
                print(f"FOUND: {f} (Size: {size} bytes)")
    except Exception as e:
        print(f"Error listing artifacts: {e}")

if __name__ == "__main__":
    collect_raw_evidence()
