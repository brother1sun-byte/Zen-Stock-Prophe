import requests
import json

url = "http://localhost:8000/predict"
payload = {
    "ticker": "7203",
    "period": "1d",
    "capital": 500000
}
headers = {
    "Content-Type": "application/json"
}

try:
    response = requests.post(url, data=json.dumps(payload), headers=headers)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print("Success!")
        print(f"Ticker: {data.get('ticker')}")
        print(f"Company: {data.get('company_name')}")
        print(f"Day Trading Decision: {data.get('day_trading', {}).get('decision')}")
        if "ma25" in data.get('technical_analysis', {}).get('regime', {}):
             print("ma25 found in technical_analysis.regime")
        # Check Indicators internally
        print(f"Evolution Stats: {data.get('evolution_stats')}")
    else:
        print(f"Error: {response.text}")
except Exception as e:
    print(f"Exception: {e}")
