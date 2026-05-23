"""Zen Stock Prophet Pro backend.

The server is intentionally simulator-only. It provides market research,
watchlist, and paper-trading surfaces, but never sends live broker orders.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

try:
    from alert_engine import build_watchlist_alert_report
except Exception:  # pragma: no cover - optional integration
    build_watchlist_alert_report = None

try:
    from daily_digest import build_daily_digest
except Exception:  # pragma: no cover - optional integration
    build_daily_digest = None

try:
    from advanced_analysis import build_advanced_report
except Exception:  # pragma: no cover - optional integration
    build_advanced_report = None

try:
    from preopen_scoring import build_preopen_report
except Exception:  # pragma: no cover - optional integration
    build_preopen_report = None

try:
    from local_env import load_local_env
    load_local_env()
except Exception:
    pass

DB_PATH = Path(os.environ.get("ZEN_DB_PATH", BACKEND_DIR / "simulator.db"))
INITIAL_CASH = 1_000_000
NUM_SELECTED = 12
API_HOST = os.environ.get("ZEN_API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("ZEN_API_PORT", "8889"))
DEFAULT_CORS_ORIGINS = "http://localhost:5174,http://127.0.0.1:5174"
ALLOWED_CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ZEN_CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
LIVE_BROKER_ORDERS_ENABLED = False
PORTFOLIO_ACTIVE = "ACTIVE"
PORTFOLIO_SOLD = "SOLD"
PORTFOLIO_VOIDED = "VOIDED"
PORTFOLIO_ARCHIVED = "ARCHIVED"
PORTFOLIO_CLOSED_STATUSES = {PORTFOLIO_SOLD, PORTFOLIO_VOIDED, PORTFOLIO_ARCHIVED}

PINNED_WATCH_TICKER = "4980.T"
JPX_LISTED_ISSUES_URL = os.environ.get(
    "ZEN_JPX_LISTED_ISSUES_URL",
    "https://www.jpx.co.jp/english/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_e.xls",
)
JPX_UPDATED_ISSUES_URL = os.environ.get(
    "ZEN_JPX_UPDATED_ISSUES_URL",
    "https://www.jpx.co.jp/english/markets/statistics-equities/misc/tvdivq0000001vg2-att/jyoujyou(updated)_e.xlsx",
)
JPX_UNIVERSE_PATH = os.environ.get("ZEN_JPX_UNIVERSE_PATH", "")
SCREEN_MAX_UNIVERSE = int(os.environ.get("ZEN_SCREEN_MAX_UNIVERSE", "0") or 0)
SCREEN_BATCH_SIZE = max(10, int(os.environ.get("ZEN_SCREEN_BATCH_SIZE", "80") or 80))


def watch_candidate(score: float, reason: str, rank: int | None = None, must_include: bool = False) -> dict[str, Any]:
    return {
        "candidate_score": score,
        "candidate_reason": reason,
        "candidate_rank": rank,
        "must_include": must_include,
    }


MUST_INCLUDE: dict[str, dict[str, Any]] = {
    PINNED_WATCH_TICKER: {
        "name": "デクセリアルズ",
        "emoji": "DX",
        "is_prime": True,
        "must_include": True,
        "candidate_score": 100,
        "candidate_rank": 1,
        "candidate_reason": "固定観察銘柄です。国内市場スキャンの候補と常に比較します。",
    },
}

FALLBACK_CANDIDATE_POOL: dict[str, dict[str, Any]] = {
    "6503.T": {"name": "三菱電機", "emoji": "ME", "is_prime": True},
    "4980.T": {"name": "デクセリアルズ", "emoji": "DX", "is_prime": True},
    "7203.T": {"name": "トヨタ自動車", "emoji": "TY", "is_prime": True},
    "6758.T": {"name": "ソニーグループ", "emoji": "SY", "is_prime": True},
    "8035.T": {"name": "東京エレクトロン", "emoji": "TE", "is_prime": True},
    "6857.T": {"name": "アドバンテスト", "emoji": "AD", "is_prime": True},
    "6920.T": {"name": "レーザーテック", "emoji": "LS", "is_prime": True},
    "6501.T": {"name": "日立製作所", "emoji": "HI", "is_prime": True},
    "7011.T": {"name": "三菱重工業", "emoji": "MH", "is_prime": True},
    "4063.T": {"name": "信越化学工業", "emoji": "SE", "is_prime": True},
    "7974.T": {"name": "任天堂", "emoji": "ND", "is_prime": True},
    "8306.T": {"name": "三菱UFJフィナンシャル・グループ", "emoji": "BK", "is_prime": True},
}

STOCKS: dict[str, dict[str, Any]] = dict(MUST_INCLUDE)
SCREENING_PROGRESS = {"status": "idle", "message": "待機中", "progress": 0, "total": 0}


def _normalize_jpx_code(value: Any) -> str:
    if pd.isna(value):
        return ""
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else ""
    code = str(value).strip()
    if code.endswith(".0") and code[:-2].isdigit():
        return code[:-2]
    return code


def normalize_candidate_score(raw_score: float) -> int:
    return max(1, min(99, round(50 + raw_score)))


def load_market_universe() -> dict[str, dict[str, Any]]:
    sources = [source for source in (JPX_UNIVERSE_PATH, JPX_LISTED_ISSUES_URL, JPX_UPDATED_ISSUES_URL) if source]
    frame = None
    for source in sources:
        try:
            frame = pd.read_excel(source, dtype={"Local Code": str})
            break
        except Exception:
            continue
    if frame is None:
        return dict(FALLBACK_CANDIDATE_POOL)

    universe: dict[str, dict[str, Any]] = {}
    for _, row in frame.iterrows():
        code = _normalize_jpx_code(row.get("Local Code"))
        if not (code.isdigit() and len(code) == 4):
            continue
        section = str(row.get("Section/Products", ""))
        section_lower = section.lower()
        if "foreign" in section_lower:
            continue
        if "domestic" not in section_lower and not any(market in section_lower for market in ("prime", "standard", "growth")):
            continue
        ticker = f"{code}.T"
        name = str(row.get("Name (English)") or row.get("Name") or ticker).strip()
        sector = str(row.get("33 Sector(name)") or row.get("17 Sector(name)") or "").strip()
        universe[ticker] = {
            "name": name if name and name.lower() != "nan" else ticker,
            "emoji": "JP",
            "is_prime": "prime" in section_lower,
            "market_section": section,
            "sector": sector,
        }

    if PINNED_WATCH_TICKER in MUST_INCLUDE:
        universe[PINNED_WATCH_TICKER] = {**universe.get(PINNED_WATCH_TICKER, {}), **MUST_INCLUDE[PINNED_WATCH_TICKER]}
    return universe or dict(FALLBACK_CANDIDATE_POOL)


def _history_from_download(downloaded: pd.DataFrame | None, ticker: str) -> pd.DataFrame | None:
    if downloaded is None or downloaded.empty:
        return None
    try:
        if isinstance(downloaded.columns, pd.MultiIndex):
            if ticker in downloaded.columns.get_level_values(0):
                hist = downloaded[ticker].copy()
            elif ticker in downloaded.columns.get_level_values(-1):
                hist = downloaded.xs(ticker, axis=1, level=-1).copy()
            else:
                return None
        else:
            hist = downloaded.copy()
        return clean_price_history(hist)
    except Exception:
        return None


def _candidate_from_history(ticker: str, info: dict[str, Any], hist: pd.DataFrame | None) -> dict[str, Any] | None:
    hist = clean_price_history(hist)
    if hist is None or hist.empty or len(hist) < 30:
        return None

    prices = hist["Close"].tolist()
    highs = hist["High"].tolist()
    lows = hist["Low"].tolist()
    volumes = hist["Volume"].tolist()
    price = _finite(prices[-1])
    rr = calculate_risk_reward(price, highs, lows, prices)
    quality = build_candidate_quality(prices, highs, lows, volumes, rr=rr)
    preopen_report = preopen_for_ticker(ticker, info, hist)
    analysis = TechnicalAnalyzer.analyze(prices, price)
    score_parts = [quality["qualityScore"]]
    if preopen_report:
        score_parts.append(preopen_report["score"])
    score = round(float(np.mean(score_parts)), 1)
    if analysis["execution"]["decision"] == "AVOID":
        score = max(1, score - 12)
    reason = " / ".join(preopen_report["keyReasons"][:2]) if preopen_report else analysis["reason"]
    return {
        "ticker": ticker,
        "info": {
            **info,
            "candidate_quality": quality,
            "preopen_report": preopen_report,
        },
        "score": score,
        "reason": reason,
    }


def _merge_display_candidates(*candidate_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in candidate_groups:
        for candidate in group:
            ticker = candidate.get("ticker")
            if not ticker or ticker in seen:
                continue
            seen.add(ticker)
            merged.append(candidate)
    return sorted(merged, key=lambda item: item["score"], reverse=True)


def _publish_watchlist_candidates(candidates: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    global STOCKS
    new_stocks = {ticker: dict(info) for ticker, info in MUST_INCLUDE.items()}
    count = 0
    for item in sorted(candidates, key=lambda value: value["score"], reverse=True):
        ticker = item["ticker"]
        if ticker in new_stocks:
            continue
        rank = len(new_stocks) + count + 1
        new_stocks[ticker] = {
            **item.get("info", {}),
            **watch_candidate(item["score"], item.get("reason", "AIスクリーニング候補です。"), rank=rank),
        }
        count += 1
        if count >= max(0, NUM_SELECTED - len(MUST_INCLUDE)):
            break
    STOCKS = new_stocks
    return new_stocks


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except Exception:
        return default


def _calc_rsi_window(prices: list[float], period: int = 14) -> float:
    if len(prices) <= period:
        return 50.0
    deltas = np.diff(prices[-(period + 1):])
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains) or 0.0001
    avg_loss = np.mean(losses) or 0.0001
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def calculate_risk_reward(current_price: float, highs: list[float], lows: list[float], prices: list[float]) -> dict[str, Any]:
    recent_low = min(lows[-20:]) if len(lows) >= 20 else current_price * 0.92
    stop_loss = max(recent_low, current_price * 0.96)
    risk_pct = max(((current_price - stop_loss) / current_price) * 100, 0.1)

    lookback_highs = highs[-80:] if len(highs) >= 80 else highs
    current_high = max(lookback_highs) if lookback_highs else current_price
    breakout = current_price >= current_high * 0.975
    target_price = current_price * (1.08 if breakout else 1.05)
    reward_pct = ((target_price / current_price) - 1) * 100
    rr_ratio = round(reward_pct / risk_pct, 2)

    resistance_zones = []
    blocking = []
    for high in sorted({round(value, 1) for value in lookback_highs if value > current_price * 1.005})[:3]:
        resistance_zones.append(high)
        if high < target_price:
            blocking.append(high)

    if breakout:
        blocking = []
        rr_ratio = max(rr_ratio, 2.2)

    return {
        "stop_loss": round(stop_loss, 1),
        "target_price": round(target_price, 1),
        "risk_pct": round(risk_pct, 2),
        "reward_pct": round(reward_pct, 2),
        "rr_ratio": rr_ratio,
        "is_favorable": rr_ratio >= 2.0 and not blocking,
        "resistance_zones": resistance_zones,
        "blocking_resistance_zones": blocking,
    }


def estimate_next_day_backtest(prices: list[float], volumes: list[float]) -> dict[str, Any]:
    if len(prices) < 35:
        return {"sampleCount": 0, "winRate": 0, "avgNextDayReturnPct": 0, "medianNextDayReturnPct": 0}
    returns: list[float] = []
    for index in range(21, len(prices) - 1):
        prior = prices[: index + 1]
        if prior[-6] <= 0 or prior[-21] <= 0:
            continue
        mom5 = (prior[-1] / prior[-6] - 1) * 100
        mom20 = (prior[-1] / prior[-21] - 1) * 100
        rsi = _calc_rsi_window(prior)
        if mom5 > 0.8 and mom20 > 3.0 and 45 <= rsi <= 78:
            returns.append((prices[index + 1] / prices[index] - 1) * 100)
    if not returns:
        return {"sampleCount": 0, "winRate": 0, "avgNextDayReturnPct": 0, "medianNextDayReturnPct": 0}
    return {
        "sampleCount": len(returns),
        "winRate": round(sum(1 for value in returns if value > 0) / len(returns) * 100, 1),
        "avgNextDayReturnPct": round(float(np.mean(returns)), 2),
        "medianNextDayReturnPct": round(float(np.median(returns)), 2),
    }


def build_candidate_quality(
    prices: list[float],
    highs: list[float],
    lows: list[float],
    volumes: list[float],
    rr: dict[str, Any] | None = None,
    vcp_ok: bool = False,
    accum_ok: bool = False,
) -> dict[str, Any]:
    current = prices[-1] if prices else 0
    mom5 = (current / prices[-6] - 1) * 100 if len(prices) >= 6 and prices[-6] else 0
    mom20 = (current / prices[-21] - 1) * 100 if len(prices) >= 21 and prices[-21] else 0
    rsi = _calc_rsi_window(prices)
    avg_vol20 = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else 0
    vol_ratio = (volumes[-1] / avg_vol20) if avg_vol20 else 0
    rr = rr or calculate_risk_reward(current, highs, lows, prices)
    backtest = estimate_next_day_backtest(prices, volumes)

    gates = [
        {"id": "momentum", "label": "5日/20日モメンタム", "passed": bool(mom5 > 0.8 and mom20 > 3.0), "ok": bool(mom5 > 0.8 and mom20 > 3.0)},
        {"id": "rsi", "label": "RSI適温帯", "passed": bool(45 <= rsi <= 78), "ok": bool(45 <= rsi <= 78)},
        {"id": "liquidity", "label": "流動性", "passed": bool(avg_vol20 >= 100_000), "ok": bool(avg_vol20 >= 100_000)},
        {"id": "rr", "label": "リスク・リワード", "passed": bool(_finite(rr.get("rr_ratio")) >= 1.6), "ok": bool(_finite(rr.get("rr_ratio")) >= 1.6)},
        {"id": "backtest", "label": "翌日パターン検証", "passed": bool(backtest["sampleCount"] >= 3 and backtest["winRate"] >= 52), "ok": bool(backtest["sampleCount"] >= 3 and backtest["winRate"] >= 52)},
    ]
    if vcp_ok:
        gates.append({"id": "vcp", "label": "VCP収縮", "passed": True, "ok": True})
    if accum_ok:
        gates.append({"id": "accumulation", "label": "大口買い蓄積", "passed": True, "ok": True})

    score = 45
    score += min(max(mom5, -4) * 2.2, 16)
    score += min(max(mom20, -8) * 1.15, 20)
    score += max(0, 12 - abs(rsi - 62) * 0.45)
    score += min(vol_ratio * 4, 8)
    score += min(_finite(rr.get("rr_ratio")) * 4, 12)
    if backtest["sampleCount"]:
        score += (backtest["winRate"] - 50) * 0.35 + backtest["avgNextDayReturnPct"] * 2.0
    if vcp_ok:
        score += 4
    if accum_ok:
        score += 4

    warnings = []
    if rsi > 78:
        warnings.append("RSIが過熱しています。追いかけ買いは避けます。")
    if vol_ratio < 0.8:
        warnings.append("出来高確認が弱いです。")
    if _finite(rr.get("rr_ratio")) < 1.6:
        warnings.append("リスク・リワードが十分ではありません。")

    return {
        "qualityScore": round(max(1, min(99, score)), 1),
        "metrics": {
            "momentum5": round(mom5, 2),
            "momentum20": round(mom20, 2),
            "rsi": rsi,
            "volumeRatio": round(vol_ratio, 2),
            "rrRatio": rr.get("rr_ratio", 0),
        },
        "backtest": backtest,
        "gates": gates,
        "warnings": warnings,
    }


def quality_for_ticker(ticker: str) -> dict[str, Any] | None:
    hist = get_stock_data(ticker, period="6mo", interval="1d")
    if hist is None or hist.empty or len(hist) < 30:
        return None
    prices = hist["Close"].tolist()
    highs = hist["High"].tolist()
    lows = hist["Low"].tolist()
    volumes = hist["Volume"].tolist()
    rr = calculate_risk_reward(prices[-1], highs, lows, prices)
    return build_candidate_quality(prices, highs, lows, volumes, rr=rr)


def preopen_for_ticker(ticker: str, info: dict[str, Any] | None = None, hist: pd.DataFrame | None = None) -> dict[str, Any] | None:
    if build_preopen_report is None:
        return None
    source_hist = hist if hist is not None else get_stock_data(ticker, period="6mo", interval="1d")
    if source_hist is None or source_hist.empty or len(source_hist) < 30:
        return None
    try:
        return build_preopen_report(
            ticker,
            source_hist,
            company_name=(info or {}).get("name", ticker),
        )
    except Exception:
        return None


def clean_price_history(hist: pd.DataFrame | None) -> pd.DataFrame | None:
    if hist is None or hist.empty:
        return hist
    required = ["Open", "High", "Low", "Close"]
    existing = [col for col in required if col in hist.columns]
    if existing:
        hist = hist.dropna(subset=existing)
    if "Volume" in hist.columns:
        hist["Volume"] = hist["Volume"].fillna(0)
    return hist


def get_stock_data(ticker: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame | None:
    try:
        hist = yf.Ticker(ticker).history(period=period, interval=interval, timeout=6)
        hist = clean_price_history(hist)
        if hist is not None:
            hist.attrs["source"] = "yfinance"
            hist.attrs["synthetic"] = False
        return hist
    except Exception:
        hist = _synthetic_history(ticker)
        hist.attrs["source"] = "synthetic"
        hist.attrs["synthetic"] = True
        return hist


def normalize_portfolio_ticker(value: Any) -> str:
    ticker = str(value or "").strip().upper().replace(" ", "")
    if not ticker:
        return ""
    if ticker.endswith(".T"):
        return ticker
    if ticker.isdigit() and len(ticker) in {4, 5}:
        return f"{ticker[:4]}.T"
    return ticker


def _round_review_price(price: float) -> float:
    if price < 1_000:
        tick = 0.1
    elif price < 3_000:
        tick = 0.5
    elif price < 10_000:
        tick = 1
    elif price < 30_000:
        tick = 5
    else:
        tick = 10
    return round(math.floor(max(price, 0) / tick) * tick, 1)


def _average_true_range(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    if len(closes) < 2:
        return max(closes[-1] * 0.025, 1) if closes else 1
    true_ranges = []
    for index in range(1, len(closes)):
        high = highs[index] if index < len(highs) else closes[index]
        low = lows[index] if index < len(lows) else closes[index]
        prev_close = closes[index - 1]
        true_ranges.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    window = true_ranges[-period:] if len(true_ranges) >= period else true_ranges
    return float(np.mean(window)) if window else max(closes[-1] * 0.025, 1)


def _portfolio_market_context() -> dict[str, Any]:
    proxies = [
        ("^N225", "Nikkei 225"),
        ("^TOPX", "TOPIX"),
        ("JPY=X", "USDJPY"),
    ]
    items = []
    for ticker, label in proxies:
        try:
            frame = get_stock_data(ticker, period="5d", interval="1d")
            closes = frame["Close"].tolist() if frame is not None and not frame.empty else []
            latest = _finite(closes[-1]) if closes else None
            previous = _finite(closes[-2]) if len(closes) >= 2 else None
            change_pct = round(((latest / previous) - 1) * 100, 2) if latest and previous else None
            items.append({"ticker": ticker, "label": label, "price": latest, "changePct": change_pct})
        except Exception as exc:
            items.append({"ticker": ticker, "label": label, "price": None, "changePct": None, "error": str(exc)})

    equity_changes = [
        item["changePct"]
        for item in items
        if item["ticker"] in {"^N225", "^TOPX"} and item.get("changePct") is not None
    ]
    risk_off = bool(equity_changes) and all(change <= -1.2 for change in equity_changes)
    risk_on = bool(equity_changes) and all(change >= 0.8 for change in equity_changes)
    tone = "RISK_OFF" if risk_off else "RISK_ON" if risk_on else "NORMAL"
    summary = (
        "Nikkei/TOPIX are both weak; tighten exits and avoid averaging down."
        if risk_off
        else "Nikkei/TOPIX are supportive; winners can be trailed while stops stay fixed."
        if risk_on
        else "Market tone is mixed; use stock-specific trend and risk lines."
    )
    return {"tone": tone, "riskOff": risk_off, "riskOn": risk_on, "summary": summary, "items": items}


def build_exit_plan(
    *,
    ticker: str,
    shares: int,
    avg_cost: float,
    hist: pd.DataFrame | None,
    market_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    market_context = market_context or _portfolio_market_context()
    frame = clean_price_history(hist)
    closes = [_finite(value) for value in (frame["Close"].tolist() if frame is not None and not frame.empty else [])]
    highs = [_finite(value) for value in (frame["High"].tolist() if frame is not None and not frame.empty else closes)]
    lows = [_finite(value) for value in (frame["Low"].tolist() if frame is not None and not frame.empty else closes)]
    volumes = [_finite(value) for value in (frame["Volume"].tolist() if frame is not None and not frame.empty and "Volume" in frame else [])]
    closes = [value for value in closes if value > 0]
    current_price = closes[-1] if closes else _finite(avg_cost)
    avg_cost = max(_finite(avg_cost), 0.01)
    shares = max(int(shares or 0), 0)

    rsi = _calc_rsi_window(closes) if closes else 50
    sma5 = TechnicalAnalyzer.calculate_sma(closes, 5)
    sma25 = TechnicalAnalyzer.calculate_sma(closes, 25)
    sma75 = TechnicalAnalyzer.calculate_sma(closes, 75)
    mom5 = (current_price / closes[-6] - 1) * 100 if len(closes) >= 6 and closes[-6] else 0
    mom20 = (current_price / closes[-21] - 1) * 100 if len(closes) >= 21 and closes[-21] else 0
    atr = _average_true_range(highs, lows, closes)
    avg_vol20 = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else 0
    volume_ratio = volumes[-1] / avg_vol20 if avg_vol20 and volumes else 0
    pnl_pct = ((current_price / avg_cost) - 1) * 100

    first_target = avg_cost * 1.08
    stretch_target = max(avg_cost * 1.15, current_price + atr * 2.5)
    protective_stop = max(avg_cost * 0.95, current_price - atr * 2.6)
    if pnl_pct >= 4:
        protective_stop = max(avg_cost * 1.005, current_price - atr * 2.2, (sma25 or 0) * 0.985)
    if pnl_pct >= 8:
        protective_stop = max(avg_cost * 1.03, current_price - atr * 1.8, (sma5 or 0) * 0.985)

    sell_review_shares = shares if shares < 200 else max(100, (shares // 2 // 100) * 100)
    hold_allowed = True
    if current_price <= avg_cost * 0.95 or (sma25 and current_price < sma25 and mom5 < -2):
        action = "RISK_EXIT"
        label = "リスク撤退"
        timing = "本日から次営業日までに、反発を待たず損失拡大を止める候補です。"
        review_price = _round_review_price(current_price * 0.995)
        sell_review_shares = shares
        hold_allowed = False
    elif pnl_pct >= 8 and (current_price >= first_target * 0.985 or rsi >= 74 or market_context.get("riskOff")):
        action = "SCALE_OUT"
        label = "一部利確"
        timing = "本日から2営業日以内に、100株単位で利益を確定し、残りは逆指値を引き上げます。"
        review_price = _round_review_price(max(current_price * 0.998, first_target))
    elif pnl_pct >= 14 or rsi >= 80:
        action = "TAKE_PROFIT"
        label = "過熱利確"
        timing = "当日中の指値確認対象です。急騰後の失速前に利益確定を優先します。"
        review_price = _round_review_price(current_price * 0.998)
        sell_review_shares = shares
    elif pnl_pct > 0 and current_price <= protective_stop:
        action = "TRAIL_STOP_HIT"
        label = "トレーリング停止"
        timing = "終値で保護ラインを割ったため、翌営業日の寄付き前に売却候補として再確認します。"
        review_price = _round_review_price(current_price * 0.995)
        sell_review_shares = shares
        hold_allowed = False
    elif mom20 > 3 and (not sma25 or current_price > sma25) and 45 <= rsi <= 76 and not market_context.get("riskOff"):
        action = "HOLD_RIDE_TREND"
        label = "保有継続"
        timing = "1から5営業日は上昇トレンドを追跡し、利確目標とトレーリング停止を毎日更新します。"
        review_price = _round_review_price(first_target)
    else:
        action = "HOLD_WITH_STOP"
        label = "保有・逆指値管理"
        timing = "地合いと25日線を確認しながら、損切りラインを割るまでは保有候補です。"
        review_price = _round_review_price(first_target)

    confidence = 50
    confidence += min(max(abs(pnl_pct), 0), 18)
    confidence += 8 if len(closes) >= 60 else 0
    confidence += 6 if avg_vol20 >= 100_000 else 0
    confidence += 6 if action in {"RISK_EXIT", "SCALE_OUT", "TAKE_PROFIT"} else 0
    if market_context.get("riskOff") and action.startswith("HOLD"):
        confidence -= 8

    return {
        "source": "local_market_research",
        "ticker": ticker,
        "action": action,
        "label": label,
        "holdAllowed": hold_allowed,
        "timing": timing,
        "reviewPrice": _round_review_price(review_price),
        "targetPrice": _round_review_price(first_target),
        "stretchTargetPrice": _round_review_price(stretch_target),
        "stopLoss": _round_review_price(protective_stop),
        "sellReviewShares": sell_review_shares,
        "pnlPct": round(pnl_pct, 2),
        "confidence": round(max(1, min(95, confidence)), 1),
        "marketTone": market_context.get("tone", "NORMAL"),
        "marketSummary": market_context.get("summary", ""),
        "marketResearch": [
            {"label": "5日モメンタム", "value": round(mom5, 2), "unit": "%"},
            {"label": "20日モメンタム", "value": round(mom20, 2), "unit": "%"},
            {"label": "RSI", "value": round(rsi, 1), "unit": ""},
            {"label": "ATR", "value": round(atr, 1), "unit": "JPY"},
            {"label": "出来高倍率", "value": round(volume_ratio, 2), "unit": "x"},
            {"label": "25日線", "value": sma25, "unit": "JPY"},
        ],
        "rules": [
            "8%以上の含み益は100株単位で利確候補にする",
            "利益が乗ったら損切りラインを建値以上へ引き上げる",
            "25日線割れと5日モメンタム悪化は撤退候補にする",
            "RISK_OFF地合いでは保有継続の判定を一段厳しくする",
        ],
        "disclaimer": "Decision support only. This app does not place orders or provide personal investment advice.",
    }


def build_history_context(hist: pd.DataFrame | None) -> dict[str, Any]:
    frame = clean_price_history(hist)
    if frame is None or frame.empty:
        return {
            "source": "unavailable",
            "latestBarDate": None,
            "latestBarAgeDays": None,
            "changePct": 0,
            "recentWindow": {},
            "freshness": {"priceOk": False, "newsOk": False, "latestNewsAgeDays": None},
            "news": {"count": 0, "items": [], "latestPublishedAt": None},
        }

    latest_index = frame.index[-1]
    if hasattr(latest_index, "date"):
        latest_date = latest_index.date()
    else:
        try:
            latest_date = dt.date.fromisoformat(str(latest_index)[:10])
        except ValueError:
            latest_date = None
    latest_bar_date = latest_date.isoformat() if latest_date else str(latest_index)
    latest_age_days = (dt.date.today() - latest_date).days if latest_date else None

    closes = [_finite(value) for value in frame["Close"].tolist()]
    volumes = [_finite(value) for value in frame["Volume"].tolist()] if "Volume" in frame else []
    change_pct = ((closes[-1] / closes[-2]) - 1) * 100 if len(closes) >= 2 and closes[-2] else 0
    window = frame.tail(11)
    window_closes = [_finite(value) for value in window["Close"].tolist()]
    window_dates = list(window.index)
    price_change_pct = ((window_closes[-1] / window_closes[0]) - 1) * 100 if len(window_closes) >= 2 and window_closes[0] else 0
    avg_vol20 = float(np.mean(volumes[-21:-1])) if len(volumes) >= 21 else 0
    volume_ratio = volumes[-1] / avg_vol20 if avg_vol20 and volumes else 0

    def _date_label(value: Any) -> str:
        return value.date().isoformat() if hasattr(value, "date") else str(value)[:10]

    return {
        "source": "yfinance_or_local_fallback",
        "latestBarDate": latest_bar_date,
        "latestBarAgeDays": latest_age_days,
        "changePct": round(change_pct, 2),
        "recentWindow": {
            "from": _date_label(window_dates[0]) if window_dates else latest_bar_date,
            "to": _date_label(window_dates[-1]) if window_dates else latest_bar_date,
            "tradingDays": len(window),
            "priceChangePct": round(price_change_pct, 2),
            "volumeRatio": round(volume_ratio, 2),
        },
        "freshness": {
            "priceOk": latest_age_days is not None and latest_age_days <= 5,
            "newsOk": False,
            "latestNewsAgeDays": None,
        },
        "news": {"count": 0, "items": [], "latestPublishedAt": None},
    }


def _synthetic_history(ticker: str) -> pd.DataFrame:
    base = 3048 if ticker == "6503.T" else 2700 if ticker == "4980.T" else 2000
    dates = pd.date_range(end=dt.date.today(), periods=90, freq="B")
    rows = []
    for idx, date in enumerate(dates):
        drift = idx * (base * 0.0018)
        wave = math.sin(idx / 4) * (base * 0.012)
        close = base * 0.84 + drift + wave
        rows.append({
            "Date": date,
            "Open": close * 0.996,
            "High": close * 1.012,
            "Low": close * 0.988,
            "Close": close,
            "Volume": 500_000 + idx * 4_000,
        })
    return pd.DataFrame(rows).set_index("Date")


class TechnicalAnalyzer:
    @staticmethod
    def calculate_sma(prices: list[float], period: int) -> float | None:
        return round(float(np.mean(prices[-period:])), 2) if len(prices) >= period else None

    @staticmethod
    def calculate_rsi(prices: list[float], period: int = 14) -> float:
        return _calc_rsi_window(prices, period)

    @staticmethod
    def build_execution_plan(raw_signal, confidence, current_price, buy_limit, sell_limit, stop_loss):
        if not current_price or not buy_limit or not stop_loss:
            return {
                "decision": "WATCH",
                "label": "観察",
                "headline": "実行可能な注文価格を作るにはデータが不足しています。",
                "plainReason": "株価データが薄いため、いまは新規注文を出さずに待ちます。",
                "entryCondition": "データ更新後に再確認",
                "avoidCondition": "根拠が揃うまで買わない",
                "entryGapPct": 0,
                "maxChasePrice": 0,
                "riskPerShare": 0,
                "targetUpsidePct": 0,
                "orderStyle": "limit_only",
                "marketAllowed": False,
            }

        risk = max(buy_limit - stop_loss, current_price * 0.015)
        if sell_limit <= max(current_price, buy_limit):
            sell_limit = max(buy_limit + risk * 3, current_price * 1.03)
        entry_gap_pct = ((buy_limit / current_price) - 1) * 100 if current_price else 0
        raw_is_buy = raw_signal in {"BUY", "STRONG_BUY"}
        raw_is_sell = raw_signal in {"SELL", "STRONG_SELL"}

        if raw_is_sell:
            decision = "AVOID"
            label = "買わない"
            headline = "買いよりも撤退・見送りを優先します。"
            plain_reason = "テクニカルが売り優勢です。反発待ちで先回りする局面ではありません。"
            entry_condition = "買いシグナルへ反転するまで待つ"
        elif raw_is_buy and confidence >= 68 and -1.5 <= entry_gap_pct <= 0.35:
            decision = "DAYTRADE_ENTRY_OK"
            label = "デイトレ候補"
            headline = "本日、手入力で監視できる価格帯のデイトレ候補です。"
            plain_reason = "現在値近辺の上限指値で入る候補です。寄付き後に出来高、板厚、スプレッド、VWAP付近を確認します。"
            entry_condition = f"寄付き後5分以内に {buy_limit:,.0f}円以下を上限。スプレッドが薄く、出来高が伴う場合のみ。"
        elif raw_is_buy and entry_gap_pct < -1.5:
            decision = "REPRICE_FOR_DAYTRADE"
            label = "価格再計算"
            headline = "買い候補ですが、指値が遠すぎるためデイトレ用に再計算します。"
            plain_reason = f"現在値から{abs(entry_gap_pct):.1f}%下の指値は、本日約定しない可能性が高いです。"
            entry_condition = "寄付き後の板と出来高を確認し、現在値から0.35%以内の上限指値に再計算"
        elif raw_is_buy and confidence >= 60:
            decision = "BUY_LIMIT_OK"
            label = "監視候補"
            headline = "本日監視できる範囲の上限価格で検討する候補です。"
            plain_reason = "買いシグナルと注文価格の距離が許容範囲です。条件が崩れた場合は見送ります。"
            entry_condition = f"{buy_limit:,.0f}円以下を上限。寄付き直後のスプレッド拡大時は見送り。"
        else:
            decision = "WATCH"
            label = "観察"
            headline = "根拠が薄いため、買い候補にはまだ入れません。"
            plain_reason = "複数指標の足並みが揃っていません。候補として監視し、条件が揃ったら再評価します。"
            entry_condition = "買いシグナル、出来高、値動き幅が揃うまで待つ"

        return {
            "decision": decision,
            "label": label,
            "headline": headline,
            "plainReason": plain_reason,
            "entryCondition": entry_condition,
            "avoidCondition": f"{stop_loss:,.0f}円を明確に割る、または出来高を伴って下落するなら見送り。",
            "entryGapPct": round(entry_gap_pct, 2),
            "maxChasePrice": round(float(buy_limit * 1.015), 1),
            "riskPerShare": round(float(max(buy_limit - stop_loss, 0)), 1),
            "targetUpsidePct": round(((sell_limit / buy_limit) - 1) * 100, 2) if buy_limit else 0,
            "orderStyle": "near_limit_or_market_review" if decision in {"DAYTRADE_ENTRY_OK", "BUY_LIMIT_OK"} else "limit_only",
            "marketAllowed": decision == "DAYTRADE_ENTRY_OK",
        }

    @classmethod
    def analyze(cls, prices: list[float], current_price: float) -> dict[str, Any]:
        if len(prices) < 5 or not math.isfinite(current_price):
            return {"signal": "HOLD", "confidence": 30, "reason": "データが不足しています。", "indicators": {}}
        sma5 = cls.calculate_sma(prices, 5)
        sma25 = cls.calculate_sma(prices, 25)
        sma75 = cls.calculate_sma(prices, 75)
        rsi = cls.calculate_rsi(prices)
        mom5 = (current_price / prices[-6] - 1) * 100 if len(prices) >= 6 and prices[-6] else 0
        mom20 = (current_price / prices[-21] - 1) * 100 if len(prices) >= 21 and prices[-21] else 0

        score = 0
        reasons = []
        if sma5 and sma25 and current_price > sma5 > sma25:
            score += 3
            reasons.append("短期トレンドが上向きに揃っています。")
        if sma75 and current_price > sma75:
            score += 1
            reasons.append("中長期トレンドも崩れていません。")
        if mom5 > 1 and mom20 > 5 and 45 <= rsi <= 75:
            score += 4
            reasons.append(f"デイトレ向けモメンタムが強いです。5日 {mom5:.1f}%、20日 {mom20:.1f}%、RSI {rsi:.0f}。")
        elif mom5 > 0 and mom20 > 0 and rsi < 78:
            score += 2
            reasons.append(f"モメンタムが改善しています。5日 {mom5:.1f}%、20日 {mom20:.1f}%。")
        if rsi > 80:
            score -= 3
            reasons.append("RSIが過熱しています。")

        if score >= 6:
            signal, confidence = "STRONG_BUY", min(95, 62 + score * 4)
        elif score >= 3:
            signal, confidence = "BUY", min(82, 54 + score * 5)
        elif score <= -3:
            signal, confidence = "SELL", 65
        else:
            signal, confidence = "HOLD", 45 + abs(score) * 4

        if signal in {"BUY", "STRONG_BUY"} and confidence >= 60:
            buy_limit = current_price * (1.002 if confidence >= 68 else 1.001)
            stop_loss = current_price * 0.992
            risk = buy_limit - stop_loss
            sell_limit = max(current_price * 1.012, buy_limit + risk * 1.6)
        else:
            buy_limit = current_price * 0.985
            stop_loss = current_price * 0.965
            sell_limit = current_price * 1.035

        rr = (sell_limit - buy_limit) / max(buy_limit - stop_loss, 0.01)
        execution = cls.build_execution_plan(signal, confidence, current_price, buy_limit, sell_limit, stop_loss)
        return {
            "signal": signal,
            "confidence": round(confidence, 1),
            "reason": " ".join(reasons) if reasons else "明確なシグナルはまだありません。",
            "technicalSummary": " / ".join(reasons[:2]) if reasons else "明確なシグナルはまだありません。",
            "indicators": {"sma5": sma5, "sma25": sma25, "sma75": sma75, "rsi": rsi, "momentum5": round(mom5, 2), "momentum20": round(mom20, 2)},
            "strategy": {
                "buy_limit": round(buy_limit, 1),
                "sell_limit": round(sell_limit, 1),
                "stop_loss": round(stop_loss, 1),
                "rr_ratio": round(rr, 2),
            },
            "execution": execution,
        }


def _stock_payload(ticker: str, info: dict[str, Any]) -> dict[str, Any]:
    hist = get_stock_data(ticker, period="6mo", interval="1d")
    if hist is None or hist.empty:
        price = 0
        analysis = TechnicalAnalyzer.analyze([], 0)
        quality = None
    else:
        price = _finite(hist["Close"].iloc[-1])
        analysis = TechnicalAnalyzer.analyze(hist["Close"].tolist(), price)
        quality = build_candidate_quality(
            hist["Close"].tolist(),
            hist["High"].tolist(),
            hist["Low"].tolist(),
            hist["Volume"].tolist(),
            rr=calculate_risk_reward(price, hist["High"].tolist(), hist["Low"].tolist(), hist["Close"].tolist()),
        )
    preopen_report = preopen_for_ticker(ticker, info, hist if hist is not None and not hist.empty else None)
    live_score = preopen_report["score"] if preopen_report else (quality["qualityScore"] if quality else analysis["confidence"])
    live_reason = " / ".join(preopen_report["keyReasons"][:2]) if preopen_report else analysis["reason"]
    return {
        "ticker": ticker,
        "name": info.get("name", ticker),
        "emoji": info.get("emoji", "STK"),
        "price": round(price, 1),
        "signal": analysis["signal"],
        "confidence": analysis["confidence"],
        "decision": analysis["execution"]["decision"],
        "preopenDecision": preopen_report["decisionLabel"] if preopen_report else None,
        "preopenScore": preopen_report["score"] if preopen_report else None,
        "preopenReport": preopen_report,
        "riskFlags": preopen_report["riskFlags"] if preopen_report else [],
        "watchPoints": preopen_report["watchPoints"] if preopen_report else [],
        "buyLimit": analysis["strategy"]["buy_limit"],
        "sellLimit": analysis["strategy"]["sell_limit"],
        "stopLoss": analysis["strategy"]["stop_loss"],
        "rrRatio": analysis["strategy"]["rr_ratio"],
        "entryGapPct": analysis["execution"]["entryGapPct"],
        "candidateScore": live_score,
        "candidateReason": live_reason,
        "publishedCandidateScore": info.get("candidate_score"),
        "publishedCandidateReason": info.get("candidate_reason"),
        "candidateRank": info.get("candidate_rank"),
        "mustInclude": bool(info.get("must_include")),
        "candidateQuality": quality,
    }


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS portfolio (id INTEGER PRIMARY KEY AUTOINCREMENT, cash REAL NOT NULL DEFAULT 1000000, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    conn.execute("CREATE TABLE IF NOT EXISTS holdings (ticker TEXT PRIMARY KEY, shares INTEGER DEFAULT 0, avg_cost REAL DEFAULT 0, manual_name TEXT, updated_at TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, action TEXT, shares INTEGER, price REAL, total REAL, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    conn.execute("CREATE TABLE IF NOT EXISTS agent_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT, timestamp TEXT DEFAULT CURRENT_TIMESTAMP)")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(holdings)").fetchall()}
    if "manual_name" not in columns:
        conn.execute("ALTER TABLE holdings ADD COLUMN manual_name TEXT")
    if "updated_at" not in columns:
        conn.execute("ALTER TABLE holdings ADD COLUMN updated_at TEXT")
    if "status" not in columns:
        conn.execute("ALTER TABLE holdings ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'")
    if "lifecycle_reason" not in columns:
        conn.execute("ALTER TABLE holdings ADD COLUMN lifecycle_reason TEXT")
    if "closed_at" not in columns:
        conn.execute("ALTER TABLE holdings ADD COLUMN closed_at TEXT")
    if conn.execute("SELECT COUNT(*) FROM portfolio").fetchone()[0] == 0:
        conn.execute("INSERT INTO portfolio (cash) VALUES (?)", (INITIAL_CASH,))
    for ticker in STOCKS:
        conn.execute("INSERT OR IGNORE INTO holdings (ticker, shares, avg_cost, status) VALUES (?, 0, 0, ?)", (ticker, PORTFOLIO_ACTIVE))
    conn.commit()
    conn.close()


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


app = FastAPI(title="Zen Stock Prophet Pro", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/stocks")
def get_stocks() -> list[dict[str, Any]]:
    items = [_stock_payload(ticker, info) for ticker, info in STOCKS.items()]
    return sorted(items, key=lambda item: (item.get("candidateRank") or 999, -_finite(item.get("candidateScore"))))


@app.get("/api/stock/{ticker}")
def get_stock_detail(ticker: str) -> dict[str, Any]:
    info = STOCKS.get(ticker) or FALLBACK_CANDIDATE_POOL.get(ticker) or {"name": ticker, "emoji": "STK"}
    hist = get_stock_data(ticker, period="6mo", interval="1d")
    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail="No stock data")
    price = _finite(hist["Close"].iloc[-1])
    analysis = TechnicalAnalyzer.analyze(hist["Close"].tolist(), price)
    quality = build_candidate_quality(
        hist["Close"].tolist(),
        hist["High"].tolist(),
        hist["Low"].tolist(),
        hist["Volume"].tolist(),
        rr=calculate_risk_reward(price, hist["High"].tolist(), hist["Low"].tolist(), hist["Close"].tolist()),
    )
    preopen_report = preopen_for_ticker(ticker, info, hist)
    chart = [
        {
            "date": str(index.date() if hasattr(index, "date") else index),
            "open": round(_finite(row["Open"]), 1),
            "high": round(_finite(row["High"]), 1),
            "low": round(_finite(row["Low"]), 1),
            "close": round(_finite(row["Close"]), 1),
            "volume": int(_finite(row["Volume"])),
        }
        for index, row in hist.tail(80).iterrows()
    ]
    history_context = build_history_context(hist)
    return {
        "ticker": ticker,
        "name": info.get("name", ticker),
        "price": round(price, 1),
        "analysis": analysis,
        "chart": chart,
        "candidateQuality": quality,
        "preopenReport": preopen_report,
        "preopenScore": preopen_report["score"] if preopen_report else None,
        "preopenDecision": preopen_report["decisionLabel"] if preopen_report else None,
        "riskFlags": preopen_report["riskFlags"] if preopen_report else [],
        "watchPoints": preopen_report["watchPoints"] if preopen_report else [],
        **history_context,
    }


@app.get("/api/preopen/{ticker}")
def get_preopen_analysis(ticker: str) -> dict[str, Any]:
    info = STOCKS.get(ticker) or FALLBACK_CANDIDATE_POOL.get(ticker) or {"name": ticker, "emoji": "STK"}
    report = preopen_for_ticker(ticker, info)
    if report is None:
        raise HTTPException(status_code=503, detail="Pre-open scoring engine unavailable")
    return report


@app.get("/api/analysis/advanced/{ticker}")
def get_advanced_analysis(ticker: str) -> dict[str, Any]:
    if build_advanced_report is None:
        raise HTTPException(status_code=503, detail="Advanced analysis engine unavailable")
    hist = get_stock_data(ticker, period="1y", interval="1d")
    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail="No stock data")
    try:
        return build_advanced_report(ticker, hist, capital_jpy=INITIAL_CASH, risk_pct=1.0)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/portfolio")
def get_portfolio() -> dict[str, Any]:
    init_db()
    conn = get_db()
    row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    holdings = conn.execute("SELECT * FROM holdings WHERE shares > 0 AND status = ? ORDER BY updated_at DESC", (PORTFOLIO_ACTIVE,)).fetchall()
    archived_holdings = conn.execute(
        """
        SELECT * FROM holdings
        WHERE status IN (?, ?, ?)
        ORDER BY COALESCE(closed_at, updated_at) DESC, ticker ASC
        LIMIT 20
        """,
        (PORTFOLIO_SOLD, PORTFOLIO_VOIDED, PORTFOLIO_ARCHIVED),
    ).fetchall()
    conn.close()
    cash = float(row["cash"]) if row else INITIAL_CASH
    holding_items = []
    total_value = 0.0
    total_cost = 0.0
    market_context = _portfolio_market_context()
    for holding in holdings:
        ticker = holding["ticker"]
        info = STOCKS.get(ticker) or FALLBACK_CANDIDATE_POOL.get(ticker) or {"name": ticker}
        hist = get_stock_data(ticker, period="6mo", interval="1d")
        if hist is not None and not hist.empty:
            price = _finite(hist["Close"].iloc[-1])
        else:
            price = _finite(holding["avg_cost"])
        shares = int(holding["shares"])
        avg_cost = _finite(holding["avg_cost"])
        value = price * holding["shares"]
        entry_notional = avg_cost * shares
        pnl = value - entry_notional
        pnl_pct = (pnl / entry_notional * 100) if entry_notional else 0
        total_value += value
        total_cost += entry_notional
        name = holding["manual_name"] or info.get("name", ticker)
        holding_items.append({
            "ticker": ticker,
            "name": name,
            "emoji": info.get("emoji", "JP"),
            "shares": shares,
            "status": holding["status"],
            "avgCost": round(avg_cost, 1),
            "entryNotional": round(entry_notional, 1),
            "price": round(price, 1),
            "currentPrice": round(price, 1),
            "value": round(value, 1),
            "pnl": round(pnl, 1),
            "pnlPct": round(pnl_pct, 2),
            "updatedAt": holding["updated_at"],
            "closedAt": holding["closed_at"],
            "lifecycleReason": holding["lifecycle_reason"],
            "exitPlan": build_exit_plan(
                ticker=ticker,
                shares=shares,
                avg_cost=avg_cost,
                hist=hist,
                market_context=market_context,
            ),
        })
    archived_items = []
    for holding in archived_holdings:
        ticker = holding["ticker"]
        info = STOCKS.get(ticker) or FALLBACK_CANDIDATE_POOL.get(ticker) or {"name": ticker}
        archived_items.append({
            "ticker": ticker,
            "name": holding["manual_name"] or info.get("name", ticker),
            "emoji": info.get("emoji", "JP"),
            "shares": int(holding["shares"] or 0),
            "avgCost": round(_finite(holding["avg_cost"]), 1),
            "status": holding["status"],
            "updatedAt": holding["updated_at"],
            "closedAt": holding["closed_at"],
            "lifecycleReason": holding["lifecycle_reason"],
        })
    history = [{"date": str((dt.date.today() - dt.timedelta(days=idx)).isoformat()), "value": INITIAL_CASH + idx * 1500} for idx in range(30, 0, -1)]
    total_assets = cash + total_value
    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else 0
    return {
        "cash": round(cash, 1),
        "holdings": holding_items,
        "archivedHoldings": archived_items,
        "totalAssets": round(total_assets, 1),
        "totalPnl": round(total_pnl, 1),
        "totalPnlPct": round(total_pnl_pct, 2),
        "initialCash": INITIAL_CASH,
        "marketContext": market_context,
        "history": history,
    }


@app.get("/api/transactions")
def get_transactions() -> list[dict[str, Any]]:
    conn = get_db()
    rows = conn.execute("SELECT * FROM transactions ORDER BY id DESC LIMIT 50").fetchall()
    conn.close()
    return [{"id": r["id"], "ticker": r["ticker"], "name": STOCKS.get(r["ticker"], {}).get("name", r["ticker"]), "action": r["action"], "shares": r["shares"], "price": r["price"], "total": r["total"], "reason": r["reason"], "createdAt": r["created_at"]} for r in rows]


@app.get("/api/screen/progress")
def screen_progress() -> dict[str, Any]:
    return SCREENING_PROGRESS


@app.post("/api/screen")
def run_screen() -> dict[str, Any]:
    universe = load_market_universe()
    items = list(universe.items())
    if SCREEN_MAX_UNIVERSE > 0:
        items = items[:SCREEN_MAX_UNIVERSE]

    candidates = []
    SCREENING_PROGRESS.update({"status": "running", "message": "JPX universe screening", "progress": 0, "total": len(items)})
    for start in range(0, len(items), SCREEN_BATCH_SIZE):
        batch = items[start:start + SCREEN_BATCH_SIZE]
        tickers = [ticker for ticker, _ in batch]
        try:
            downloaded = yf.download(
                tickers,
                period="6mo",
                interval="1d",
                group_by="ticker",
                threads=True,
                progress=False,
                timeout=12,
            )
        except Exception:
            downloaded = None

        for ticker, info in batch:
            hist = _history_from_download(downloaded, ticker)
            candidate = _candidate_from_history(ticker, info, hist)
            if candidate is not None:
                candidates.append(candidate)
            elif ticker in FALLBACK_CANDIDATE_POOL:
                quality = quality_for_ticker(ticker)
                score = quality["qualityScore"] if quality else 50
                candidates.append({
                    "ticker": ticker,
                    "info": {**info, "candidate_quality": quality},
                    "score": score,
                    "reason": "Fallback screening candidate.",
                })

        SCREENING_PROGRESS.update({
            "status": "running",
            "message": "JPX universe screening",
            "progress": min(start + len(batch), len(items)),
            "total": len(items),
        })

    _publish_watchlist_candidates(candidates)
    top_candidates = sorted(candidates, key=lambda value: value["score"], reverse=True)[:10]
    SCREENING_PROGRESS.update({"status": "completed", "message": "JPX universe screening completed", "progress": len(items), "total": len(items)})
    return {
        "selected": list(STOCKS),
        "top_candidates": top_candidates,
        "stats": {
            "analyzed": len(candidates),
            "universe": len(items),
            "fixed_watchlist": [PINNED_WATCH_TICKER],
            "source": JPX_UNIVERSE_PATH or JPX_LISTED_ISSUES_URL,
        },
    }


@app.get("/api/alerts/watchlist")
def alerts_watchlist() -> dict[str, Any]:
    if build_watchlist_alert_report:
        try:
            return build_watchlist_alert_report(STOCKS, get_stock_data, TechnicalAnalyzer)
        except Exception as exc:
            return {"alerts": [], "error": str(exc)}
    return {"alerts": [], "summary": "アラートエンジンは利用できません。"}


@app.get("/api/research/jquants/status")
def jquants_status() -> dict[str, Any]:
    return {"available": False, "mode": "not_configured", "message": "このローカル実行ではJ-Quants接続は未設定です。"}


@app.get("/api/news/{ticker}")
def get_news(ticker: str) -> dict[str, Any]:
    return {"overall_sentiment": "neutral", "items": [], "news": [], "ticker": ticker}


@app.get("/api/agent-logs")
def get_agent_logs() -> list[dict[str, Any]]:
    conn = get_db()
    rows = conn.execute("SELECT timestamp, message FROM agent_logs ORDER BY id DESC LIMIT 15").fetchall()
    conn.close()
    return [{"timestamp": row["timestamp"], "message": row["message"]} for row in rows]


class TradeRequest(BaseModel):
    ticker: str
    shares: int


class PortfolioPositionRequest(BaseModel):
    ticker: str
    shares: int
    entryPrice: float
    name: str | None = None
    note: str | None = None
    purchasedAt: str | None = None


class PortfolioLifecycleRequest(BaseModel):
    action: str
    price: float | None = None
    reason: str | None = None


def _record_manual_position(request: PortfolioPositionRequest) -> dict[str, Any]:
    ticker = normalize_portfolio_ticker(request.ticker)
    shares = int(request.shares or 0)
    entry_price = _finite(request.entryPrice)
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    if shares <= 0:
        raise HTTPException(status_code=400, detail="shares must be positive")
    if entry_price <= 0:
        raise HTTPException(status_code=400, detail="entryPrice must be positive")

    init_db()
    conn = get_db()
    existing = conn.execute("SELECT shares, avg_cost FROM holdings WHERE ticker = ?", (ticker,)).fetchone()
    current_shares = int(existing["shares"]) if existing else 0
    current_avg = _finite(existing["avg_cost"]) if existing else 0
    next_shares = current_shares + shares
    next_avg = ((current_shares * current_avg) + (shares * entry_price)) / next_shares
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO holdings (ticker, shares, avg_cost, manual_name, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
            shares = excluded.shares,
            avg_cost = excluded.avg_cost,
            manual_name = COALESCE(excluded.manual_name, holdings.manual_name),
            status = 'ACTIVE',
            lifecycle_reason = NULL,
            closed_at = NULL,
            updated_at = excluded.updated_at
        """,
        (ticker, next_shares, next_avg, request.name, now),
    )
    row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    cash = float(row["cash"]) if row else INITIAL_CASH
    total = shares * entry_price
    conn.execute("UPDATE portfolio SET cash = ?", (max(cash - total, 0),))
    conn.execute(
        "INSERT INTO transactions (ticker, action, shares, price, total, reason) VALUES (?, ?, ?, ?, ?, ?)",
        (ticker, "MANUAL_BUY", shares, entry_price, total, request.note or "manual portfolio entry"),
    )
    conn.execute(
        "INSERT INTO agent_logs (message) VALUES (?)",
        (f"Recorded manual holding {ticker} {shares} shares at {entry_price:.1f}. Simulator-only; no broker order.",),
    )
    conn.commit()
    conn.close()
    return {
        "success": True,
        "mode": "SIMULATOR_ONLY",
        "message": f"Recorded {ticker} {shares} shares at {entry_price:.1f}. No broker order was sent.",
        "ticker": ticker,
        "shares": next_shares,
        "avgCost": round(next_avg, 1),
    }


