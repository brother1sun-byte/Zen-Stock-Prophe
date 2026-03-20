import requests
import json
import time

def verify_v21():
    url = "http://localhost:8000/predict"
    payload = {
        "ticker": "9984",
        "period": "1mo",
        "capital": 1000000.0
    }
    
    print("--- Phase 21 Component Verification ---")
    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        
        # 1. Signage & Decision Logic
        dt = data.get("day_trading", {})
        print(f"Decision Sign: {dt.get('action_text')} ({dt.get('decision')})")
        print(f"Final Action: {dt.get('final_action_line')}")
        print(f"Reasoning: {dt.get('reasoning_list')}")
        
        # 2. Lot Calculation Verification
        lot = dt.get("lot_management", {})
        capital = lot.get("capital")
        allowed_loss = lot.get("allowed_loss")
        expected_allowed = capital * 0.004
        
        print(f"\nLot Management (Capital: {capital:,.0f} JPY):")
        print(f" - Allowed Loss (0.4%): {allowed_loss:,.0f} JPY (Expected: {expected_allowed:,.0f})")
        print(f" - Recommended Shares: {lot.get('shares')}")
        
        # 3. Terminology Check
        terms = dt.get("terminology", {})
        print("\nTerminology Check (Japanese (English)):")
        for key, val in terms.items():
            print(f" - {key}: {val}")
            
        # 4. Goal Consistency Check
        goal = dt.get("goal_consistency", {})
        print(f"\nGoal Consistency (10,000 JPY):")
        print(f" - Expected Profit: {goal.get('expected_profit'):,.0f} JPY")
        print(f" - Goal Met: {goal.get('is_goal_met')}")
        print(f" - Status: {goal.get('goal_status')}")
        
        # 5. Data Gaps
        print(f"\nData Gaps / Suggestions: {dt.get('data_gaps')}")

        # Verification result
        if dt.get('decision') in ["BUY", "WAIT", "NO TRADE"] and "（" in terms.get("market_regime", ""):
            print("\n✅ Phase 21 Verification SUCCESS")
        else:
            print("\n❌ Phase 21 Verification FAILURE - Missing decision or terminology format")

    except Exception as e:
        print(f"Verification Error: {e}")

if __name__ == "__main__":
    # Wait a bit for server to be ready if needed, but assuming it's already running
    verify_v21()
