import requests
import json

def verify_standby():
    url = "http://127.0.0.1:8000/predict"
    payload = {"ticker": "7203", "period": "1y", "capital": 500000}
    res = requests.post(url, json=payload, timeout=30)
    data = res.json()
    
    print(f"Status: {res.status_code}")
    print(f"Decision: {data['day_trading']['decision']}")
    print(f"Win Rate: {data['day_trading']['risk_management']['win_rate_estimate']}")
    print(f"Shares: {data['day_trading']['lot_management']['shares']}")
    print(f"Market Open: {data['day_trading']['market_phase']['is_open']}")
    print(f"Action Line: {data['day_trading']['final_action_line']}")

if __name__ == "__main__":
    verify_standby()
