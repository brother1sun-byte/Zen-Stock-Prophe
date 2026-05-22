"""Advanced analysis engine for Zen Stock Prophet Pro.

This module is simulator-only. It turns daily OHLCV history into a compact
decision-support report, but never places orders or calls broker APIs.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except Exception:
        return default


def _round(value: Any, digits: int = 2) -> float:
    return round(_finite(value), digits)


def _sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return round(float(np.mean(values[-period:])), 2)


def _max_drawdown(closes: list[float]) -> float:
    peak = closes[0] if closes else 0
    worst = 0.0
    for close in closes:
        peak = max(peak, close)
        if peak > 0:
            worst = min(worst, (close / peak - 1) * 100)
    return round(worst, 2)


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) <= period:
        return 50.0
    deltas = np.diff(closes[-(period + 1):])
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = float(np.mean(gains)) or 0.0001
    avg_loss = float(np.mean(losses)) or 0.0001
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _atr_pct(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    if len(closes) < 2:
        return 0.0
    ranges = []
    for index in range(1, len(closes)):
        high = highs[index] if index < len(highs) else closes[index]
        low = lows[index] if index < len(lows) else closes[index]
        previous = closes[index - 1]
        ranges.append(max(high - low, abs(high - previous), abs(low - previous)))
    window = ranges[-period:] if len(ranges) >= period else ranges
    atr = float(np.mean(window)) if window else 0.0
    return round((atr / closes[-1]) * 100, 2) if closes[-1] else 0.0


def _return_pct(closes: list[float], lookback: int) -> float:
    if len(closes) <= lookback or not closes[-lookback - 1]:
        return 0.0
    return round((closes[-1] / closes[-lookback - 1] - 1) * 100, 2)


def _volume_ratio(volumes: list[float], period: int = 20) -> float:
    if len(volumes) <= period:
        return 0.0
    baseline = float(np.mean(volumes[-(period + 1):-1]))
    return round(volumes[-1] / baseline, 2) if baseline else 0.0


def _trend_alignment(closes: list[float]) -> dict[str, Any]:
    latest = closes[-1] if closes else 0.0
    sma5 = _sma(closes, 5)
    sma20 = _sma(closes, 20)
    sma60 = _sma(closes, 60)
    bullish = bool(latest and sma5 and sma20 and latest > sma5 > sma20 and (not sma60 or sma20 > sma60))
    bearish = bool(latest and sma5 and sma20 and latest < sma5 < sma20)
    score = 50
    if latest and sma20:
        score += min(max((latest / sma20 - 1) * 220, -18), 18)
    if bullish:
        score += 18
    if bearish:
        score -= 18
    return {
        "score": round(max(1, min(99, score)), 1),
        "state": "BULLISH" if bullish else "BEARISH" if bearish else "MIXED",
        "sma5": sma5,
        "sma20": sma20,
        "sma60": sma60,
    }


def _monte_carlo(closes: list[float], horizon_days: int = 5) -> dict[str, Any]:
    if len(closes) < 35:
        return {"horizonDays": horizon_days, "sampleCount": 0, "expectedReturnPct": 0, "probabilityUpPct": 0, "p05Pct": 0, "p50Pct": 0, "p95Pct": 0}
    returns = np.diff(np.log(np.array(closes[-90:], dtype=float)))
    returns = returns[np.isfinite(returns)]
    if len(returns) < 20:
        return {"horizonDays": horizon_days, "sampleCount": 0, "expectedReturnPct": 0, "probabilityUpPct": 0, "p05Pct": 0, "p50Pct": 0, "p95Pct": 0}
    rng = np.random.default_rng(42)
    simulations = rng.choice(returns, size=(1200, horizon_days), replace=True).sum(axis=1)
    paths = (np.exp(simulations) - 1) * 100
    return {
        "horizonDays": horizon_days,
        "sampleCount": int(len(paths)),
        "expectedReturnPct": _round(np.mean(paths)),
        "probabilityUpPct": _round(np.mean(paths > 0) * 100, 1),
        "p05Pct": _round(np.percentile(paths, 5)),
        "p50Pct": _round(np.percentile(paths, 50)),
        "p95Pct": _round(np.percentile(paths, 95)),
    }


def _factor_scores(closes: list[float], highs: list[float], lows: list[float], volumes: list[float]) -> dict[str, Any]:
    trend = _trend_alignment(closes)
    mom5 = _return_pct(closes, 5)
    mom20 = _return_pct(closes, 20)
    rsi = _rsi(closes)
    atr_pct = _atr_pct(highs, lows, closes)
    vol_ratio = _volume_ratio(volumes)
    drawdown = _max_drawdown(closes[-60:])

    momentum_score = max(1, min(99, 50 + mom5 * 4 + mom20 * 1.2 - max(0, rsi - 76) * 1.8))
    liquidity_score = max(1, min(99, 45 + min(vol_ratio, 3) * 18))
    risk_score = max(1, min(99, 78 - max(0, atr_pct - 2.5) * 7 + max(drawdown, -25) * 0.7))

    return {
        "trend": trend,
        "momentumScore": round(momentum_score, 1),
        "liquidityScore": round(liquidity_score, 1),
        "riskControlScore": round(risk_score, 1),
        "momentum5Pct": mom5,
        "momentum20Pct": mom20,
        "rsi": rsi,
        "atrPct": atr_pct,
        "volumeRatio": vol_ratio,
        "maxDrawdown60Pct": drawdown,
    }


def build_advanced_report(
    ticker: str,
    hist: pd.DataFrame,
    *,
    capital_jpy: float = 1_000_000,
    risk_pct: float = 1.0,
) -> dict[str, Any]:
    """Build a deterministic advanced report from OHLCV history."""
    if hist is None or hist.empty:
        raise ValueError("history is required")

    closes = [_finite(value) for value in hist["Close"].tolist() if _finite(value) > 0]
    highs = [_finite(value) for value in hist["High"].tolist()] if "High" in hist else closes
    lows = [_finite(value) for value in hist["Low"].tolist()] if "Low" in hist else closes
    volumes = [_finite(value) for value in hist["Volume"].tolist()] if "Volume" in hist else []
    if len(closes) < 20:
        raise ValueError("at least 20 closes are required")

    factors = _factor_scores(closes, highs, lows, volumes)
    monte_carlo = _monte_carlo(closes)
    latest = closes[-1]
    atr_pct = factors["atrPct"]
    stop_price = latest * (1 - max(atr_pct * 1.35, 1.2) / 100)
    target_price = latest * (1 + max(atr_pct * 1.8, 2.0) / 100)
    risk_per_share = max(latest - stop_price, latest * 0.008)
    risk_budget = capital_jpy * risk_pct / 100
    shares = int(max(0, math.floor(risk_budget / risk_per_share / 100) * 100))
    rr = (target_price - latest) / risk_per_share if risk_per_share else 0

    composite = (
        factors["trend"]["score"] * 0.28
        + factors["momentumScore"] * 0.24
        + factors["liquidityScore"] * 0.18
        + factors["riskControlScore"] * 0.18
        + max(1, min(99, 45 + monte_carlo["expectedReturnPct"] * 6 + (monte_carlo["probabilityUpPct"] - 50) * 0.7)) * 0.12
    )
    composite = round(max(1, min(99, composite)), 1)

    if composite >= 72 and monte_carlo["probabilityUpPct"] >= 54 and rr >= 1.4:
        verdict = "ADVANCED_READY"
        action_label = "高度分析: 買い候補"
    elif composite >= 58:
        verdict = "WATCHLIST"
        action_label = "高度分析: 監視継続"
    else:
        verdict = "DEFENSIVE"
        action_label = "高度分析: 防御優先"

    return {
        "ticker": ticker,
        "verdict": verdict,
        "actionLabel": action_label,
        "compositeScore": composite,
        "generatedFromBars": len(closes),
        "factors": factors,
        "monteCarlo": monte_carlo,
        "positionPlan": {
            "entryPrice": round(latest, 1),
            "stopPrice": round(stop_price, 1),
            "targetPrice": round(target_price, 1),
            "riskReward": round(rr, 2),
            "riskBudgetJpy": round(risk_budget),
            "suggestedShares": shares,
            "notionalJpy": round(shares * latest),
        },
        "scenarios": [
            {"name": "強気", "returnPct": monte_carlo["p95Pct"], "price": round(latest * (1 + monte_carlo["p95Pct"] / 100), 1)},
            {"name": "標準", "returnPct": monte_carlo["p50Pct"], "price": round(latest * (1 + monte_carlo["p50Pct"] / 100), 1)},
            {"name": "弱気", "returnPct": monte_carlo["p05Pct"], "price": round(latest * (1 + monte_carlo["p05Pct"] / 100), 1)},
        ],
        "guardrails": [
            {"label": "5日確率が上向き", "ok": monte_carlo["probabilityUpPct"] >= 52},
            {"label": "トレンド整列", "ok": factors["trend"]["state"] == "BULLISH"},
            {"label": "過熱しすぎていない", "ok": factors["rsi"] <= 76},
            {"label": "RR 1.4以上", "ok": rr >= 1.4},
            {"label": "100株単位のリスク内", "ok": shares >= 100},
        ],
        "disclaimer": "Simulator-only decision support. No broker order is created.",
    }
