import yfinance as yf
import pandas as pd
import numpy as np

def scan_bearish():
    # Major Japanese stocks across different sectors
    tickers = [
        "6920.T", # Lasertec (High Beta)
        "8035.T", # Tokyo Electron (Semi)
        "9984.T", # SoftBank Group (Tech/Investment)
        "9101.T", # NYK Line (Shipping)
        "6501.T", # Hitachi
        "6758.T", # Sony
        "7203.T", # Toyota
        "8306.T", # MUFG (Banks)
        "4063.T", # Shin-Etsu
        "6367.T", # Daikin
        "4503.T", # Astellas
        "2413.T", # M3 (Growth)
        "6098.T"  # Recruit
    ]
    
    scan_results = []
    
    print(f"{'Ticker':<10} | {'Price':<10} | {'5D Ret %':<10} | {'RSI':<10} | {'Trend'}")
    print("-" * 60)
    
    for t in tickers:
        try:
            stock = yf.Ticker(t)
            hist = stock.history(period="1mo")
            if hist.empty: continue
            
            # Simple technical indicators
            close = hist['Close']
            ret_5d = (close.iloc[-1] / close.iloc[-6] - 1) * 100
            
            # Simple RSI(14) calculation
            delta = close.diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs.iloc[-1]))
            
            # AI logic: if 5D return is negative and RSI is high or price is below MA5
            ma5 = close.rolling(5).mean().iloc[-1]
            trend = "DOWN" if close.iloc[-1] < ma5 else "UP"
            
            scan_results.append({
                "ticker": t,
                "price": close.iloc[-1],
                "ret_5d": ret_5d,
                "rsi": rsi,
                "trend": trend
            })
            
            print(f"{t:<10} | {close.iloc[-1]:<10.1f} | {ret_5d:<10.2f} | {rsi:<10.1f} | {trend}")
            
        except Exception as e:
            continue

    print("\n--- Bearish Candidate ---")
    bearish = [r for r in scan_results if r['ret_5d'] < -1.0]
    if bearish:
        for b in bearish:
            print(f"Ticker: {b['ticker']} is showing weakness.")
    else:
        print("No immediate strong bearish signals found in the selected scan group.")

if __name__ == "__main__":
    scan_bearish()
