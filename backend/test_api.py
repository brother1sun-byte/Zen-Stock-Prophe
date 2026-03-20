import requests
import json

try:
    url = "http://127.0.0.1:8000/predict"
    payload = {"ticker": "7203.T", "period": "1mo"}
    headers = {"Content-Type": "application/json"}
    
    print(f"Sending POST to {url} with {payload}")
    response = requests.post(url, json=payload, headers=headers)
    
    print(f"Status Code: {response.status_code}")
    print("Response Body:")
    print(response.text)
except Exception as e:
    print(f"Error: {e}")