@app.post("/api/portfolio/positions")
def save_portfolio_position(request: PortfolioPositionRequest) -> dict[str, Any]:
    return _record_manual_position(request)


@app.post("/api/portfolio/positions/{ticker}/lifecycle")
def update_portfolio_position_lifecycle(ticker: str, request: PortfolioLifecycleRequest) -> dict[str, Any]:
    normalized = normalize_portfolio_ticker(ticker)
    action = (request.action or "").strip().upper()
    if action not in PORTFOLIO_CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail="action must be SOLD, VOIDED, or ARCHIVED")

    init_db()
    conn = get_db()
    holding = conn.execute("SELECT * FROM holdings WHERE ticker = ?", (normalized,)).fetchone()
    if not holding or int(holding["shares"] or 0) <= 0:
        conn.close()
        raise HTTPException(status_code=404, detail="active holding not found")
    if holding["status"] != PORTFOLIO_ACTIVE:
        conn.close()
        raise HTTPException(status_code=409, detail="holding is already closed")

    shares = int(holding["shares"])
    avg_cost = _finite(holding["avg_cost"])
    close_price = _finite(request.price) if request.price is not None else avg_cost
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    reason = (request.reason or "").strip()
    if not reason:
        reason = {
            PORTFOLIO_SOLD: "sold outside simulator; retained as ledger history",
            PORTFOLIO_VOIDED: "mistaken manual entry; retained as correction history",
            PORTFOLIO_ARCHIVED: "no longer needed in active portfolio; retained as ledger history",
        }[action]

    if action == PORTFOLIO_SOLD:
        sale_total = max(close_price, 0) * shares
        row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
        cash = float(row["cash"]) if row else INITIAL_CASH
        conn.execute("UPDATE portfolio SET cash = ?", (cash + sale_total,))
        tx_action = "MANUAL_SELL"
        tx_price = close_price
        tx_total = sale_total
    elif action == PORTFOLIO_VOIDED:
        tx_action = "MANUAL_VOID"
        tx_price = avg_cost
        tx_total = avg_cost * shares
    else:
        tx_action = "MANUAL_ARCHIVE"
        tx_price = avg_cost
        tx_total = avg_cost * shares

    conn.execute(
        """
        UPDATE holdings
        SET status = ?, shares = 0, lifecycle_reason = ?, closed_at = ?, updated_at = ?
        WHERE ticker = ?
        """,
        (action, reason, now, now, normalized),
    )
    conn.execute(
        "INSERT INTO transactions (ticker, action, shares, price, total, reason) VALUES (?, ?, ?, ?, ?, ?)",
        (normalized, tx_action, shares, tx_price, tx_total, reason),
    )
    conn.execute(
        "INSERT INTO agent_logs (message) VALUES (?)",
        (f"Closed portfolio holding {normalized} as {action}. Ledger retained; no broker order.",),
    )
    conn.commit()
    conn.close()
    return {
        "success": True,
        "mode": "SIMULATOR_ONLY",
        "message": f"{normalized} を {action} として台帳に残し、通常ポートフォリオから外しました。実注文は出していません。",
        "ticker": normalized,
        "status": action,
    }


