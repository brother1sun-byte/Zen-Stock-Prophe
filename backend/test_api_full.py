import requests
import json

try:
    url = "http://127.0.0.1:8000/predict"
    # Exact payload structure from frontend default state
    payload = {
        "ticker": "7203.T", 
        "period": "30d",
        "entry_price": None,
        "shares": None
    }
    headers = {"Content-Type": "application/json"}
    
    print(f"Sending POST to {url} with {payload}")
    response = requests.post(url, json=payload, headers=headers)
    
    print(f"Status Code: {response.status_code}")
    print("Response Body:")
    print(response.text)
except Exception as e:
    print(f"Error: {e}")
