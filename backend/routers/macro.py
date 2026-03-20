from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional, Dict
import yfinance
import time
from datetime import datetime, timedelta

router = APIRouter()

# --- Cache ---
macro_cache = {}
CACHE_TTL = 3600 # 1 hour

class MacroSnapshot(BaseModel):
    asof: str
    nikkei: Optional[float] = None
    topix: Optional[float] = None
    usdjpy: Optional[float] = None
    us10y: Optional[float] = None
    vix: Optional[float] = None
    risk_sentiment: Optional[str] = None  # "Risk On", "Risk Off", "Neutral"
    partial: bool = False
    missing_fields: List[str] = []

def derive_risk_sentiment(vix: Optional[float]) -> str:
    if vix is None:
        return "Unknown"
    if vix > 25:
        return "Risk Off (Extreme Fear)"
    if vix > 20:
        return "Risk Off"
    if vix < 15:
        return "Risk On (Greed/Calm)"
    return "Neutral"

@router.get("/api/macro_snapshot", response_model=MacroSnapshot)
async def get_macro_snapshot(asof: Optional[str] = None):
    if not asof:
        # For weekend use case, we usually want the last Friday or current. 
        # But for 'asof' param, we default to the current day.
        asof = datetime.now().strftime("%Y-%m-%d")
        
    current_time = time.time()
    
    # Check Cache
    if asof in macro_cache:
        cached = macro_cache[asof]
        if current_time - cached["timestamp"] < CACHE_TTL:
            return cached["data"]
    
    snapshot = MacroSnapshot(asof=asof)
    missing = []
    
    # 1. Standard Tickers
    tickers = {
        "nikkei": "^N225",
        "usdjpy": "USDJPY=X",
        "us10y": "^TNX",
        "vix": "^VIX"
    }

    results = {}
    for key, symbol in tickers.items():
        try:
            t = yfinance.Ticker(symbol)
            # Use 5d to ensure we get *some* data even on weekends/holidays
            hist = t.history(period="5d")
            if not hist.empty:
                val = float(hist["Close"].iloc[-1])
                results[key] = val
                setattr(snapshot, key, val)
            else:
                missing.append(key)
        except Exception:
            missing.append(key)

    # 2. TOPIX (ETF Proxy or Index if available)
    try:
        t = yfinance.Ticker("1306.T") # Next Funds TOPIX ETF
        hist = t.history(period="5d")
        if not hist.empty:
            val = float(hist["Close"].iloc[-1])
            snapshot.topix = val
        else:
            missing.append("topix")
    except Exception:
        missing.append("topix")

    # 3. Derive Sentiment
    snapshot.risk_sentiment = derive_risk_sentiment(snapshot.vix)
    if snapshot.vix is None:
        missing.append("risk_sentiment")

    if missing:
        snapshot.partial = True
        snapshot.missing_fields = list(set(missing))
    
    # Save to Cache
    macro_cache[asof] = {
        "data": snapshot,
        "timestamp": current_time
    }
    
    return snapshot