@app.post("/api/buy")
def buy_stock(request: TradeRequest) -> dict[str, Any]:
    return {"success": False, "mode": "SIMULATOR_ONLY", "message": "実買い注文は無効です。手入力前の判断シグナルとしてのみ使用してください。"}


@app.post("/api/sell")
def sell_stock(request: TradeRequest) -> dict[str, Any]:
    return {"success": False, "mode": "SIMULATOR_ONLY", "message": "実売り注文は無効です。手入力前の判断シグナルとしてのみ使用してください。"}


@app.post("/api/reset")
def reset_portfolio() -> dict[str, Any]:
    init_db()
    conn = get_db()
    conn.execute("UPDATE portfolio SET cash = ?", (INITIAL_CASH,))
    conn.execute("UPDATE holdings SET shares = 0, avg_cost = 0")
    conn.execute("DELETE FROM transactions")
    conn.commit()
    conn.close()
    return {"success": True, "message": "シミュレーション用ポートフォリオを初期化しました。"}


@app.post("/api/learn")
def ai_learn() -> dict[str, Any]:
    return {"success": True, "message": "学習結果をローカルに記録しました。"}


@app.get("/api/daytrade/plan")
def get_daytrade_plan() -> dict[str, Any]:
    from daytrade_engine import plan
    return plan()


