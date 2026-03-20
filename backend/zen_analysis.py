import pandas as pd
from typing import Dict, Optional

class ZenSignalAnalyzer:
    """
    Implements the 5-point 'Buying Signal' logic from the Zen article:
    1. Uptrend: MA25 > MA75
    2. Price Position: Close > MA25
    3. RSI Range: 40 <= RSI <= 60
    4. RSI Momentum: RSI_today > RSI_yesterday
    5. Volume Breakout: Volume_today > Volume_MA20
    """
    
    @staticmethod
    def analyze(df: pd.DataFrame) -> Dict:
        if len(df) < 2:
            return {"is_signal": False, "reason": "Insufficient data"}
        
        latest = df.iloc[-1]
        previous = df.iloc[-2]
        older = df.iloc[-3] if len(df) >= 3 else previous
        
        # Calculate Bollinger Bands internally if not present
        if 'BB_Width' not in df.columns:
            bb_mid = df['Close'].rolling(window=20).mean()
            bb_std = df['Close'].rolling(window=20).std()
            bb_upper = bb_mid + 2 * bb_std
            bb_lower = bb_mid - 2 * bb_std
            df['BB_Width'] = (bb_upper - bb_lower) / bb_mid
        
        # Calculate positive candles
        is_green_latest = latest['Close'] > latest['Open']
        is_green_prev = previous['Close'] > previous['Open']
        is_green_older = older['Close'] > older['Open']
        
        # Advanced Signals
        bb_squeeze = float(df['BB_Width'].iloc[-1]) < 0.08  # Squeeze threshold
        consecutive_growth = is_green_latest and is_green_prev and is_green_older
        
        c1 = latest['MA_Short'] > latest['MA_Long']
        c2 = latest['Close'] > latest['MA_Short']
        c3 = 40 <= latest['RSI'] <= 60
        c4 = latest['RSI'] > previous['RSI']
        c5 = latest['Volume'] > latest['VolMA20']
        
        is_signal = all([c1, c2, c3, c4, c5])
        
        details = {
            "is_signal": is_signal,
            "conditions": {
                "uptrend_ma25_gt_ma75": bool(c1),
                "price_gt_ma25": bool(c2),
                "rsi_in_range_40_60": bool(c3),
                "rsi_rising": bool(c4),
                "volume_breakout": bool(c5),
                "bb_squeeze": bool(bb_squeeze),
                "consecutive_growth": bool(consecutive_growth)
            },
            "values": {
                "close": float(latest['Close']),
                "ma25": float(latest['MA_Short']),
                "ma75": float(latest['MA_Long']),
                "rsi": float(latest['RSI']),
                "volume": float(latest['Volume']),
                "vol_ma20": float(latest['VolMA20'])
            },
            "risk_mgmt": {
                "target_price_1": round(float(latest['Close'] * 1.05), 2),
                "target_price_2": round(float(latest['Close'] * 1.10), 2),
                "stop_loss": round(min(float(latest['MA_Long']), float(latest['Close'] * 0.95)), 2)
            }
        }
        
        return details
