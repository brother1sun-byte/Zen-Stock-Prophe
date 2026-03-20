import requests
import json

def test_predict(ticker="49984"):
    url = "http://127.0.0.1:8000/predict"
    payload = {
        "ticker": ticker,
        "period": "1y",
        "capital": 500000
    }
    headers = {"Content-Type": "application/json"}
    
    print(f"Testing POST {url} with payload {payload}...")
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_predict()
