
import requests
import json

def test_predict():
    url = "http://127.0.0.1:8000/predict"
    payload = {"ticker": "7203", "period": "1y"}
    headers = {"Content-Type": "application/json"}
    
    try:
        print(f"Testing POST {url} with payload {payload}...")
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            print("Success! Data received.")
            # print(json.dumps(response.json(), indent=2, ensure_ascii=False))
        else:
            print(f"Error Details: {response.text}")
    except Exception as e:
        print(f"Connection Failed: {e}")

if __name__ == "__main__":
    test_predict()
