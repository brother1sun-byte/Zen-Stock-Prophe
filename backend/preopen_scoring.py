"""Pre-open scoring for Japanese day-trade candidate screening.

This module deliberately uses only information that can be known before the
next session opens: completed historical OHLCV bars and optional pre-open feeds
passed in by the caller. Missing PTS, board, disclosure, or sector feeds never
create a positive score by assumption.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any

import numpy as np
import pandas as pd

POSITIVE_WEIGHTS = {
    "material": 20.0,
    "volume": 20.0,
    "indicationPts": 15.0,
    "technical": 15.0,
    "marketSector": 10.0,
    "liquidity": 10.0,
}
MAX_RISK_DEDUCTION = 30.0
FORBIDDEN_INTRADAY_INPUTS = [
    "current_session_high",
    "current_session_close",
    "current_session_volume",
    "post_open_price",
]


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _pct_change(now: float, before: float) -> float:
    return ((now / before) - 1.0) * 100.0 if before else 0.0


def _date_label(index_value: Any) -> str:
    if hasattr(index_value, "date"):
        return str(index_value.date())
    return str(index_value)


def _rsi(values: list[float], period: int = 14) -> float:
    if len(values) <= period:
        return 50.0
    deltas = np.diff(values[-(period + 1):])
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = float(np.mean(gains))
    avg_loss = float(np.mean(losses))
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return float(100.0 - (100.0 / (1.0 + rs)))


def _atr_pct(hist: pd.DataFrame, period: int = 14) -> float:
    if len(hist) < 2:
        return 0.0
    frame = hist.tail(period + 1)
    ranges = []
    previous_close = None
    for _, row in frame.iterrows():
        high = _finite(row.get("High"))
        low = _finite(row.get("Low"))
        close = _finite(row.get("Close"))
        if previous_close is None:
            true_range = high - low
        else:
            true_range = max(high - low, abs(high - previous_close), abs(low - previous_close))
        ranges.append(true_range)
        previous_close = close
    latest_close = _finite(frame["Close"].iloc[-1])
    return (float(np.mean(ranges[-period:])) / latest_close * 100.0) if latest_close and ranges else 0.0


def _yoriten_rate(hist: pd.DataFrame) -> float:
    frame = hist.tail(120)
    if len(frame) < 20:
        return 0.0
    count = 0
    total = 0
    for _, row in frame.iterrows():
        open_price = _finite(row.get("Open"))
        high = _finite(row.get("High"))
        close = _finite(row.get("Close"))
        if not open_price:
            continue
        total += 1
        intraday_high_pct = _pct_change(high, open_price)
        close_from_open_pct = _pct_change(close, open_price)
        if intraday_high_pct >= 2.0 and close_from_open_pct <= 0.2:
            count += 1
    return (count / total * 100.0) if total else 0.0


def _risk_flag(flag_id: str, label: str, severity: str, detail: str) -> dict[str, str]:
    return {"id": flag_id, "label": label, "severity": severity, "detail": detail}


def build_preopen_report(
    ticker: str,
    hist: pd.DataFrame,
    *,
    company_name: str | None = None,
    optional_feeds: dict[str, Any] | None = None,
    asof_label: str | None = None,
) -> dict[str, Any]:
    """Build a 0-100 pre-open candidate score with explicit risk deductions."""

    if hist is None or hist.empty or len(hist) < 30:
        raise ValueError("at least 30 completed daily bars are required")

    feeds = optional_feeds or {}
    hist = hist.dropna(subset=["Open", "High", "Low", "Close"]).copy()
    if "Volume" not in hist.columns:
        hist["Volume"] = 0
    hist["Volume"] = hist["Volume"].fillna(0)

    latest = hist.iloc[-1]
    latest_close = _finite(latest.get("Close"))
    previous_close = _finite(hist["Close"].iloc[-2]) if len(hist) >= 2 else latest_close
    closes = [_finite(value) for value in hist["Close"].tolist()]
    volumes = [_finite(value) for value in hist["Volume"].tolist()]
    recent_volumes = volumes[-21:-1] if len(volumes) >= 21 else volumes[:-1]
    avg_volume_20 = float(np.mean(recent_volumes)) if recent_volumes else 0.0
    latest_volume = volumes[-1] if volumes else 0.0
    volume_ratio_20 = latest_volume / avg_volume_20 if avg_volume_20 else 0.0
    turnover_values = [c * v for c, v in zip(closes[-20:], volumes[-20:])]
    avg_turnover_20 = float(np.mean(turnover_values)) if turnover_values else 0.0
    rsi = _rsi(closes)
    momentum5 = _pct_change(latest_close, closes[-6]) if len(closes) >= 6 else 0.0
    momentum20 = _pct_change(latest_close, closes[-21]) if len(closes) >= 21 else 0.0
    prev_return = _pct_change(latest_close, previous_close)
    atr_pct = _atr_pct(hist)
    yoriten_rate = _yoriten_rate(hist)
    source = str(hist.attrs.get("source") or "unknown")
    synthetic = bool(hist.attrs.get("synthetic")) or source == "synthetic"

    material_available = bool(feeds.get("materialAvailable"))
    material_signal = _finite(feeds.get("materialScore"), 0.0) if material_available else 0.0
    material_score = _clip(material_signal, 0.0, 1.0) * POSITIVE_WEIGHTS["material"]

    pts_available = feeds.get("ptsChangePct") is not None or feeds.get("preopenIndicationPct") is not None
    pts_change = _finite(feeds.get("ptsChangePct"), 0.0)
    indication_change = _finite(feeds.get("preopenIndicationPct"), 0.0)
    indication_score = 0.0
    if pts_available:
        feed_move = max(pts_change, indication_change)
        indication_score = _clip((feed_move + 1.0) / 5.0, 0.0, 1.0) * POSITIVE_WEIGHTS["indicationPts"]

    volume_score = _clip((volume_ratio_20 - 0.7) / 1.3, 0.0, 1.0) * POSITIVE_WEIGHTS["volume"]
    trend_points = 0.0
    if momentum5 > 0:
        trend_points += 4.0
    if momentum20 > 2.0:
        trend_points += 4.0
    if 45.0 <= rsi <= 72.0:
        trend_points += 4.0
    elif 72.0 < rsi <= 80.0:
        trend_points += 2.0
    if prev_return > -1.8:
        trend_points += 3.0
    technical_score = _clip(trend_points, 0.0, POSITIVE_WEIGHTS["technical"])

    market_available = feeds.get("marketSectorScore") is not None
    market_sector_score = _clip(_finite(feeds.get("marketSectorScore"), 4.0), 0.0, 10.0)
    liquidity_score = 0.0
    if avg_turnover_20 >= 500_000_000:
        liquidity_score += 5.0
    elif avg_turnover_20 >= 150_000_000:
        liquidity_score += 3.5
    elif avg_turnover_20 >= 50_000_000:
        liquidity_score += 2.0
    if avg_volume_20 >= 300_000:
        liquidity_score += 5.0
    elif avg_volume_20 >= 100_000:
        liquidity_score += 3.0
    elif avg_volume_20 >= 30_000:
        liquidity_score += 1.5
    liquidity_score = _clip(liquidity_score, 0.0, POSITIVE_WEIGHTS["liquidity"])

    risk_flags: list[dict[str, str]] = []
    risk_deduction = 0.0
    if not material_available:
        risk_flags.append(_risk_flag("material_unavailable", "材料未確認", "medium", "ニュース・適時開示フィードが未接続のため、材料性は加点していません。"))
        risk_deduction += 2.0
    if not pts_available:
        risk_flags.append(_risk_flag("pts_indication_unavailable", "PTS・気配未接続", "medium", "PTSまたは寄り前気配が未接続のため、気配スコアは加点していません。"))
        risk_deduction += 2.0
    if not market_available:
        risk_flags.append(_risk_flag("sector_unavailable", "地合い未確認", "low", "市場・セクター強度は中立より控えめに評価しています。"))
        risk_deduction += 1.0
    if synthetic:
        risk_flags.append(_risk_flag("synthetic_history", "代替データ", "high", "価格取得失敗時の代替履歴です。実運用判断の根拠には使わないでください。"))
        risk_deduction += 10.0
    if avg_turnover_20 < 50_000_000 or avg_volume_20 < 30_000:
        risk_flags.append(_risk_flag("low_liquidity", "流動性注意", "high", "20日平均の売買代金または出来高が小さく、約定可能性を厳しく見る必要があります。"))
        risk_deduction += 8.0
    if rsi >= 82.0 or momentum5 >= 10.0:
        risk_flags.append(_risk_flag("overheated", "過熱注意", "high", "短期上昇またはRSIが高く、急騰後反落のリスクがあります。"))
        risk_deduction += 7.0
    if atr_pct >= 6.0:
        risk_flags.append(_risk_flag("high_volatility", "値幅大", "medium", "ATR比率が高く、寄り付き後のブレが大きい可能性があります。"))
        risk_deduction += 5.0
    if yoriten_rate >= 24.0:
        risk_flags.append(_risk_flag("yoriten_risk", "寄り天注意", "medium", "過去に寄り後高値をつけて終値が伸びない日が多い銘柄です。"))
        risk_deduction += 5.0

    risk_deduction = _clip(risk_deduction, 0.0, MAX_RISK_DEDUCTION)
    positive_score = material_score + volume_score + indication_score + technical_score + market_sector_score + liquidity_score
    score = _clip(positive_score - risk_deduction, 0.0, 100.0)

    if score >= 72.0 and risk_deduction <= 12.0 and not synthetic:
        decision = "SURGE_CANDIDATE"
        decision_label = "高騰候補"
    elif score >= 55.0 and not synthetic:
        decision = "WATCH_CANDIDATE"
        decision_label = "監視候補"
    else:
        decision = "RISK_REVIEW"
        decision_label = "リスク確認"

    key_reasons = []
    if volume_score >= 12.0:
        key_reasons.append(f"前日出来高倍率 {volume_ratio_20:.1f}倍")
    if technical_score >= 10.0:
        key_reasons.append(f"短期モメンタム {momentum5:.1f}% / RSI {rsi:.0f}")
    if liquidity_score >= 7.0:
        key_reasons.append("流動性条件が相対的に良好")
    if material_score > 0:
        key_reasons.append("材料フィードで加点")
    if indication_score > 0:
        key_reasons.append("PTS・気配で加点")
    if not key_reasons:
        key_reasons.append("寄り前で確認できる強い加点材料は限定的")

    unavailable_inputs = []
    if not material_available:
        unavailable_inputs.append("news_disclosure")
    if not pts_available:
        unavailable_inputs.append("pts_or_preopen_board")
    if not market_available:
        unavailable_inputs.append("market_sector_strength")

    latest_index = hist.index[-1]
    return {
        "ticker": ticker,
        "name": company_name or ticker,
        "asOfDate": asof_label or _date_label(latest_index),
        "score": round(score, 1),
        "positiveScore": round(positive_score, 1),
        "riskDeduction": round(risk_deduction, 1),
        "decision": decision,
        "decisionLabel": decision_label,
        "scoreBreakdown": {
            "material": round(material_score, 1),
            "volume": round(volume_score, 1),
            "indicationPts": round(indication_score, 1),
            "technical": round(technical_score, 1),
            "marketSector": round(market_sector_score, 1),
            "liquidity": round(liquidity_score, 1),
            "riskDeduction": round(risk_deduction, 1),
        },
        "features": {
            "previousCloseReturnPct": round(prev_return, 2),
            "volumeRatio20d": round(volume_ratio_20, 2),
            "avgVolume20d": round(avg_volume_20, 0),
            "avgTurnover20dJpy": round(avg_turnover_20, 0),
            "momentum5Pct": round(momentum5, 2),
            "momentum20Pct": round(momentum20, 2),
            "rsi": round(rsi, 1),
            "atrPct": round(atr_pct, 2),
            "yoritenRatePct": round(yoriten_rate, 1),
            "ptsChangePct": round(pts_change, 2) if pts_available else None,
            "preopenIndicationPct": round(indication_change, 2) if pts_available else None,
        },
        "riskFlags": risk_flags,
        "keyReasons": key_reasons[:4],
        "watchPoints": [
            "寄り付き後の板厚、スプレッド、VWAP乖離を確認",
            "出来高が伴わない急伸は監視候補から外す",
            "損切り条件と最大投入額を先に固定",
        ],
        "dataLeakGuard": {
            "usesOnlyPreopenSafeInputs": True,
            "forbiddenInputsExcluded": FORBIDDEN_INTRADAY_INPUTS,
            "unavailableInputs": unavailable_inputs,
            "historySource": source,
            "usesSyntheticHistory": synthetic,
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
        "disclaimer": "これは投資助言ではなく、寄り付き前に確認可能な情報を使った分析支援スコアです。",
    }