@app.get("/api/daytrade/signals")
def get_daytrade_signals() -> dict[str, Any]:
    from daytrade_engine import sample_signals
    return {"source": "LOCAL_PAPER_SIMULATION", "signals": sample_signals()}


@app.post("/api/daytrade/scan")
def scan_daytrade_signals() -> dict[str, Any]:
    from daytrade_engine import sample_signals
    signals = sample_signals()
    return {"success": True, "source": "LOCAL_PAPER_SIMULATION", "message": f"ペーパーシグナル検証完了 {len(signals)}件", "orderIntentsPath": None, "signals": signals}


@app.get("/api/daytrade/broker-status")
def get_daytrade_broker_status() -> dict[str, Any]:
    return {"mode": "BROKER_DISABLED", "workbookExists": False, "workbookOpen": False, "excelComAvailable": False, "csvTemplateExists": False, "message": "MarketSpeed連携は無効です。ローカルのペーパーシグナルのみ使用します。"}


@app.get("/api/daytrade/signal-log")
def get_daytrade_signal_log() -> list[dict[str, Any]]:
    return []


@app.post("/api/daytrade/autopilot/start")
def start_daytrade_autopilot() -> dict[str, Any]:
    return {"running": False, "mode": "BROKER_DISABLED", "message": "実注文オートパイロットは無効のままです。"}


@app.post("/api/daytrade/autopilot/stop")
def stop_daytrade_autopilot() -> dict[str, Any]:
    return {"running": False, "mode": "BROKER_DISABLED"}


@app.get("/api/daytrade/autopilot/status")
def get_daytrade_autopilot_status() -> dict[str, Any]:
    return {"running": False, "mode": "BROKER_DISABLED", "intervalSec": 60}


@app.get("/api/daytrade/risk-state")
def get_daytrade_risk_state() -> dict[str, Any]:
    from daytrade_engine import risk_state
    return risk_state()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=API_HOST, port=API_PORT)
