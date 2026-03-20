
import os
import json
import time
import shutil
from datetime import datetime, timedelta
from ops_manager import OpsMetricsManager

LOG_DIR = "test_ops_logs"
if os.path.exists(LOG_DIR):
    shutil.rmtree(LOG_DIR)
os.makedirs(LOG_DIR)

def test_ops_logic():
    print("--- Testing OpsMetricsManager Logic ---")
    
    # 1. Init
    mgr = OpsMetricsManager(LOG_DIR)
    # Override flush interval for testing
    mgr.FLUSH_INTERVAL_SECONDS = 2 
    
    # 2. Record Requests (Predict & Other)
    print("Recording requests...")
    mgr.record_request(0.5, 200, "predict")
    mgr.record_request(0.1, 200, "predict")
    mgr.record_request(1.5, 200, "other")
    
    # Check log (Should be empty)
    with open(mgr.log_path, 'r') as f:
        data = json.load(f)
        if len(data) != 0:
            print("FAIL: Log should be empty before flush interval.")
            return

    # 3. Wait & Trigger Flush
    print("Waiting for interval (plus margin)...")
    time.sleep(2.5)
    
    # Trigger with new request
    mgr.record_request(0.2, 200, "predict")
    
    # Check log (Should have 1 entry)
    with open(mgr.log_path, 'r') as f:
        data = json.load(f)
        if len(data) == 1:
            print("SUCCESS: Flush triggered.")
            entry = data[0]
            print(f"Snapshot Keys: {entry['routes'].keys()}")
            
            # Verify Predict Stats
            pred = entry["routes"]["predict"]
            # We had 0.5, 0.1 before flush trigger. 
            # Wait, record_request with time > interval triggers flush of PREVIOUS data?
            # My logic: 
            # 1. Add to buffer.
            # 2. Check time. If elapsed > interval, flush.
            # So the triggering request (0.2) is included in the flush?
            # No, `buffer` includes it. 
            # Then `flush_metrics` clears buffer.
            # So yes, 0.2 is included.
            # Latencies: 0.5, 0.1, 0.2 -> Avg 0.266
            print(f"Predict Avg Latency: {pred['latency']['avg']}")
            
            if "predict" in entry["routes"] and "other" in entry["routes"]:
                print("SUCCESS: Route Segregation Verified.")
            else:
                print("FAIL: Missing route keys.")
        else:
            print(f"FAIL: Expected 1 entry, got {len(data)}")

if __name__ == "__main__":
    try:
        test_ops_logic()
    finally:
        # Cleanup
        if os.path.exists(LOG_DIR):
            shutil.rmtree(LOG_DIR)
