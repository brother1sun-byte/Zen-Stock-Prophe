"""Intraday decision-support analysis for Zen Stock Prophet Pro.

The functions in this module are simulator-only. They score short-term setups,
explain the evidence, and run a local historical check, but never place orders.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


SUPPORTED_INTERVALS = {"1m", "5m", "15m", "1d"}
INTERVAL_PERIODS = {"1m": "7d", "5m": "60d", "15m": "60d", "1d": "1y"}
MORNING_START = 9 * 60
MORNING_END = 11 * 60 + 30
AFTERNOON_START = 12 * 60 + 30
AFTERNOON_END = 15 * 60 + 30


def finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except Exception:
        return default


def _round(value: Any, digits: int = 2) -> float:
    return round(finite(value), digits)


def _sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return float(np.mean(values[-period:]))


def _ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2 / (period + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(value * alpha + result[-1] * (1 - alpha))
    return result


def _rsi(values: list[float], period: int = 14) -> float:
    if len(values) <= period:
        return 50.0
    deltas = np.diff(np.array(values[-(period + 1) :], dtype=float))
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = float(np.mean(gains)) or 0.0001
    avg_loss = float(np.mean(losses)) or 0.0001
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _macd(values: list[float]) -> dict[str, float]:
    if len(values) < 35:
        return {"macd": 0.0, "signal": 0.0, "histogram": 0.0}
    ema12 = _ema_series(values, 12)
    ema26 = _ema_series(values, 26)
    macd_line = [fast - slow for fast, slow in zip(ema12[-len(ema26) :], ema26)]
    signal_line = _ema_series(macd_line, 9)
    histogram = macd_line[-1] - signal_line[-1] if signal_line else 0.0
    return {"macd": _round(macd_line[-1]), "signal": _round(signal_line[-1]), "histogram": _round(histogram)}


def _atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    if len(closes) < 2:
        return 0.0
    ranges = []
    for index in range(1, len(closes)):
        high = highs[index] if index < len(highs) else closes[index]
        low = lows[index] if index < len(lows) else closes[index]
        previous = closes[index - 1]
        ranges.append(max(high - low, abs(high - previous), abs(low - previous)))
    window = ranges[-period:] if len(ranges) >= period else ranges
    return float(np.mean(window)) if window else 0.0


def _vwap(highs: list[float], lows: list[float], closes: list[float], volumes: list[float]) -> float:
    if not closes:
        return 0.0
    typical = np.array([(h + l + c) / 3 for h, l, c in zip(highs, lows, closes)], dtype=float)
    vol = np.array(volumes[: len(typical)], dtype=float)
    if not len(vol) or float(np.sum(vol)) <= 0:
        return closes[-1]
    return float(np.sum(typical * vol) / np.sum(vol))


def _bollinger(closes: list[float], period: int = 20) -> dict[str, float]:
    if len(closes) < period:
        latest = closes[-1] if closes else 0.0
        return {"middle": _round(latest), "upper": _round(latest), "lower": _round(latest), "widthPct": 0.0}
    window = np.array(closes[-period:], dtype=float)
    middle = float(np.mean(window))
    deviation = float(np.std(window))
    upper = middle + deviation * 2
    lower = middle - deviation * 2
    width_pct = ((upper - lower) / middle * 100) if middle else 0.0
    return {"middle": _round(middle), "upper": _round(upper), "lower": _round(lower), "widthPct": _round(width_pct)}


def _support_resistance(highs: list[float], lows: list[float], lookback: int = 24) -> dict[str, float]:
    if not highs or not lows:
        return {"support": 0.0, "resistance": 0.0}
    prior_highs = highs[-(lookback + 1) : -1] or highs[-lookback:]
    prior_lows = lows[-(lookback + 1) : -1] or lows[-lookback:]
    return {"support": _round(min(prior_lows)), "resistance": _round(max(prior_highs))}


def _minutes_of_day(value: Any) -> int | None:
    if not hasattr(value, "hour") or not hasattr(value, "minute"):
        return None
    return int(value.hour) * 60 + int(value.minute)


def _session_label(value: Any) -> str:
    minutes = _minutes_of_day(value)
    if minutes is None:
        return "daily"
    if MORNING_START <= minutes <= MORNING_END:
        return "morning"
    if AFTERNOON_START <= minutes <= AFTERNOON_END:
        return "afternoon"
    return "off_session"


def _bucket_label(value: Any, bucket_minutes: int = 30) -> str:
    minutes = _minutes_of_day(value)
    if minutes is None:
        return "daily"
    bucket_start = (minutes // bucket_minutes) * bucket_minutes
    return f"{bucket_start // 60:02d}:{bucket_start % 60:02d}"


def _volume_seasonality(frame: pd.DataFrame) -> dict[str, Any]:
    if "Volume" not in frame or len(frame) < 20:
        return {
            "session": "unknown",
            "bucket": "unknown",
            "latestVolume": 0,
            "seasonalAverage": 0,
            "sessionAverage": 0,
            "seasonalRatio": 1.0,
            "sessionRatio": 1.0,
            "sampleCount": 0,
            "zScore": 0.0,
            "verdict": "INSUFFICIENT_HISTORY",
        }
    enriched = frame.copy()
    enriched["_session"] = [_session_label(index) for index in enriched.index]
    enriched["_bucket"] = [_bucket_label(index) for index in enriched.index]
    latest = enriched.iloc[-1]
    latest_volume = finite(latest.get("Volume"))
    prior = enriched.iloc[:-1]
    session = str(latest["_session"])
    bucket = str(latest["_bucket"])
    same_bucket = prior[(prior["_session"] == session) & (prior["_bucket"] == bucket)]["Volume"].map(finite)
    same_session = prior[prior["_session"] == session]["Volume"].map(finite)
    seasonal_avg = float(same_bucket.mean()) if len(same_bucket) else 0.0
    session_avg = float(same_session.mean()) if len(same_session) else 0.0
    seasonal_std = float(same_bucket.std()) if len(same_bucket) >= 2 else 0.0
    baseline = seasonal_avg or session_avg or float(prior["Volume"].map(finite).tail(20).mean() or 0.0)
    ratio = latest_volume / baseline if baseline else 1.0
    z_score = (latest_volume - baseline) / seasonal_std if seasonal_std else 0.0
    if len(same_bucket) < 4:
        verdict = "LOW_SAMPLE"
    elif ratio >= 1.35 and z_score >= 0.5:
        verdict = "SEASONALLY_STRONG"
    elif ratio <= 0.7:
        verdict = "SEASONALLY_WEAK"
    else:
        verdict = "NORMAL"
    return {
        "session": session,
        "bucket": bucket,
        "latestVolume": _round(latest_volume, 0),
        "seasonalAverage": _round(seasonal_avg, 0),
        "sessionAverage": _round(session_avg, 0),
        "seasonalRatio": _round(ratio, 2),
        "sessionRatio": _round(latest_volume / session_avg if session_avg else 1.0, 2),
        "sampleCount": int(len(same_bucket)),
        "zScore": _round(z_score, 2),
        "verdict": verdict,
    }


def _estimate_spread(frame: pd.DataFrame, snapshot: dict[str, Any], quote_context: dict[str, Any] | None = None) -> dict[str, Any]:
    quote_context = quote_context or {}
    bid = finite(quote_context.get("bid"))
    ask = finite(quote_context.get("ask"))
    mid = (bid + ask) / 2 if bid > 0 and ask > bid else 0.0
    if mid > 0:
        spread_pct = (ask - bid) / mid * 100
        source = "QUOTE"
    else:
        close = max(snapshot["close"], 0.01)
        atr_pct = finite(snapshot.get("atrPct"))
        volume_ratio = max(finite(snapshot.get("volumeRatio"), 1.0), 0.1)
        recent_range_pct = []
        for _, row in frame.tail(30).iterrows():
            high = finite(row.get("High"))
            low = finite(row.get("Low"))
            row_close = finite(row.get("Close"))
            if row_close > 0 and high >= low:
                recent_range_pct.append((high - low) / row_close * 100)
        median_range = float(np.median(recent_range_pct)) if recent_range_pct else atr_pct
        spread_pct = max(0.03, min(1.5, (median_range * 0.12 + atr_pct * 0.03) / math.sqrt(volume_ratio)))
        bid = close * (1 - spread_pct / 200)
        ask = close * (1 + spread_pct / 200)
        source = "ESTIMATED_FROM_HISTORY"
    quote_age = finite(quote_context.get("quoteAgeSec"), 999)
    depth_ratio = finite(quote_context.get("bookRatio"), 0.0)
    if spread_pct <= 0.12:
        verdict = "TIGHT"
    elif spread_pct <= 0.3:
        verdict = "ACCEPTABLE"
    else:
        verdict = "WIDE"
    return {
        "bid": _round(bid),
        "ask": _round(ask),
        "spreadPct": _round(spread_pct, 3),
        "source": source,
        "quoteAgeSec": _round(quote_age, 1),
        "bookRatio": _round(depth_ratio, 2),
        "depthSource": "QUOTE" if depth_ratio else "UNAVAILABLE",
        "verdict": verdict,
    }


def _event_risk(event_context: dict[str, Any] | None = None) -> dict[str, Any]:
    event_context = event_context or {}
    items = event_context.get("items") or []
    has_recent_material = bool(event_context.get("hasRecentMaterial"))
    has_earnings = bool(event_context.get("hasUpcomingEarnings"))
    tone = str(event_context.get("tone") or "unknown")
    risk_reasons: list[str] = []
    if has_earnings:
        risk_reasons.append("決算または予定イベントが近づいています。")
    if has_recent_material and tone == "negative":
        risk_reasons.append("直近に悪材料となるニュースが確認されました。")
    if has_recent_material and tone == "mixed":
        risk_reasons.append("直近材料の方向性が混在しています。")
    verdict = "BLOCK" if has_earnings or tone == "negative" else "CAUTION" if risk_reasons or has_recent_material else "CLEAR_OR_UNCONFIRMED"
    return {
        "verdict": verdict,
        "tone": tone,
        "hasRecentMaterial": has_recent_material,
        "hasUpcomingEarnings": has_earnings,
        "latestTitle": str(event_context.get("latestTitle") or ""),
        "latestPublishedAt": str(event_context.get("latestPublishedAt") or ""),
        "items": items[:3],
        "reasons": risk_reasons,
        "source": str(event_context.get("source") or "UNCONFIRMED"),
    }


def _max_drawdown(returns: list[float]) -> float:
    equity = 1.0
    peak = 1.0
    worst = 0.0
    for value in returns:
        equity *= 1 + value / 100
        peak = max(peak, equity)
        worst = min(worst, (equity / peak - 1) * 100)
    return _round(worst)


def _indicator_snapshot(frame: pd.DataFrame) -> dict[str, Any]:
    closes = [finite(value) for value in frame["Close"].tolist()]
    opens = [finite(value) for value in frame["Open"].tolist()] if "Open" in frame else closes
    highs = [finite(value) for value in frame["High"].tolist()] if "High" in frame else closes
    lows = [finite(value) for value in frame["Low"].tolist()] if "Low" in frame else closes
    volumes = [finite(value) for value in frame["Volume"].tolist()] if "Volume" in frame else [0.0] * len(closes)
    close = closes[-1]
    previous = closes[-2] if len(closes) >= 2 else close
    change_pct = ((close / previous) - 1) * 100 if previous else 0.0
    avg_volume20 = float(np.mean(volumes[-21:-1])) if len(volumes) >= 21 else float(np.mean(volumes[:-1])) if len(volumes) > 1 else 0.0
    volume_ratio = volumes[-1] / avg_volume20 if avg_volume20 else 0.0
    vwap = _vwap(highs[-80:], lows[-80:], closes[-80:], volumes[-80:])
    atr = _atr(highs, lows, closes)
    atr_pct = (atr / close * 100) if close else 0.0
    sr = _support_resistance(highs, lows)
    gap_pct = ((opens[-1] / previous) - 1) * 100 if previous and opens else 0.0
    return {
        "open": opens[-1] if opens else close,
        "close": close,
        "previousClose": previous,
        "changePct": change_pct,
        "volume": volumes[-1] if volumes else 0.0,
        "avgVolume20": avg_volume20,
        "volumeRatio": volume_ratio,
        "sma9": _sma(closes, 9),
        "sma20": _sma(closes, 20),
        "sma50": _sma(closes, 50),
        "vwap": vwap,
        "rsi": _rsi(closes),
        "macd": _macd(closes),
        "bollinger": _bollinger(closes),
        "atr": atr,
        "atrPct": atr_pct,
        "support": sr["support"],
        "resistance": sr["resistance"],
        "gapPct": gap_pct,
        "closes": closes,
        "highs": highs,
        "lows": lows,
        "volumes": volumes,
    }


def _score_snapshot(snapshot: dict[str, Any]) -> tuple[float, list[dict[str, Any]], list[str]]:
    close = snapshot["close"]
    sma9 = snapshot["sma9"]
    sma20 = snapshot["sma20"]
    sma50 = snapshot["sma50"]
    vwap = snapshot["vwap"]
    rsi = snapshot["rsi"]
    macd_hist = snapshot["macd"]["histogram"]
    volume_ratio = snapshot["volumeRatio"]
    atr_pct = snapshot["atrPct"]
    resistance = snapshot["resistance"]
    support = snapshot["support"]
    bollinger = snapshot["bollinger"]
    score = 50.0
    evidence: list[dict[str, Any]] = []
    fakeouts: list[str] = []

    trend_ok = bool(sma9 and sma20 and close > sma9 > sma20 and (not sma50 or sma20 >= sma50 * 0.995))
    trend_bad = bool(sma9 and sma20 and close < sma9 < sma20)
    score += 16 if trend_ok else -14 if trend_bad else 0
    evidence.append({"id": "trend", "label": "トレンド整合", "ok": bool(trend_ok), "detail": f"終値 {close:.1f}、SMA9 {sma9 or 0:.1f}、SMA20 {sma20 or 0:.1f}"})

    vwap_ok = close >= vwap * 0.998 if vwap else False
    score += 11 if vwap_ok else -9
    evidence.append({"id": "vwap", "label": "VWAP支持", "ok": bool(vwap_ok), "detail": f"VWAP {vwap:.1f}、乖離 {((close / vwap - 1) * 100) if vwap else 0:+.2f}%"})

    rsi_ok = 45 <= rsi <= 68
    score += 10 if rsi_ok else -8 if rsi > 76 or rsi < 35 else 1
    evidence.append({"id": "rsi", "label": "RSIの取引可能域", "ok": bool(rsi_ok), "detail": f"RSI {rsi:.1f}"})

    macd_ok = macd_hist > 0
    score += 9 if macd_ok else -6
    evidence.append({"id": "macd", "label": "MACDモメンタム", "ok": bool(macd_ok), "detail": f"ヒストグラム {macd_hist:+.2f}"})

    volume_ok = volume_ratio >= 1.15
    score += min(volume_ratio * 5, 14) if volume_ok else -5
    evidence.append({"id": "volume", "label": "出来高増加", "ok": bool(volume_ok), "detail": f"直近平均比 {volume_ratio:.2f}倍"})

    volatility_ok = 0.25 <= atr_pct <= 3.8
    score += 7 if volatility_ok else -8
    evidence.append({"id": "volatility", "label": "ボラティリティ範囲", "ok": bool(volatility_ok), "detail": f"ATRは価格の {atr_pct:.2f}%"})

    near_breakout = bool(resistance and close >= resistance * 0.995)
    above_support = bool(support and close > support * 1.003)
    score += 7 if near_breakout else 4 if above_support else -5
    evidence.append({"id": "support_resistance", "label": "支持線・抵抗線", "ok": bool(near_breakout or above_support), "detail": f"支持線 {support:.1f}、抵抗線 {resistance:.1f}"})

    if close > bollinger["upper"] and rsi > 72:
        fakeouts.append("価格がボリンジャーバンド上限を上回り、RSIも過熱しています。")
        score -= 9
    if volume_ratio >= 2.0 and not vwap_ok:
        fakeouts.append("出来高は増えていますが、価格がVWAPを維持できていません。")
        score -= 10
    if resistance and snapshot["highs"][-1] > resistance and close < resistance:
        fakeouts.append("足中の上抜け後、再び抵抗線を下回っています。")
        score -= 9
    if snapshot["gapPct"] >= 2.5 and close < snapshot["open"]:
        fakeouts.append("ギャップアップ後に失速し、始値を下回っています。")
        score -= 8

    return max(0, min(100, round(score, 1))), evidence, fakeouts


def _simulated_returns(frame: pd.DataFrame, start: int, end: int, horizon_bars: int = 3) -> list[float]:
    returns: list[float] = []
    safe_end = min(end, len(frame) - horizon_bars)
    for index in range(max(50, start), safe_end):
        past = frame.iloc[: index + 1]
        snapshot = _indicator_snapshot(past)
        score, _evidence, fakeouts = _score_snapshot(snapshot)
        if score < 62 or len(fakeouts) >= 2:
            continue
        entry = finite(frame["Close"].iloc[index])
        exit_price = finite(frame["Close"].iloc[index + horizon_bars])
        if entry > 0 and exit_price > 0:
            returns.append((exit_price / entry - 1) * 100)
    return returns


def _returns_summary(returns: list[float]) -> dict[str, Any]:
    if not returns:
        return {
            "trades": 0,
            "winRatePct": 0,
            "avgReturnPct": 0,
            "profitFactor": 0,
            "maxDrawdownPct": 0,
            "payoffRatio": 0,
            "expectancyPct": 0,
            "verdict": "NO_MATCHING_SETUPS",
        }
    wins = [value for value in returns if value > 0]
    losses = [value for value in returns if value <= 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    avg_win = float(np.mean(wins)) if wins else 0.0
    avg_loss = abs(float(np.mean(losses))) if losses else 0.0
    profit_factor = gross_profit / gross_loss if gross_loss else (gross_profit if gross_profit else 0.0)
    win_rate = len(wins) / len(returns) * 100
    avg_return = float(np.mean(returns))
    return {
        "trades": len(returns),
        "winRatePct": _round(win_rate, 1),
        "avgReturnPct": _round(avg_return),
        "profitFactor": _round(profit_factor),
        "maxDrawdownPct": _max_drawdown(returns),
        "payoffRatio": _round(avg_win / avg_loss if avg_loss else 0.0),
        "expectancyPct": _round(avg_return),
        "verdict": "POSITIVE_EDGE" if len(returns) >= 8 and win_rate >= 52 and avg_return > 0 and profit_factor >= 1.05 else "WEAK_OR_UNPROVEN",
    }


def _backtest(frame: pd.DataFrame, horizon_bars: int = 3) -> dict[str, Any]:
    if len(frame) < 55:
        return {
            "trades": 0,
            "winRatePct": 0,
            "avgReturnPct": 0,
            "profitFactor": 0,
            "maxDrawdownPct": 0,
            "payoffRatio": 0,
            "expectancyPct": 0,
            "verdict": "INSUFFICIENT_HISTORY",
        }
    return _returns_summary(_simulated_returns(frame, 50, len(frame), horizon_bars=horizon_bars))


def _walk_forward(frame: pd.DataFrame, folds: int = 4, horizon_bars: int = 3) -> dict[str, Any]:
    if len(frame) < 120:
        return {"folds": [], "foldCount": 0, "stabilityPct": 0, "avgReturnPct": 0, "winRatePct": 0, "verdict": "INSUFFICIENT_HISTORY"}
    start = 60
    available = len(frame) - start - horizon_bars
    if available < folds * 12:
        return {"folds": [], "foldCount": 0, "stabilityPct": 0, "avgReturnPct": 0, "winRatePct": 0, "verdict": "INSUFFICIENT_HISTORY"}
    fold_size = max(12, available // folds)
    fold_results: list[dict[str, Any]] = []
    all_returns: list[float] = []
    for fold in range(folds):
        fold_start = start + fold * fold_size
        fold_end = len(frame) - horizon_bars if fold == folds - 1 else min(len(frame) - horizon_bars, fold_start + fold_size)
        returns = _simulated_returns(frame, fold_start, fold_end, horizon_bars=horizon_bars)
        summary = _returns_summary(returns)
        all_returns.extend(returns)
        fold_results.append(
            {
                "fold": fold + 1,
                "startBar": int(fold_start),
                "endBar": int(fold_end),
                "trades": summary["trades"],
                "winRatePct": summary["winRatePct"],
                "avgReturnPct": summary["avgReturnPct"],
                "profitFactor": summary["profitFactor"],
                "verdict": summary["verdict"],
            }
        )
    positive_folds = [item for item in fold_results if item["trades"] > 0 and finite(item["avgReturnPct"]) > 0]
    stability = len(positive_folds) / len(fold_results) * 100 if fold_results else 0.0
    aggregate = _returns_summary(all_returns)
    verdict = "ROBUST" if stability >= 75 and aggregate["trades"] >= 12 and aggregate["avgReturnPct"] > 0 else "UNSTABLE_OR_WEAK"
    return {
        "folds": fold_results,
        "foldCount": len(fold_results),
        "stabilityPct": _round(stability, 1),
        "avgReturnPct": aggregate["avgReturnPct"],
        "winRatePct": aggregate["winRatePct"],
        "profitFactor": aggregate["profitFactor"],
        "trades": aggregate["trades"],
        "verdict": verdict,
    }


def build_daytrade_analysis(
    ticker: str,
    hist: pd.DataFrame,
    *,
    interval: str = "5m",
    quote_context: dict[str, Any] | None = None,
    event_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if interval not in SUPPORTED_INTERVALS:
        raise ValueError(f"unsupported interval: {interval}")
    if hist is None or hist.empty:
        raise ValueError("history is required")
    required = {"Open", "High", "Low", "Close", "Volume"}
    missing = sorted(required - set(hist.columns))
    if missing:
        raise ValueError(f"history missing columns: {', '.join(missing)}")
    frame = hist.dropna(subset=["Open", "High", "Low", "Close"]).copy()
    frame = frame[frame["Close"].map(finite) > 0]
    if len(frame) < 30:
        raise ValueError("at least 30 bars are required")

    snapshot = _indicator_snapshot(frame)
    score, evidence, fakeouts = _score_snapshot(snapshot)
    volume_seasonality = _volume_seasonality(frame)
    microstructure = _estimate_spread(frame, snapshot, quote_context=quote_context)
    event_risk = _event_risk(event_context)
    close = snapshot["close"]
    atr = max(snapshot["atr"], close * 0.004)
    support = snapshot["support"] or close - atr * 1.6
    resistance = snapshot["resistance"] or close + atr * 1.8
    entry = close if score >= 62 and not fakeouts else min(close, snapshot["vwap"] or close)
    stop = min(support * 0.998, entry - atr * 1.2)
    target = max(resistance * 0.998, entry + atr * 1.8)
    risk = max(entry - stop, 0.01)
    reward = max(target - entry, 0.0)
    rr = reward / risk if risk else 0.0
    if rr < 1.2:
        score = max(0, score - 7)
    if volume_seasonality["verdict"] == "SEASONALLY_STRONG":
        score = min(100, score + 5)
        evidence.append({"id": "volume_seasonality", "label": "時間帯別出来高季節性", "ok": True, "detail": f"{volume_seasonality['session']} {volume_seasonality['bucket']} は通常比 {volume_seasonality['seasonalRatio']}倍"})
    elif volume_seasonality["verdict"] == "SEASONALLY_WEAK":
        score = max(0, score - 7)
        fakeouts.append("直近の出来高が、同じ市場区分・時間帯の通常水準を下回っています。")
        evidence.append({"id": "volume_seasonality", "label": "時間帯別出来高季節性", "ok": False, "detail": f"{volume_seasonality['session']} {volume_seasonality['bucket']} は通常比 {volume_seasonality['seasonalRatio']}倍"})
    else:
        evidence.append({"id": "volume_seasonality", "label": "時間帯別出来高季節性", "ok": volume_seasonality["verdict"] != "INSUFFICIENT_HISTORY", "detail": f"{volume_seasonality['session']} {volume_seasonality['bucket']} の標本数 {volume_seasonality['sampleCount']}"})
    if microstructure["verdict"] == "WIDE":
        score = max(0, score - 9)
        fakeouts.append(f"推定または気配値スプレッドが {microstructure['spreadPct']}% と広がっています。")
    evidence.append({"id": "spread", "label": "銘柄別スプレッド推定", "ok": microstructure["verdict"] != "WIDE", "detail": f"{microstructure['source']} による推定 {microstructure['spreadPct']}%"})
    if microstructure["depthSource"] == "QUOTE" and microstructure["bookRatio"] < 0.8:
        score = max(0, score - 6)
        fakeouts.append("表示されている買い板が売り板に比べて薄い状態です。")
    if event_risk["verdict"] == "BLOCK":
        score = max(0, score - 18)
        fakeouts.extend(event_risk["reasons"])
    elif event_risk["verdict"] == "CAUTION":
        score = max(0, score - 6)
        fakeouts.extend(event_risk["reasons"][:1])
    event_verdict_labels = {
        "BLOCK": "除外対象",
        "CAUTION": "注意",
        "CLEAR_OR_UNCONFIRMED": "明確な懸念なし・未確認を含む",
    }
    evidence.append({"id": "event_risk", "label": "ニュース・決算イベント除外", "ok": event_risk["verdict"] not in {"BLOCK"}, "detail": event_verdict_labels.get(event_risk["verdict"], "未確認")})
    if score >= 75 and len(fakeouts) == 0 and rr >= 1.4:
        signal = "STRONG_LONG_REVIEW"
        label = "強い監視候補"
    elif score >= 62 and len(fakeouts) <= 1:
        signal = "LONG_REVIEW"
        label = "監視候補"
    elif score >= 45:
        signal = "WAIT"
        label = "待機"
    else:
        signal = "AVOID"
        label = "見送り"

    backtest = _backtest(frame)
    walk_forward = _walk_forward(frame)
    explanations = [
        f"トレンド、VWAP、RSI、MACD、出来高季節性、スプレッド、イベント、ボラティリティ、支持線・抵抗線から算出したスコアは {score}/100 です。",
        f"参考エントリー {entry:.1f}、利確目安 {target:.1f}、損切り目安 {stop:.1f}、損益比 {rr:.2f} です。",
    ]
    if fakeouts:
        explanations.append("騙しシグナル除外: " + " / ".join(fakeouts[:3]))
    else:
        explanations.append("直近の足では、主要な騙しシグナル除外条件に該当していません。")

    latest_index = frame.index[-1]
    latest_bar = latest_index.isoformat() if hasattr(latest_index, "isoformat") else str(latest_index)
    return {
        "ticker": ticker,
        "interval": interval,
        "bars": len(frame),
        "latestBar": latest_bar,
        "score": round(score, 1),
        "signal": signal,
        "label": label,
        "indicators": {
            "trend": {
                "sma9": _round(snapshot["sma9"]),
                "sma20": _round(snapshot["sma20"]),
                "sma50": _round(snapshot["sma50"]),
            },
            "vwap": _round(snapshot["vwap"]),
            "rsi": _round(snapshot["rsi"], 1),
            "macd": snapshot["macd"],
            "bollinger": snapshot["bollinger"],
            "atrPct": _round(snapshot["atrPct"]),
            "volumeRatio": _round(snapshot["volumeRatio"], 2),
            "volumeSeasonality": volume_seasonality,
            "gapPct": _round(snapshot["gapPct"]),
            "changePct": _round(snapshot["changePct"]),
            "support": _round(support),
            "resistance": _round(resistance),
            "microstructure": microstructure,
            "eventRisk": event_risk,
        },
        "levels": {
            "entryCandidate": _round(entry),
            "takeProfitCandidate": _round(target),
            "stopLossCandidate": _round(stop),
            "riskReward": _round(rr, 2),
        },
        "evidence": evidence,
        "fakeoutFilters": fakeouts,
        "backtest": backtest,
        "walkForward": walk_forward,
        "explanations": explanations,
        "disclaimer": "シミュレーション専用の分析です。投資助言ではありません。証券会社へ注文を送信することもありません。",
    }
