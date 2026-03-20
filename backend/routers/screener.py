"""
Advanced Stock Screener Router
Provides multi-filter screening: RSI, Bollinger Band Squeeze, Consecutive Bullish, Volume Spike.
Supports JP / US / CRYPTO markets.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict, Any
import asyncio
import time
from datetime import datetime

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _calc_rsi(close_series, period: int = 14):
    """Calculate RSI for a pandas Series."""
    import numpy as np
    delta = close_series.diff()
    gain = delta.where(delta > 0, 0).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _calc_bb_width(close_series, window: int = 20):
    """Calculate Bollinger Band width (relative to mid)."""
    mid = close_series.rolling(window=window).mean()
    std = close_series.rolling(window=window).std()
    upper = mid + 2 * std
    lower = mid - 2 * std
    width = (upper - lower) / mid
    return width


def _resolve_tickers(market: str) -> Dict[str, str]:
    """Resolve ticker dict for the given market."""
    from data.ticker_map import MAJOR_TICKERS, US_TICKERS, CRYPTO_TICKERS
    m = market.upper()
    if m == "US":
        return US_TICKERS
    elif m == "CRYPTO":
        return CRYPTO_TICKERS
    return MAJOR_TICKERS


# ---------------------------------------------------------------------------
# Per-ticker filter logic  (runs in thread)
# ---------------------------------------------------------------------------

def _screen_ticker(ticker_code: str, ticker_name: str, filter_type: str,
                   timeframe: str, params: dict) -> Optional[Dict[str, Any]]:
    """Evaluate a single ticker against the requested filter.
    Returns a result dict if the ticker matches, else None.
    """
    import yfinance
    import numpy as np

    # Determine full symbol
    if ticker_code.isdigit() and len(ticker_code) == 4:
        symbol = f"{ticker_code}.T"
    else:
        symbol = ticker_code

    try:
        interval = "1d" if timeframe == "1d" else "1wk"
        period = "6mo" if interval == "1d" else "2y"

        stock = yfinance.Ticker(symbol)
        hist = stock.history(period=period, interval=interval)
        if hist is None or hist.empty or len(hist) < 20:
            return None

        close = hist["Close"]
        latest = hist.iloc[-1]
        current_price = float(close.iloc[-1])

        # ---- Filter: RSI Oversold / Overbought ----
        if filter_type in ("rsi_oversold", "rsi_overbought"):
            rsi_series = _calc_rsi(close, 14)
            rsi_val = float(rsi_series.iloc[-1])
            if np.isnan(rsi_val):
                return None
            threshold = params.get("rsi_threshold", 30 if filter_type == "rsi_oversold" else 70)
            match = rsi_val <= threshold if filter_type == "rsi_oversold" else rsi_val >= threshold
            if match:
                return {
                    "ticker": ticker_code,
                    "name": ticker_name,
                    "price": current_price,
                    "rsi": round(rsi_val, 1),
                    "filter": filter_type,
                }
            return None

        # ---- Filter: Bollinger Band Squeeze ----
        if filter_type == "bb_squeeze":
            bb_w = _calc_bb_width(close, 20)
            bb_val = float(bb_w.iloc[-1])
            if np.isnan(bb_val):
                return None
            threshold = params.get("bb_threshold", 0.06)
            if bb_val <= threshold:
                return {
                    "ticker": ticker_code,
                    "name": ticker_name,
                    "price": current_price,
                    "bb_width": round(bb_val, 4),
                    "filter": filter_type,
                }
            return None

        # ---- Filter: Consecutive Bullish Candles ----
        if filter_type == "consecutive_bullish":
            min_days = params.get("min_days", 3)
            min_growth = params.get("min_growth", 2.0)  # percent

            if len(hist) < min_days + 1:
                return None

            consecutive_count = 0
            for i in range(len(hist) - 1, max(len(hist) - 1 - min_days, -1), -1):
                row = hist.iloc[i]
                if row["Close"] > row["Open"]:
                    consecutive_count += 1
                else:
                    break

            if consecutive_count < min_days:
                return None

            growth_pct = ((close.iloc[-1] - close.iloc[-1 - min_days]) / close.iloc[-1 - min_days]) * 100
            if growth_pct >= min_growth:
                return {
                    "ticker": ticker_code,
                    "name": ticker_name,
                    "price": current_price,
                    "consecutive_days": consecutive_count,
                    "growth_pct": round(float(growth_pct), 2),
                    "filter": filter_type,
                }
            return None

        # ---- Filter: Volume Spike ----
        if filter_type == "volume_spike":
            vol = hist["Volume"]
            vol_ma20 = vol.rolling(window=20).mean().iloc[-1]
            current_vol = vol.iloc[-1]
            if vol_ma20 == 0 or np.isnan(vol_ma20):
                return None
            ratio = current_vol / vol_ma20
            threshold = params.get("vol_ratio", 2.0)
            if ratio >= threshold:
                rsi_series = _calc_rsi(close, 14)
                rsi_val = float(rsi_series.iloc[-1]) if not np.isnan(rsi_series.iloc[-1]) else None
                return {
                    "ticker": ticker_code,
                    "name": ticker_name,
                    "price": current_price,
                    "volume_ratio": round(float(ratio), 2),
                    "rsi": round(rsi_val, 1) if rsi_val else None,
                    "filter": filter_type,
                }
            return None

        return None

    except Exception as e:
        # Silently skip individual ticker errors
        return None


# ---------------------------------------------------------------------------
# Main Endpoint
# ---------------------------------------------------------------------------

@router.get("/api/screen")
async def screen_stocks(
    market: str = Query("JP", description="Market: JP / US / CRYPTO"),
    filter: str = Query("rsi_oversold", description="Filter type: rsi_oversold / rsi_overbought / bb_squeeze / consecutive_bullish / volume_spike"),
    timeframe: str = Query("1d", description="Timeframe: 1d / 1wk"),
    limit: int = Query(10, ge=1, le=50, description="Max results"),
    # Optional parameters for filter customization
    rsi_threshold: Optional[float] = Query(None, description="RSI threshold (default: 30 for oversold, 70 for overbought)"),
    bb_threshold: Optional[float] = Query(None, description="BB width threshold (default: 0.06)"),
    min_days: Optional[int] = Query(None, description="Min consecutive bullish days (default: 3)"),
    min_growth: Optional[float] = Query(None, description="Min growth % for consecutive bullish (default: 2.0)"),
    vol_ratio: Optional[float] = Query(None, description="Volume ratio threshold (default: 2.0)")
):
    """
    Advanced stock screener with multiple filter types.
    Scans the ticker universe for the specified market and returns matches.
    """
    VALID_FILTERS = {"rsi_oversold", "rsi_overbought", "bb_squeeze", "consecutive_bullish", "volume_spike"}
    if filter not in VALID_FILTERS:
        raise HTTPException(status_code=400, detail=f"Invalid filter. Must be one of: {', '.join(VALID_FILTERS)}")

    ticker_dict = _resolve_tickers(market)
    
    # Build params dict
    params = {}
    if rsi_threshold is not None:
        params["rsi_threshold"] = rsi_threshold
    if bb_threshold is not None:
        params["bb_threshold"] = bb_threshold
    if min_days is not None:
        params["min_days"] = min_days
    if min_growth is not None:
        params["min_growth"] = min_growth
    if vol_ratio is not None:
        params["vol_ratio"] = vol_ratio

    start = time.time()

    # Run screening in parallel threads
    semaphore = asyncio.Semaphore(8)

    async def _scan_one(code: str, name: str):
        async with semaphore:
            return await asyncio.to_thread(
                _screen_ticker, code, name, filter, timeframe, params
            )

    tasks = [_scan_one(code, name) for code, name in ticker_dict.items()]
    results = await asyncio.gather(*tasks)

    # Filter out None and apply limit
    matches = [r for r in results if r is not None]

    # Sort by relevance
    if filter in ("rsi_oversold",):
        matches.sort(key=lambda x: x.get("rsi", 100))
    elif filter in ("rsi_overbought",):
        matches.sort(key=lambda x: x.get("rsi", 0), reverse=True)
    elif filter == "bb_squeeze":
        matches.sort(key=lambda x: x.get("bb_width", 1))
    elif filter == "consecutive_bullish":
        matches.sort(key=lambda x: x.get("growth_pct", 0), reverse=True)
    elif filter == "volume_spike":
        matches.sort(key=lambda x: x.get("volume_ratio", 0), reverse=True)

    matches = matches[:limit]
    elapsed_ms = int((time.time() - start) * 1000)

    return {
        "timestamp": datetime.now().isoformat(),
        "market": market.upper(),
        "filter": filter,
        "timeframe": timeframe,
        "total_scanned": len(ticker_dict),
        "matches_count": len(matches),
        "elapsed_ms": elapsed_ms,
        "results": matches,
    }
