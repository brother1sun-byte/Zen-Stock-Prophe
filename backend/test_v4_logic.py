import pandas as pd
import numpy as np
from main import calculate_day_trading_signals

def test_v4_logic():
    print("=== Beginner Action Engine v4.0 Logic Verification ===")
    
    # Mock data
    hist = pd.DataFrame({
        'Close': [1000] * 20,
        'High': [1010] * 20,
        'Low': [990] * 20,
        'Volume': [1000] * 20
    })
    current_price = 1000.0
    capital = 1000000.0 # 1 million yen
    
    # 1. NO TRADE: Panic + Fake Break
    regime_panic = {"regime": "PANIC", "status_text": "パニック的乱高下", "atr": 20.0, "vol_pct": 2.0}
    of_fake = {"break_status": "FAKE_BREAK", "bias_raw": 0, "bias_label": "均衡", "absorption": "NEUTRAL"}
    res1 = calculate_day_trading_signals(hist, current_price, regime_panic, of_fake, {}, capital)
    print(f"\nScenario 1 (Panic + Fake):")
    print(f" - Decision: {res1['decision']}")
    print(f" - Risk Alert: {res1['is_risk_alert']} ({res1['alert_message']})")
    
    # 2. NO TRADE: Small Lot (< 100 shares)
    # 0.4% risk = 4000 yen. If SL is far away, shares might be small.
    # ATR=100. Stop = 1000 - 1.2*100 = 880. Entry=997. Diff=117. 4000/117 = 34 shares. < 100.
    regime_range = {"regime": "RANGE", "status_text": "レンジ圏内", "atr": 100.0, "vol_pct": 1.0}
    of_stable = {"break_status": "STALBE", "bias_raw": 0, "bias_label": "均衡", "absorption": "NEUTRAL"}
    res2 = calculate_day_trading_signals(hist, current_price, regime_range, of_stable, {}, capital)
    print(f"\nScenario 2 (Small Lot):")
    print(f" - Shares: {res2['lot_management']['shares']}")
    print(f" - Decision: {res2['decision']}")
    print(f" - Reason: {res2['reasoning_list']}")

    # 3. WAIT: 70% Sell Bias
    of_sell_70 = {"break_status": "STABLE", "bias_raw": -0.5, "bias_label": "売り優勢", "absorption": "NEUTRAL"}
    res3 = calculate_day_trading_signals(hist, current_price, regime_range, of_sell_70, {}, capital)
    print(f"\nScenario 3 (70% Sell Bias):")
    print(f" - Decision: {res3['decision']}")
    print(f" - Reason: {res3['reasoning_list']}")

    # 4. BUY: STABLE + Real Break + Good EV
    # ATR=10. Entry=997. Stop=997 - 1.2*10 = 985. Diff=12. 
    # 4000/12 = 333 shares -> 300 shares.
    # Target=997 + 2*10 = 1017. Profit = 20 * 300 = 6000 yen.
    # To get 1% EV (10,000 yen), we need ATR to be higher or distance larger.
    # Let's use ATR=20. Entry=997. Stop=997 - 24 = 973. Diff=24.
    # 4000/24 = 166 -> 100 shares.
    # Target=997 + 2*20 = 1037. Profit = 40 * 100 = 4000. 
    # Wait, 1% of 1M is 10,000. 
    # Try Entry=1000. Stop=990. Diff=10. Risk=4000. Shares=400.
    # Target=1030. Profit = 30 * 400 = 12,000. (1.2% EV).
    regime_stable = {"regime": "STABLE", "status_text": "安定推移", "atr": 20.0, "vol_pct": 0.5}
    of_real = {"break_status": "TRUE_BREAK", "bias_raw": 0.5, "bias_label": "買い優勢", "absorption": "ACTIVE_BUY"}
    # Adjust shares bypass for test
    res4 = calculate_day_trading_signals(hist, current_price, regime_stable, of_real, {}, 2000000.0) # 2M capital -> 8000 risk.
    # Entry=997. Target=1037. Stop=973. Diff=24. 8000/24 = 333 -> 300 shares.
    # Profit = 40 * 300 = 12,000 -> 0.6% of 2M. Still < 1%.
    # Try 500k capital. 2000 risk. Entry=997. Stop=994. Diff=3. 2000/3 = 666 -> 600 shares.
    # Target=997 + 40 = 1037. Profit = 40 * 600 = 24,000. -> 4.8% of 500k. YES.
    res4 = calculate_day_trading_signals(hist, current_price, regime_stable, of_real, {}, 500000.0)
    print(f"\nScenario 4 (BUY Condition):")
    print(f" - Decision: {res4['decision']}")
    print(f" - Expected Value: {res4['lot_management']['shares'] * (res4['lot_management']['target'] - res4['lot_management']['entry']):,.0f}")
    print(f" - Terminology Check: {res4['terminology']['market_regime']}")

    # 5. Risk Alert: 80% Sell Bias
    of_sell_80 = {"break_status": "STABLE", "bias_raw": -0.8, "bias_label": "極端な売り優勢", "absorption": "ACTIVE_SELL"}
    res5 = calculate_day_trading_signals(hist, current_price, regime_stable, of_sell_80, {}, capital)
    print(f"\nScenario 5 (80% Sell Bias):")
    print(f" - Risk Alert: {res5['is_risk_alert']}")
    print(f" - Message: {res5['alert_message']}")

if __name__ == "__main__":
    test_v4_logic()
