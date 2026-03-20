
import requests
import json
import os
import shutil

BASE_URL = "http://localhost:8000"
LOG_PATH = r"c:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\backend\logs\self_improve.json"
BACKUP_PATH = LOG_PATH + ".bak"

def print_response(name, url):
    try:
        res = requests.get(url)
        print(f"\n--- {name} ({res.status_code}) ---")
        try:
            data = res.json()
            # If list, print first 2 items
            if isinstance(data, list):
                print(json.dumps(data[:2], indent=2, ensure_ascii=False))
            else:
                print(json.dumps(data, indent=2, ensure_ascii=False))
        except:
            print(res.text)
    except Exception as e:
        print(f"Error: {e}")

def main():
    print("=== 1. Testing Populated Data (Current State) ===")
    print_response("Reasons", f"{BASE_URL}/api/analytics/reasons")
    print_response("Market Phases", f"{BASE_URL}/api/analytics/market-phases")
    print_response("Trends", f"{BASE_URL}/api/analytics/trends")

    print("\n=== 2. Testing Empty Data (Simulated) ===")
    # Backup existing log
    if os.path.exists(LOG_PATH):
        shutil.copy(LOG_PATH, BACKUP_PATH)
        # Create empty log
        with open(LOG_PATH, 'w', encoding='utf-8') as f:
            json.dump({"sessions": []}, f)
    
    try:
        print_response("Reasons (Empty)", f"{BASE_URL}/api/analytics/reasons")
        print_response("Market Phases (Empty)", f"{BASE_URL}/api/analytics/market-phases")
        print_response("Trends (Empty)", f"{BASE_URL}/api/analytics/trends")
    finally:
        # Restore log
        if os.path.exists(BACKUP_PATH):
            shutil.move(BACKUP_PATH, LOG_PATH)
            print("\n[Restored Check] Log file restored.")

if __name__ == "__main__":
    main()
