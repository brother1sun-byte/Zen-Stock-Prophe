"""Zen Stock Prophet Pro backend.

The server is intentionally simulator-only. It provides market research,
watchlist, and paper-trading surfaces, but never sends live broker orders.
"""

from __future__ import annotations

import datetime as dt
import email.utils
import html as html_lib
import io
import json
import math
import os
import re
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
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
    from daytrade_analysis import INTERVAL_PERIODS, build_daytrade_analysis
except Exception:  # pragma: no cover - optional integration
    INTERVAL_PERIODS = {"1m": "7d", "5m": "60d", "15m": "60d", "1d": "1y"}
    build_daytrade_analysis = None

try:
    from daytrade_routine import build_commute_daytrade_routine
except Exception:  # pragma: no cover - optional integration
    build_commute_daytrade_routine = None

try:
    from preopen_scoring import build_preopen_report
except Exception:  # pragma: no cover - optional integration
    build_preopen_report = None

try:
    import jquants_bridge
except Exception:  # pragma: no cover - optional integration
    jquants_bridge = None

from analysis_api_service import build_advanced_analysis_response, build_preopen_analysis_response
from daytrade_context_service import (
    build_daytrade_event_context,
    build_daytrade_quote_context,
    news_item_from_yfinance as service_news_item_from_yfinance,
    parse_event_timestamp as service_parse_event_timestamp,
    safe_float as service_safe_float,
)
from edinet_api_service import fetch_edinet_documents_by_date_range
from earnings_calendar_service import build_earnings_calendar_payload
from market_data_api import build_market_search_response, build_market_universe_response
from material_event_service import (
    MATERIAL_IMPORTANT_KEYWORDS,
    MATERIAL_NEGATIVE_KEYWORDS,
    MATERIAL_POSITIVE_KEYWORDS,
    external_research_links as build_external_research_links,
    material_age_days as service_material_age_days,
    material_events_for_ticker as build_material_events_for_ticker,
    parse_material_datetime as service_parse_material_datetime,
    statement_material_item as service_statement_material_item,
    tdnet_recent_items as service_tdnet_recent_items,
)
from market_ranking_api import build_market_rankings_response
from portfolio_api_service import (
    build_portfolio_response,
    close_portfolio_position,
    record_manual_position,
)
from price_history_service import fetch_price_history

try:
    from local_env import load_local_env
    load_local_env()
except Exception:
    pass

DB_PATH = Path(os.environ.get("ZEN_DB_PATH", "").strip() or BACKEND_DIR / "simulator.db")
INITIAL_CASH = 1_000_000
NUM_SELECTED = 12
API_HOST = os.environ.get("ZEN_API_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("ZEN_API_PORT", "8889"))
DEFAULT_CORS_ORIGINS = "http://localhost:5174,http://127.0.0.1:5174"
LOCAL_NETWORK_CORS_PATTERN = r"^http://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):(5174|4174)$"
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
CACHE_DIR = BACKEND_DIR / "cache"
MARKET_SNAPSHOT_PATH = CACHE_DIR / "market_snapshot.json"
MARKET_RANKING_LIMIT = 80
MARKET_SEARCH_LIVE_PRICE_LIMIT = 60
MARKET_SCREENING_SCHEMA_VERSION = 3
MARKET_CONTEXT_MAX_AGE_DAYS = 3
CANDIDATE_PRICE_MAX_AGE_DAYS = 5
CANDIDATE_MIN_HISTORY_BARS = 60
YAHOO_FINANCE_GAINERS_URL = "https://finance.yahoo.co.jp/stocks/ranking/up?market=all&term=daily"
MARKET_TICKER_PATTERN = re.compile(r"^(\^?[A-Z0-9]{1,10}|[0-9A-Z]{4,5}\.T)$")
DEFAULT_INTRADAY_BUDGET_JPY = 500_000
INTRADAY_SHARE_UNIT = 1
DAYTRADE_ANALYSIS_CACHE_TTL_SEC = int(os.environ.get("ZEN_DAYTRADE_ANALYSIS_CACHE_TTL_SEC", "180") or 180)
DAYTRADE_ANALYSIS_CACHE: dict[tuple[str, str], dict[str, Any]] = {}
DAYTRADE_ANALYSIS_INFLIGHT: dict[tuple[str, str], threading.Event] = {}
DAYTRADE_ANALYSIS_CACHE_LOCK = threading.Lock()
DAYTRADE_CONTEXT_CACHE_TTL_SEC = int(os.environ.get("ZEN_DAYTRADE_CONTEXT_CACHE_TTL_SEC", "900") or 900)
DAYTRADE_CONTEXT_TIMEOUT_SEC = max(1.0, float(os.environ.get("ZEN_DAYTRADE_CONTEXT_TIMEOUT_SEC", "6") or 6))
DAYTRADE_CONTEXT_CACHE: dict[str, dict[str, Any]] = {}
DAYTRADE_CONTEXT_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="daytrade-context")
PRICE_HISTORY_CACHE_TTL_SEC = int(os.environ.get("ZEN_PRICE_HISTORY_CACHE_TTL_SEC", "180") or 180)
PRICE_HISTORY_CACHE: dict[tuple[str, str, str], dict[str, Any]] = {}
PRICE_HISTORY_INFLIGHT: dict[tuple[str, str, str], threading.Event] = {}
PRICE_HISTORY_CACHE_LOCK = threading.Lock()
MARKET_REVIEW_CACHE_TTL_SEC = int(os.environ.get("ZEN_MARKET_REVIEW_CACHE_TTL_SEC", "90") or 90)
MARKET_REVIEW_CACHE: dict[str, dict[str, Any]] = {}
MARKET_REVIEW_INFLIGHT: dict[str, threading.Event] = {}
MARKET_REVIEW_CACHE_LOCK = threading.Lock()
JST = dt.timezone(dt.timedelta(hours=9), "JST")
TSE_MORNING_OPEN = dt.time(9, 0)
TSE_MORNING_CLOSE = dt.time(11, 30)
TSE_AFTERNOON_OPEN = dt.time(12, 30)
TSE_AFTERNOON_CLOSE = dt.time(15, 30)
TDNET_RECENT_RSS_URL = os.environ.get("ZEN_TDNET_RECENT_RSS_URL", "https://webapi.yanoshin.jp/webapi/tdnet/list/recent.rss")
TDNET_CODE_RSS_URL_TEMPLATE = os.environ.get(
    "ZEN_TDNET_CODE_RSS_URL_TEMPLATE",
    "https://webapi.yanoshin.jp/webapi/tdnet/list/{code}.rss",
)
STOOQ_API_KEY = os.environ.get("STOOQ_API_KEY", "").strip()
_MISSING = object()


def watch_candidate(score: float, reason: str, rank: int | None = None, must_include: bool = False) -> dict[str, Any]:
    return {
        "candidate_score": score,
        "candidate_reason": reason,
        "candidate_rank": rank,
        "must_include": must_include,
    }


def tokyo_market_status(now: dt.datetime | None = None) -> dict[str, Any]:
    checked_at = now or dt.datetime.now(JST)
    if checked_at.tzinfo is None:
        checked_at = checked_at.replace(tzinfo=JST)
    tokyo_now = checked_at.astimezone(JST)
    weekday = tokyo_now.weekday()
    current_time = tokyo_now.time()
    is_weekend = weekday >= 5
    is_session = (
        TSE_MORNING_OPEN <= current_time < TSE_MORNING_CLOSE
        or TSE_AFTERNOON_OPEN <= current_time < TSE_AFTERNOON_CLOSE
    )
    if is_weekend:
        phase = "WEEKEND_CLOSED"
        label = "休場"
        message = "週末のため東京市場は休場です。過去の日足データをシミュレーション用途でのみ使用します。"
    elif not is_session:
        phase = "OUT_OF_SESSION"
        label = "取引時間外"
        message = "東京市場の取引時間外です。候補は時間外分析の参考情報として確認してください。"
    else:
        phase = "REGULAR_SESSION"
        label = "取引時間中"
        message = "東京市場の取引時間中です。このアプリの表示は引き続きシミュレーション用途として扱ってください。"
    return {
        "isOpen": (not is_weekend) and is_session,
        "phase": phase,
        "label": label,
        "message": message,
        "checkedAt": tokyo_now.isoformat(),
        "timezone": "Asia/Tokyo",
    }


MUST_INCLUDE: dict[str, dict[str, Any]] = {
    PINNED_WATCH_TICKER: {
        "name": "デクセリアルズ",
        "emoji": "DX",
        "is_prime": True,
        "must_include": True,
        "candidate_score": 100,
        "candidate_rank": 1,
        "candidate_reason": "継続確認とシミュレーション比較用の固定監視候補です。",
    },
}

FALLBACK_CANDIDATE_POOL: dict[str, dict[str, Any]] = {
    "6503.T": {"name": "\u4e09\u83f1\u96fb\u6a5f", "emoji": "ME", "is_prime": True, "ranking_metrics": {"changePct": 1.4, "surgeScore": 70, "volumeRatio": 1.9, "popularityScore": 82, "qualityScore": 78, "overheatRisk": 48}},
    "4980.T": {"name": "\u30c7\u30af\u30bb\u30ea\u30a2\u30eb\u30ba", "emoji": "DX", "is_prime": True, "ranking_metrics": {"changePct": 1.2, "surgeScore": 82, "volumeRatio": 1.3, "popularityScore": 84, "qualityScore": 76, "overheatRisk": 42, "high20Breakout": True}},
    "7203.T": {"name": "トヨタ自動車", "emoji": "TY", "is_prime": True, "ranking_metrics": {"changePct": 0.4, "surgeScore": 55, "volumeRatio": 0.9, "popularityScore": 95, "qualityScore": 83, "overheatRisk": 20}},
    "6758.T": {"name": "ソニーグループ", "emoji": "SY", "is_prime": True, "ranking_metrics": {"changePct": 0.7, "surgeScore": 62, "volumeRatio": 1.1, "popularityScore": 90, "qualityScore": 80, "overheatRisk": 28}},
    "8035.T": {"name": "東京エレクトロン", "emoji": "TE", "is_prime": True, "ranking_metrics": {"changePct": 2.1, "surgeScore": 75, "volumeRatio": 2.4, "popularityScore": 88, "qualityScore": 72, "overheatRisk": 68, "high20Breakout": True}},
    "6857.T": {"name": "アドバンテスト", "emoji": "AD", "is_prime": True, "ranking_metrics": {"changePct": 2.5, "surgeScore": 78, "volumeRatio": 2.8, "popularityScore": 86, "qualityScore": 70, "overheatRisk": 74}},
    "6920.T": {"name": "レーザーテック", "emoji": "LS", "is_prime": True, "ranking_metrics": {"changePct": 3.8, "surgeScore": 85, "volumeRatio": 3.2, "popularityScore": 89, "qualityScore": 64, "overheatRisk": 88}},
    "6501.T": {"name": "日立製作所", "emoji": "HI", "is_prime": True, "ranking_metrics": {"changePct": 0.8, "surgeScore": 63, "volumeRatio": 1.4, "popularityScore": 83, "qualityScore": 88, "overheatRisk": 24}},
    "7011.T": {"name": "\u4e09\u83f1\u91cd\u5de5\u696d", "emoji": "MH", "is_prime": True, "ranking_metrics": {"changePct": 1.8, "surgeScore": 76, "volumeRatio": 3.8, "popularityScore": 87, "qualityScore": 73, "overheatRisk": 62}},
    "4063.T": {"name": "信越化学工業", "emoji": "SE", "is_prime": True, "ranking_metrics": {"changePct": 0.5, "surgeScore": 58, "volumeRatio": 1.0, "popularityScore": 81, "qualityScore": 90, "overheatRisk": 18}},
    "7974.T": {"name": "任天堂", "emoji": "ND", "is_prime": True, "ranking_metrics": {"changePct": 0.9, "surgeScore": 60, "volumeRatio": 1.2, "popularityScore": 92, "qualityScore": 86, "overheatRisk": 22}},
    "8306.T": {"name": "\u4e09\u83f1UFJ\u30d5\u30a3\u30ca\u30f3\u30b7\u30e3\u30eb\u30fb\u30b0\u30eb\u30fc\u30d7", "emoji": "BK", "is_prime": True, "ranking_metrics": {"changePct": 1.0, "surgeScore": 66, "volumeRatio": 2.5, "popularityScore": 85, "qualityScore": 82, "overheatRisk": 36}},
}


STOCKS: dict[str, dict[str, Any]] = dict(MUST_INCLUDE)
SCREENING_PROGRESS = {"status": "idle", "message": "Idle", "progress": 0, "total": 0}


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


def _history_from_yahoo_chart(ticker: str) -> pd.DataFrame | None:
    try:
        response = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
            params={"range": "1mo", "interval": "1d"},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        result = ((payload.get("chart") or {}).get("result") or [None])[0]
        if not result:
            return None
        timestamps = result.get("timestamp") or []
        quote = (((result.get("indicators") or {}).get("quote") or [None])[0]) or {}
        rows = []
        for index, timestamp in enumerate(timestamps):
            close = (quote.get("close") or [None] * len(timestamps))[index]
            if close is None:
                continue
            rows.append({
                "Date": dt.datetime.fromtimestamp(timestamp, dt.timezone.utc),
                "Open": (quote.get("open") or [None] * len(timestamps))[index],
                "High": (quote.get("high") or [None] * len(timestamps))[index],
                "Low": (quote.get("low") or [None] * len(timestamps))[index],
                "Close": close,
                "Volume": (quote.get("volume") or [0] * len(timestamps))[index] or 0,
            })
        if not rows:
            return None
        frame = pd.DataFrame(rows).set_index("Date")
        frame.attrs["source"] = "yahoo_chart"
        return clean_price_history(frame)
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
    data_quality = _candidate_data_quality(hist, prices, volumes)
    quality = build_candidate_quality(prices, highs, lows, volumes, rr=rr, data_quality=data_quality)
    preopen_report = preopen_for_ticker(ticker, info, hist)
    analysis = TechnicalAnalyzer.analyze(prices, price)
    score_parts = [quality["qualityScore"]]
    if preopen_report:
        score_parts.append(preopen_report["score"])
    score = round(float(np.mean(score_parts)), 1)
    if not _candidate_data_quality_ok(data_quality):
        score = min(score, quality["qualityScore"])
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


def _latest_bar_label(index_value: Any) -> str:
    if hasattr(index_value, "date"):
        return index_value.date().isoformat()
    return str(index_value)[:10]


def _latest_bar_age_days(value: Any) -> int | None:
    if not value:
        return None
    try:
        latest_date = dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None
    return max(0, (dt.datetime.now(JST).date() - latest_date).days)


def _candidate_data_quality(hist: pd.DataFrame | None, closes: list[float] | None = None, volumes: list[float] | None = None) -> dict[str, Any]:
    if hist is None or hist.empty:
        return {
            "score": 1,
            "verdict": "LOW",
            "label": "データ品質: 不足",
            "bars": 0,
            "source": "unavailable",
            "synthetic": False,
            "sourceOk": False,
            "latestBarDate": None,
            "latestBarAgeDays": None,
            "latestClosePrice": None,
            "priceOk": False,
            "priceFreshnessVerdict": "unknown",
            "maxAgeDays": CANDIDATE_PRICE_MAX_AGE_DAYS,
            "usableCloses": 0,
            "historyDepthOk": False,
            "historyDepthVerdict": "unknown",
            "minHistoryBars": CANDIDATE_MIN_HISTORY_BARS,
            "missingColumns": ["Open", "High", "Low", "Close", "Volume"],
            "nullCount": 0,
            "zeroVolumeDays": 0,
        }
    rows = len(hist)
    closes = closes or [_finite(value) for value in hist["Close"].tolist()] if "Close" in hist else []
    volumes = volumes or [_finite(value) for value in hist["Volume"].tolist()] if "Volume" in hist else []
    required_columns = {"Open", "High", "Low", "Close", "Volume"}
    available_required = list(required_columns & set(hist.columns))
    missing_columns = sorted(required_columns - set(hist.columns))
    null_count = int(hist[available_required].isna().sum().sum()) if rows and available_required else 0
    zero_volume_days = sum(1 for value in volumes if value <= 0)
    source = str(hist.attrs.get("source") or "unknown")
    synthetic = bool(hist.attrs.get("synthetic")) or source.lower() == "synthetic"
    latest_bar_date = _latest_bar_label(hist.index[-1]) if rows else None
    latest_bar_age_days = _latest_bar_age_days(latest_bar_date)
    price_ok = latest_bar_age_days is not None and latest_bar_age_days <= CANDIDATE_PRICE_MAX_AGE_DAYS
    source_ok = bool(not synthetic and source.lower() not in {"", "unknown", "synthetic"})
    usable_closes = len([value for value in closes if value > 0])
    history_depth_ok = rows >= CANDIDATE_MIN_HISTORY_BARS and usable_closes >= CANDIDATE_MIN_HISTORY_BARS

    score = 100
    if rows < 120:
        score -= 12
    if rows < 60:
        score -= 20
    score -= min(len(missing_columns) * 12, 36)
    score -= min(null_count * 1.2, 18)
    if volumes:
        score -= min((zero_volume_days / len(volumes)) * 30, 16)
    else:
        score -= 12
    if synthetic:
        score -= 45
    elif not source_ok:
        score -= 18
    if latest_bar_age_days is None:
        score -= 22
    elif latest_bar_age_days > 30:
        score -= 45
    elif latest_bar_age_days > 10:
        score -= 30
    elif latest_bar_age_days > CANDIDATE_PRICE_MAX_AGE_DAYS:
        score -= 18
    score = round(max(1, min(100, score)), 1)
    verdict = "HIGH" if score >= 85 else "MEDIUM" if score >= 65 else "LOW"
    label = "データ品質: 良好" if verdict == "HIGH" else "データ品質: 要確認" if verdict == "MEDIUM" else "データ品質: 不足"
    return {
        "score": score,
        "verdict": verdict,
        "label": label,
        "bars": rows,
        "usableCloses": usable_closes,
        "source": source,
        "synthetic": synthetic,
        "sourceOk": source_ok,
        "latestBarDate": latest_bar_date,
        "latestBarAgeDays": latest_bar_age_days,
        "latestClosePrice": closes[-1] if closes else None,
        "priceOk": price_ok,
        "priceFreshnessVerdict": "fresh" if price_ok else "stale" if latest_bar_age_days is not None else "unknown",
        "maxAgeDays": CANDIDATE_PRICE_MAX_AGE_DAYS,
        "historyDepthOk": history_depth_ok,
        "historyDepthVerdict": "sufficient" if history_depth_ok else "limited",
        "minHistoryBars": CANDIDATE_MIN_HISTORY_BARS,
        "missingColumns": missing_columns,
        "nullCount": null_count,
        "zeroVolumeDays": zero_volume_days,
    }


def _candidate_data_quality_ok(data_quality: dict[str, Any] | None) -> bool:
    if not data_quality:
        return True
    return bool(
        data_quality.get("sourceOk")
        and data_quality.get("priceOk")
        and data_quality.get("historyDepthOk")
        and _finite(data_quality.get("score")) >= 65
    )


def _data_source_flags(source: Any = None, data_quality: dict[str, Any] | None = None, *, cached: bool = False) -> dict[str, Any]:
    data_quality = data_quality or {}
    source_text = str(source or data_quality.get("source") or "unknown")
    source_lower = source_text.lower()
    synthetic = bool(data_quality.get("synthetic")) or source_lower == "synthetic" or "synthetic" in source_lower
    is_cached = bool(cached) or source_lower == "cache" or "cache" in source_lower
    resolved_source = "cache" if is_cached else source_text
    return {
        "dataSource": resolved_source,
        "data_source": resolved_source,
        "priceSource": resolved_source,
        "synthetic": synthetic,
        "isSynthetic": synthetic,
        "is_synthetic": synthetic,
        "cache": is_cached,
        "isCached": is_cached,
        "is_cached": is_cached,
    }


def _moving_average(values: list[float], period: int, offset: int = 0) -> float | None:
    end = len(values) - offset
    start = end - period
    if start < 0 or end <= 0:
        return None
    return float(np.mean(values[start:end]))


def _surge_profile(
    *,
    price: float,
    closes: list[float],
    volume: float,
    avg_vol20: float,
    turnover: float,
    change_pct: float,
    momentum5: float,
    momentum20: float,
    rsi: float,
) -> dict[str, Any]:
    sma25 = _moving_average(closes, 25)
    sma75 = _moving_average(closes, 75)
    prev_sma25 = _moving_average(closes, 25, offset=1)
    prev_sma75 = _moving_average(closes, 75, offset=1)
    divergence25 = ((price / sma25) - 1) * 100 if sma25 else 0
    divergence75 = ((price / sma75) - 1) * 100 if sma75 else 0
    volume_ratio = volume / avg_vol20 if avg_vol20 else 0
    prev_high_20 = max(closes[-21:-1]) if len(closes) >= 21 else max(closes)
    prev_high_120 = max(closes[:-1]) if len(closes) > 1 else max(closes)
    high_20_breakout = price >= prev_high_20 * 0.995
    ytd_high_breakout = price >= prev_high_120 * 0.995
    golden_cross = bool(sma25 and sma75 and sma25 > sma75 and (prev_sma25 is None or prev_sma75 is None or prev_sma25 <= prev_sma75))
    trend_ok = bool(sma25 and price > sma25 and (not sma75 or sma25 >= sma75 * 0.985))
    deep_liquidity = turnover >= 1_000_000_000 and volume >= 250_000
    tradable_liquidity = turnover >= 150_000_000 and volume >= 100_000
    watchable_liquidity = turnover >= 50_000_000 and volume >= 80_000 and volume_ratio >= 1.2
    liquidity_ok = deep_liquidity or tradable_liquidity or watchable_liquidity
    thin_liquidity = turnover < 50_000_000 or volume < 50_000
    volume_confirmed = volume_ratio >= 1.2
    dry_rise = change_pct > 2.0 and volume_ratio < 0.8
    illiquid_spike = change_pct > 3.0 and not liquidity_ok

    surge_score = 0.0
    surge_score += min(max(change_pct, -5), 18) * 2.2
    surge_score += min(max(momentum5, -5), 22) * 1.1
    surge_score += min(max(momentum20, -10), 35) * 0.55
    surge_score += min(volume_ratio, 8) * (5.8 if liquidity_ok else 3.2)
    surge_score += min(math.log10(max(turnover, 1)) * 4.5, 42)
    surge_score += 10 if high_20_breakout else 0
    surge_score += 12 if ytd_high_breakout else 0
    surge_score += 8 if golden_cross else 0
    surge_score += 7 if trend_ok else -6
    surge_score += 12 if deep_liquidity else 8 if liquidity_ok else -28 if thin_liquidity else -18
    surge_score -= 12 if dry_rise else 0
    surge_score -= 10 if illiquid_spike else 0

    overheat_risk = 0.0
    overheat_risk += max(0, rsi - 72) * 1.9
    overheat_risk += max(0, divergence25 - 16) * 1.6
    overheat_risk += max(0, divergence75 - 34) * 1.1
    overheat_risk += max(0, change_pct - 15) * 1.2
    overheat_risk += 10 if volume_ratio < 0.9 and change_pct > 5 else 0
    overheat_risk += 22 if illiquid_spike else 0
    overheat_risk += 14 if dry_rise else 0
    overheat_risk += 10 if thin_liquidity and high_20_breakout else 0
    overheat_risk = round(max(0, min(100, overheat_risk)), 1)
    adjusted_score = round(max(0, min(100, surge_score - overheat_risk * 0.45)), 1)

    if overheat_risk >= 58:
        stage = "\u904e\u71b1\u6ce8\u610f"
    elif adjusted_score >= 76 and ytd_high_breakout and liquidity_ok:
        stage = "\u672c\u547d\u6025\u9a30"
    elif adjusted_score >= 62 and volume_ratio >= 1.4 and momentum5 > 0:
        stage = "\u9ad8\u9a30\u521d\u52d5"
    elif trend_ok and liquidity_ok:
        stage = "\u4e0a\u6607\u76e3\u8996"
    else:
        stage = "\u89b3\u5bdf"

    flags = []
    if high_20_breakout:
        flags.append("20\u65e5\u9ad8\u5024\u66f4\u65b0")
    if ytd_high_breakout:
        flags.append("\u5e74\u521d\u6765\u9ad8\u5024\u66f4\u65b0")
    if golden_cross:
        flags.append("ゴールデンクロス")
    if volume_ratio >= 2:
        flags.append("出来高増加")
    if turnover >= 1_000_000_000:
        flags.append("売買代金が大きい")
    if overheat_risk >= 58:
        flags.append("\u904e\u71b1\u6ce8\u610f")
    if not volume_confirmed and change_pct > 2:
        flags.append("出来高の裏付けが弱い")
    if thin_liquidity:
        flags.append("\u8584\u5546\u3044")

    return {
        "surgeScore": adjusted_score,
        "surgeStage": stage,
        "surgeFlags": flags,
        "overheatRisk": overheat_risk,
        "divergence25Pct": round(divergence25, 2),
        "divergence75Pct": round(divergence75, 2),
        "high20Breakout": high_20_breakout,
        "ytdHighBreakout": ytd_high_breakout,
        "goldenCross": golden_cross,
        "trendOk": trend_ok,
        "liquidityOk": liquidity_ok,
        "liquidityGrade": "deep"
        if deep_liquidity
        else "tradable"
        if tradable_liquidity
        else "watchable"
        if watchable_liquidity
        else "thin",
        "volumeConfirmed": volume_confirmed,
        "screeningSchemaVersion": MARKET_SCREENING_SCHEMA_VERSION,
    }


def _market_quality_overlay(item: dict[str, Any]) -> dict[str, Any]:
    turnover = _finite(item.get("turnoverJpy")) or _finite(item.get("price")) * _finite(item.get("volume"))
    volume = _finite(item.get("volume"))
    volume_ratio = _finite(item.get("volumeRatio"))
    change_pct = _finite(item.get("changePct"))
    deep_liquidity = turnover >= 1_000_000_000 and volume >= 250_000
    tradable_liquidity = turnover >= 150_000_000 and volume >= 100_000
    watchable_liquidity = turnover >= 50_000_000 and volume >= 80_000 and volume_ratio >= 1.2
    liquidity_ok = deep_liquidity or tradable_liquidity or watchable_liquidity
    thin_liquidity = not liquidity_ok
    volume_confirmed = volume_ratio >= 1.2
    liquidity_grade = (
        "deep"
        if deep_liquidity
        else "tradable"
        if tradable_liquidity
        else "watchable"
        if watchable_liquidity
        else "thin"
    )
    flags = list(item.get("surgeFlags") or [])
    if not volume_confirmed and change_pct > 2 and "出来高の裏付けが弱い" not in flags:
        flags.append("出来高の裏付けが弱い")
    if thin_liquidity and "\u8584\u5546\u3044" not in flags:
        flags.append("\u8584\u5546\u3044")

    overheat_risk = _finite(item.get("overheatRisk"))
    surge_score = _finite(item.get("surgeScore"))
    if item.get("screeningSchemaVersion") != MARKET_SCREENING_SCHEMA_VERSION:
        if change_pct > 3 and not liquidity_ok:
            overheat_risk += 22
            surge_score -= 10
        if change_pct > 2 and volume_ratio < 0.8:
            overheat_risk += 14
            surge_score -= 12
        if thin_liquidity and item.get("high20Breakout"):
            overheat_risk += 10
        if thin_liquidity:
            surge_score -= 18

    return {
        **item,
        "surgeScore": round(max(0, min(100, surge_score)), 1),
        "overheatRisk": round(max(0, min(100, overheat_risk)), 1),
        "surgeFlags": flags,
        "liquidityOk": bool(item.get("liquidityOk")) if item.get("liquidityOk") is not None else liquidity_ok,
        "liquidityGrade": item.get("liquidityGrade") or liquidity_grade,
        "volumeConfirmed": item.get("volumeConfirmed") if item.get("volumeConfirmed") is not None else volume_confirmed,
        "screeningSchemaVersion": MARKET_SCREENING_SCHEMA_VERSION,
    }


def _market_item_from_history(
    ticker: str,
    info: dict[str, Any],
    hist: pd.DataFrame | None,
    *,
    data_quality: dict[str, Any] | None = None,
    quality: dict[str, Any] | None = None,
    preopen_report: Any = _MISSING,
) -> dict[str, Any] | None:
    hist = clean_price_history(hist)
    if hist is None or hist.empty or len(hist) < 2:
        return None
    closes = [_finite(value) for value in hist["Close"].tolist()]
    highs = [_finite(value) for value in hist["High"].tolist()] if "High" in hist else closes
    lows = [_finite(value) for value in hist["Low"].tolist()] if "Low" in hist else closes
    volumes = [_finite(value) for value in hist["Volume"].tolist()] if "Volume" in hist else [0] * len(closes)
    price = closes[-1]
    previous = closes[-2]
    if price <= 0 or previous <= 0:
        return None

    change_pct = ((price / previous) - 1) * 100
    avg_vol20 = float(np.mean(volumes[-21:-1])) if len(volumes) >= 21 else float(np.mean(volumes[:-1])) if len(volumes) > 1 else 0
    volume = volumes[-1] if volumes else 0
    volume_ratio = volume / avg_vol20 if avg_vol20 else 0
    momentum5 = ((price / closes[-6]) - 1) * 100 if len(closes) >= 6 and closes[-6] else change_pct
    momentum20 = ((price / closes[-21]) - 1) * 100 if len(closes) >= 21 and closes[-21] else momentum5
    rsi = _calc_rsi_window(closes)
    rr = calculate_risk_reward(price, highs, lows, closes)
    if data_quality is None:
        data_quality = _candidate_data_quality(hist, closes, volumes)
    if quality is None:
        quality = build_candidate_quality(closes, highs, lows, volumes, rr=rr, data_quality=data_quality)
    if preopen_report is _MISSING:
        preopen_report = preopen_for_ticker(ticker, info, hist)
    preopen_score = preopen_report["score"] if preopen_report else 0
    candidate_score = round(float(np.mean([quality["qualityScore"], preopen_score or quality["qualityScore"]])), 1)
    if not _candidate_data_quality_ok(data_quality):
        candidate_score = min(candidate_score, quality["qualityScore"])
    turnover = price * volume
    popularity_score = round(
        min(100, max(0, math.log10(max(turnover, 1)) * 8 + min(volume_ratio, 6) * 7 + max(change_pct, 0) * 2)),
        1,
    )
    surge_profile = _surge_profile(
        price=price,
        closes=closes,
        volume=volume,
        avg_vol20=avg_vol20,
        turnover=turnover,
        change_pct=change_pct,
        momentum5=momentum5,
        momentum20=momentum20,
        rsi=rsi,
    )
    reasons = []
    if change_pct > 0:
        reasons.append(f"前日比 {change_pct:+.2f}%")
    if volume_ratio:
        reasons.append(f"出来高倍率 {volume_ratio:.1f}倍")
    reasons.extend(surge_profile["surgeFlags"][:2])
    if preopen_report:
        reasons.extend(preopen_report.get("keyReasons", [])[:1])
    source_flags = _data_source_flags(hist.attrs.get("source", "yfinance"), data_quality)

    return {
        "ticker": ticker,
        "name": info.get("name", ticker),
        "marketSection": info.get("market_section", ""),
        "sector": info.get("sector", ""),
        "price": round(price, 1),
        "changeJpy": round(price - previous, 1),
        "changePct": round(change_pct, 2),
        "volume": int(max(volume, 0)),
        "turnoverJpy": round(turnover, 1),
        "volumeRatio": round(volume_ratio, 2),
        "momentum5Pct": round(momentum5, 2),
        "momentum20Pct": round(momentum20, 2),
        "candidateScore": candidate_score,
        "candidateQuality": quality,
        "dataQuality": data_quality,
        "preopenScore": preopen_score or None,
        "popularityScore": popularity_score,
        **surge_profile,
        "rrRatio": rr.get("rr_ratio"),
        "targetPrice": rr.get("target_price"),
        "stopLoss": rr.get("stop_loss"),
        "rewardPct": rr.get("reward_pct"),
        "riskPct": rr.get("risk_pct"),
        "latestBarDate": _latest_bar_label(hist.index[-1]),
        "latestBarAgeDays": data_quality.get("latestBarAgeDays"),
        "priceAsOfDate": data_quality.get("latestBarDate"),
        "priceSource": hist.attrs.get("source", "yfinance"),
        "source": hist.attrs.get("source", "yfinance"),
        **source_flags,
        "externalLinks": external_research_links(ticker, info.get("name", ticker)),
        "reason": " / ".join(reasons[:3]) or "現在の市場データから抽出した監視候補です。",
    }


def _build_intraday_opportunity(item: dict[str, Any], budget_jpy: int = DEFAULT_INTRADAY_BUDGET_JPY) -> dict[str, Any] | None:
    price = _finite(item.get("price"))
    if price <= 0:
        return None
    budget_jpy = max(int(budget_jpy or DEFAULT_INTRADAY_BUDGET_JPY), 0)
    shares = int(budget_jpy // price // INTRADAY_SHARE_UNIT * INTRADAY_SHARE_UNIT)
    if shares <= 0:
        return None

    target_price = _finite(item.get("targetPrice"))
    if target_price <= price:
        target_pct = max(
            0.8,
            min(
                8.0,
                _finite(item.get("rewardPct"))
                or max(_finite(item.get("changePct")) * 0.45, 0)
                + min(_finite(item.get("volumeRatio")), 4) * 0.25
                + min(max(_finite(item.get("momentum5Pct")), 0), 12) * 0.18
                + 1.0,
            ),
        )
        target_price = price * (1 + target_pct / 100)
    stop_loss = _finite(item.get("stopLoss"))
    if stop_loss <= 0 or stop_loss >= price:
        stop_pct = max(0.7, min(4.0, _finite(item.get("riskPct")) or 1.8))
        stop_loss = price * (1 - stop_pct / 100)

    target_profit = max(0.0, (target_price - price) * shares)
    max_loss = max(0.0, (price - stop_loss) * shares)
    latest_bar = item.get("latestBarDate")
    latest_bar_age_days = _latest_bar_age_days(latest_bar)
    confidence = 35.0
    confidence += min(max(_finite(item.get("surgeScore")), 0), 100) * 0.26
    confidence += min(max(_finite(item.get("candidateScore")), 0), 100) * 0.18
    confidence += min(max(_finite(item.get("volumeRatio")), 0), 5) * 3.2
    confidence += min(max(_finite(item.get("momentum5Pct")), -8), 16) * 0.7
    confidence += min(max(_finite(item.get("changePct")), -6), 10) * 0.65
    confidence -= min(max(_finite(item.get("overheatRisk")), 0), 100) * 0.28
    confidence += 5 if item.get("liquidityOk") else -10
    confidence_cap = 95.0
    backtest = (item.get("candidateQuality") or {}).get("backtest") or {}
    backtest_samples = int(_finite(backtest.get("sampleCount")))
    backtest_risk_adjusted = _finite(backtest.get("riskAdjustedReturnPct"))
    backtest_profit_factor = _finite(backtest.get("profitFactor"))
    quality_reliability = (item.get("candidateQuality") or {}).get("qualityReliability") or backtest.get("evidenceStrength")
    if not quality_reliability:
        quality_reliability = _backtest_evidence_strength(
            backtest_samples,
            str(backtest.get("matchQuality") or "insufficient"),
        )
    quality_reliability_grade = quality_reliability.get("grade") or "insufficient"
    if backtest_samples >= 3:
        confidence += max(-8, min(8, backtest_risk_adjusted * 3.0))
        if backtest_profit_factor >= 1.2:
            confidence += min(4, (backtest_profit_factor - 1.0) * 3.0)
        elif backtest_profit_factor and backtest_profit_factor < 0.9:
            confidence -= 4
    if quality_reliability_grade == "weak":
        confidence -= 3
        confidence_cap = min(confidence_cap, 90.0)
    elif quality_reliability_grade == "insufficient":
        confidence -= 6
        confidence_cap = min(confidence_cap, 82.0)
    material = item.get("material") or {}
    material_tone = material.get("tone", "unconfirmed")
    material_score = _finite(material.get("materialScore"))
    material_age = material.get("latestAgeDays")
    material_stale = material.get("freshnessVerdict") == "stale" or (
        isinstance(material_age, (int, float)) and material_age > 14
    )
    has_recent_important = bool(material.get("hasRecentImportant"))
    has_official_material = _finite(material.get("recentOfficialDisclosureCount")) > 0
    if material_tone == "positive":
        confidence += 4 + min(6, material_score * 6)
    elif material_tone == "important":
        confidence += 1 + min(4, material_score * 4)
    elif material_tone == "negative":
        confidence -= 18
        confidence_cap = 72.0
    elif material_tone == "neutral":
        confidence -= 2
    elif material_tone == "unconfirmed":
        confidence -= 7
        confidence_cap = 86.0
    if material_stale:
        confidence -= 4
        confidence_cap = min(confidence_cap, 80.0)
    if has_official_material and has_recent_important and material_tone in {"positive", "important"}:
        confidence += 2
    if latest_bar_age_days is not None:
        if latest_bar_age_days <= 2:
            confidence += 2
        elif latest_bar_age_days > 5:
            confidence -= min(25, (latest_bar_age_days - 5) * 4)
    if backtest_samples >= 3 and backtest_risk_adjusted <= 0:
        confidence_cap = min(confidence_cap, 90.0)
    if backtest_samples >= 3 and backtest_profit_factor and backtest_profit_factor < 0.8:
        confidence_cap = min(confidence_cap, 88.0)
    market_relative = item.get("marketRelative") or {}
    market_integrity = market_relative.get("contextIntegrity") or {}
    market_context_required = bool(market_integrity.get("required"))
    market_context_blocked = market_context_required and not bool(market_integrity.get("usable"))
    if market_relative.get("available"):
        if market_relative.get("riskOff"):
            confidence -= 6
            confidence_cap = min(confidence_cap, 88.0)
        elif market_relative.get("sectorTailwind"):
            confidence += 3
        if market_relative.get("sectorHeadwind"):
            confidence -= 4
            confidence_cap = min(confidence_cap, 90.0)
        confidence += max(-4, min(4, _finite(market_relative.get("relativeToMarketPct")) * 0.5))
    elif market_context_blocked:
        confidence -= 3
        confidence_cap = min(confidence_cap, 90.0)
    confidence = round(max(1.0, min(confidence_cap, confidence)), 1)

    expected_profit = target_profit * (confidence / 100)
    downside_risk_penalty = max_loss * ((100 - confidence) / 100) * 0.75
    audit_multiplier = 1.0
    volume_ratio = _finite(item.get("volumeRatio"))
    turnover = _finite(item.get("turnoverJpy"))
    budget_used = price * shares
    liquidity_grade = str(item.get("liquidityGrade") or ("tradable" if item.get("liquidityOk") else "thin")).lower()
    liquidity_bps = {"deep": 3.0, "tradable": 8.0, "watchable": 15.0, "thin": 35.0}.get(liquidity_grade, 18.0)
    participation_pct = (budget_used / turnover * 100) if turnover > 0 else 0.0
    participation_bps = max(0.0, participation_pct - 1.0) * 12.0 if turnover > 0 else 12.0
    low_price_bps = 20.0 if price < 80 else 10.0 if price < 150 else 0.0
    weak_volume_bps = 10.0 if volume_ratio and volume_ratio < 0.8 else 0.0
    execution_risk_bps = min(150.0, liquidity_bps + participation_bps + low_price_bps + weak_volume_bps)
    execution_risk_penalty = budget_used * execution_risk_bps / 10_000
    if material_tone == "negative":
        material_reliability_grade = "negative"
        material_reliability_penalty = expected_profit * 0.35
    elif material_tone == "unconfirmed":
        material_reliability_grade = "unconfirmed"
        material_reliability_penalty = expected_profit * 0.22
    elif material_stale:
        material_reliability_grade = "stale"
        material_reliability_penalty = expected_profit * 0.18
    elif material_tone in {"positive", "important"} and not has_official_material:
        material_reliability_grade = "news_only"
        material_reliability_penalty = expected_profit * 0.1
    elif material_tone in {"positive", "important"} and has_official_material:
        material_reliability_grade = "official_confirmed"
        material_reliability_penalty = 0.0
    else:
        material_reliability_grade = material_tone or "unknown"
        material_reliability_penalty = expected_profit * 0.05
    risk_penalty = downside_risk_penalty + execution_risk_penalty + material_reliability_penalty
    pre_audit_opportunity_score = round(max(0.0, expected_profit - risk_penalty), 1)
    opportunity_score = pre_audit_opportunity_score
    overheat = _finite(item.get("overheatRisk"))
    why_buy = [
        f"\u6761\u4ef6\u4e00\u81f4\u30b9\u30b3\u30a2 {confidence:.1f}/100",
        f"目標利益 {round(target_profit):,}円 / 期待損益 {round(expected_profit):,}円",
        f"\u30ea\u30b9\u30af\u30fb\u30ea\u30ef\u30fc\u30c9 {target_profit / max_loss:.2f}" if max_loss > 0 else "\u30ea\u30b9\u30af\u30fb\u30ea\u30ef\u30fc\u30c9\u306f\u8a08\u7b97\u4e0d\u80fd",
    ]
    if volume_ratio:
        why_buy.append(f"\u51fa\u6765\u9ad8\u500d\u7387 {volume_ratio:.1f}x")
    if turnover:
        why_buy.append(f"売買代金 {round(turnover):,}円")
    material_grade_labels = {
        "official_fresh": "新しい公式開示あり",
        "positive": "好材料あり",
        "news_only": "ニュースのみ",
        "neutral": "中立",
        "negative": "悪材料あり",
        "unconfirmed": "未確認",
        "stale": "情報が古い",
    }
    quality_grade_labels = {"strong": "十分", "moderate": "標準", "weak": "弱い", "insufficient": "不足"}
    liquidity_grade_labels = {"deep": "十分", "tradable": "取引可能", "watchable": "要確認", "thin": "薄い"}
    source_note = "公式開示" if has_official_material else "ニュース・出所確認"
    why_buy.append(f"材料の確認状況: {material_grade_labels.get(material_reliability_grade, material_reliability_grade)}（{source_note}）")
    if backtest_samples >= 3:
        why_buy.append(f"類似翌日検証 {backtest_samples}件、リスク調整後 {backtest_risk_adjusted:+.2f}%、PF {backtest_profit_factor:.2f}")

    why_not_buy = []
    if max_loss <= 0:
        why_not_buy.append("損切り価格または最大損失を計算できません")
    if material_reliability_grade in {"negative", "unconfirmed", "stale"}:
        why_not_buy.append(f"\u60aa\u6750\u6599\u307e\u305f\u306f\u6750\u6599\u4fe1\u983c\u5ea6\u306e\u518d\u78ba\u8a8d\u304c\u5fc5\u8981\u3067\u3059: {material_reliability_grade}")
    if material_stale:
        why_not_buy.append("\u6750\u6599\u304c\u53e4\u304f\u3001\u516c\u5f0f\u958b\u793a\u306e\u518d\u78ba\u8a8d\u304c\u5fc5\u8981\u3067\u3059")
    if material_reliability_penalty > 0:
        why_not_buy.append(f"材料信頼度の控除 {round(material_reliability_penalty):,}円")
    if execution_risk_bps >= 25:
        why_not_buy.append(f"\u7d04\u5b9a\u30b3\u30b9\u30c8\u898b\u7a4d\u308a {execution_risk_bps:.1f} bps")
    if not item.get("liquidityOk"):
        why_not_buy.append("流動性が不足しており、安定した練習判定ができません")
    if latest_bar_age_days is None or latest_bar_age_days > 5:
        why_not_buy.append("\u6700\u65b0\u4fa1\u683c\u65e5\u4ed8\u304c\u78ba\u8a8d\u3067\u304d\u306a\u3044" if latest_bar_age_days is None else f"\u65e5\u8db3\u4fa1\u683c\u30c7\u30fc\u30bf\u304c\u53e4\u3044: {latest_bar_age_days} days")
    if market_context_blocked:
        why_not_buy.append(f"\u30d5\u30eb\u5e02\u5834\u5730\u5408\u3044\u304c\u691c\u8a3c\u3067\u304d\u305a\u8981\u78ba\u8a8d: {market_integrity.get('reason', 'unknown')}")
    if market_relative.get("riskOff"):
        why_not_buy.append("\u5e02\u5834\u5730\u5408\u3044\u304c\u5f31\u3044\u305f\u3081\u898b\u9001\u308a\u512a\u5148")
    if overheat >= 70:
        why_not_buy.append("過熱リスクが高い状態です")
    if quality_reliability_grade in {"weak", "insufficient"}:
        why_not_buy.append(f"\u691c\u8a3c\u5f37\u5ea6\u304c{quality_reliability_grade}\u3067\u3059")
    if backtest_samples >= 3 and backtest_risk_adjusted <= 0:
        why_not_buy.append("\u985e\u4f3c\u30d1\u30bf\u30fc\u30f3\u306e\u7fcc\u65e5\u671f\u5f85\u5024\u304c\u5f31\u3044")
    if not why_not_buy:
        why_not_buy.append("大きな阻害要因は見当たりませんが、学習用の参考判定です")

    invalid_conditions = [
        f"撤退ライン {round(stop_loss, 1):,}円を下回る",
        f"十分な流動性を保ったまま利確目標 {round(target_price, 1):,}円へ届かない",
        "材料・ニュースが悪化する、または出所を確認できない",
        "エントリー前にスプレッド、板厚、または市場環境が悪化する",
    ]

    expert_checklist = [
        {"label": "価格の鮮度", "ok": latest_bar_age_days is not None and latest_bar_age_days <= 5, "detail": latest_bar or "不明"},
        {"label": "材料の信頼性", "ok": material_reliability_grade not in {"negative", "unconfirmed", "stale"}, "detail": material_grade_labels.get(material_reliability_grade, material_reliability_grade)},
        {"label": "流動性", "ok": bool(item.get("liquidityOk")), "detail": liquidity_grade_labels.get(liquidity_grade, liquidity_grade)},
        {"label": "損益比", "ok": max_loss > 0 and target_profit / max_loss >= 1.5, "detail": f"RR {target_profit / max_loss:.2f}" if max_loss > 0 else "計算不能"},
        {"label": "根拠の強さ", "ok": quality_reliability_grade not in {"weak", "insufficient"}, "detail": quality_grade_labels.get(quality_reliability_grade, quality_reliability_grade)},
        {"label": "市場環境", "ok": not market_relative.get("riskOff") and not market_context_blocked, "detail": market_integrity.get("label") or market_relative.get("tone") or "中立"},
    ]

    expert_warnings: list[str] = []
    if material_reliability_grade in {"negative", "unconfirmed", "stale"}:
        expert_warnings.append(f"材料の信頼性を再確認してください: {material_grade_labels.get(material_reliability_grade, material_reliability_grade)}")
    if not item.get("liquidityOk"):
        expert_warnings.append("流動性リスクあり: 板を確認せずに手入力しないでください")
    if market_relative.get("riskOff"):
        expert_warnings.append("市場全体がリスク回避傾向です")
    elif market_relative.get("sectorHeadwind"):
        expert_warnings.append("業種全体に逆風があります")
    if market_context_blocked:
        expert_warnings.append(f"市場全体の状況を再確認してください: {market_integrity.get('reason', '理由不明')}")
    if execution_risk_bps >= 35:
        expert_warnings.append(f"約定コストのリスク {execution_risk_bps:.1f} bps")
    if latest_bar_age_days is None or latest_bar_age_days > 5:
        expert_warnings.append("価格データが古いか取得できません")
    if backtest_samples >= 3 and backtest_risk_adjusted <= 0:
        expert_warnings.append("\u985e\u4f3c\u30d1\u30bf\u30fc\u30f3\u306e\u7fcc\u65e5\u671f\u5f85\u5024\u304c\u5f31\u3044\u3067\u3059\u3002")
    if quality_reliability_grade in {"weak", "insufficient"}:
        expert_warnings.append(f"根拠の強さが{quality_grade_labels.get(quality_reliability_grade, quality_reliability_grade)}状態です")

    decision_audit = _candidate_decision_audit(
        item=item,
        confidence=confidence,
        target_profit=target_profit,
        max_loss=max_loss,
        latest_bar_age_days=latest_bar_age_days,
        material=material,
        market_relative=market_relative,
        backtest={**backtest, "evidenceStrength": quality_reliability},
    )
    if decision_audit["verdict"] == "REJECT":
        audit_multiplier = 0.35
    elif decision_audit["verdict"] == "REVIEW":
        audit_multiplier = 0.65
    else:
        audit_multiplier = 1.0
    if decision_audit["verdict"] != "PASS":
        why_not_buy.append(f"\u76e3\u67fb\u5224\u5b9a: {decision_audit['label']}")
    opportunity_score = round(pre_audit_opportunity_score * audit_multiplier, 1)

    critical_risk = (
        material_tone == "negative"
        or decision_audit.get("failedHighCount", 0) > 0
        or not item.get("liquidityOk")
        or (latest_bar_age_days is not None and latest_bar_age_days > 5)
        or overheat >= 70
    )
    high_risk = (
        decision_audit["verdict"] in {"REJECT", "REVIEW"}
        or liquidity_grade in {"thin", "watchable"}
        or material_tone == "unconfirmed"
        or material_stale
        or market_relative.get("riskOff")
        or market_context_blocked
        or execution_risk_bps >= 35
        or quality_reliability_grade == "insufficient"
    )
    medium_risk = (
        market_relative.get("sectorHeadwind")
        or material_reliability_grade == "news_only"
        or overheat >= 45
        or (backtest_samples >= 3 and backtest_risk_adjusted <= 0)
        or quality_reliability_grade == "weak"
    )
    if critical_risk:
        expert_risk_level = "critical"
    elif high_risk:
        expert_risk_level = "high"
    elif medium_risk:
        expert_risk_level = "medium"
    else:
        expert_risk_level = "low"

    if expert_risk_level == "critical" or decision_audit["verdict"] == "REJECT":
        trade_readiness = "avoid"
    elif expert_risk_level in {"high", "medium"} or decision_audit["verdict"] == "REVIEW":
        trade_readiness = "review"
    else:
        trade_readiness = "ready"

    if trade_readiness == "avoid":
        position_sizing_verdict = "skip"
    elif expert_risk_level in {"high", "medium"} or liquidity_grade not in {"deep", "tradable"}:
        position_sizing_verdict = "reduced"
    else:
        position_sizing_verdict = "normal"

    if position_sizing_verdict == "skip":
        position_size_fraction = 0.0
    elif position_sizing_verdict == "reduced":
        position_size_fraction = 0.25 if expert_risk_level == "high" else 0.5
    else:
        position_size_fraction = 1.0
    recommended_shares = int(shares * position_size_fraction // INTRADAY_SHARE_UNIT * INTRADAY_SHARE_UNIT)
    if position_sizing_verdict != "skip" and recommended_shares <= 0:
        position_sizing_verdict = "skip"
        position_size_fraction = 0.0
        trade_readiness = "avoid"
        expert_risk_level = "critical"
        recommended_shares = 0
        why_not_buy.append("建玉サイズ補正: 推奨株数が0株のため候補から除外します")
        expert_warnings.append("Position sizing produced zero shares; exclude from best candidate selection")
    recommended_budget_used = price * recommended_shares
    recommended_target_profit = max(0.0, (target_price - price) * recommended_shares)
    recommended_max_loss = max(0.0, (price - stop_loss) * recommended_shares)
    recommended_expected_profit = recommended_target_profit * (confidence / 100)
    opportunity_score = round(pre_audit_opportunity_score * audit_multiplier * position_size_fraction, 1)
    if position_sizing_verdict != "normal":
        why_not_buy.append(
            f"建玉サイズ補正: {position_sizing_verdict} / 推奨 {recommended_shares}株 / 最大予算 {shares}株"
        )

    if trade_readiness == "ready" and confidence >= 78 and material_reliability_grade == "official_confirmed":
        setup_quality_grade = "A"
    elif trade_readiness in {"ready", "review"} and confidence >= 68 and expert_risk_level in {"low", "medium"}:
        setup_quality_grade = "B"
    elif trade_readiness != "avoid" and confidence >= 55:
        setup_quality_grade = "C"
    else:
        setup_quality_grade = "D"

    source_flags = _data_source_flags(
        item.get("priceSource") or item.get("source"),
        item.get("dataQuality"),
        cached=bool(item.get("isCached") or item.get("is_cached") or item.get("cache")),
    )
    if source_flags.get("isSynthetic"):
        trade_readiness = "review"
        setup_quality_grade = "D"
        opportunity_score = min(opportunity_score, 0.0)
        if "補完データのため、売買候補ではなく参考表示として扱います" not in why_not_buy:
            why_not_buy.append("補完データのため、売買候補ではなく参考表示として扱います")

    score_breakdown = {
        "targetProfitJpy": round(target_profit, 1),
        "confidencePct": confidence,
        "grossExpectedProfitJpy": round(expected_profit, 1),
        "maxLossJpy": round(max_loss, 1),
        "downsideRiskPenaltyJpy": round(downside_risk_penalty, 1),
        "executionRiskPenaltyJpy": round(execution_risk_penalty, 1),
        "materialReliabilityPenaltyJpy": round(material_reliability_penalty, 1),
        "materialReliabilityGrade": material_reliability_grade,
        "materialOfficialConfirmed": bool(has_official_material),
        "qualityReliability": quality_reliability,
        "marketContextUsable": not market_context_blocked,
        "marketContextReason": market_integrity.get("reason"),
        "riskPenaltyJpy": round(risk_penalty, 1),
        "executionRiskBps": round(execution_risk_bps, 2),
        "participationPct": round(participation_pct, 4),
        "liquidityGrade": liquidity_grade,
        "preAuditOpportunityScore": pre_audit_opportunity_score,
        "auditMultiplier": audit_multiplier,
        "finalOpportunityScore": opportunity_score,
        "setupQualityGrade": setup_quality_grade,
        "expertRiskLevel": expert_risk_level,
        "tradeReadiness": trade_readiness,
        "positionSizingVerdict": position_sizing_verdict,
        "positionSizeFraction": position_size_fraction,
        "recommendedShares": recommended_shares,
        "maxBudgetShares": shares,
        "recommendedBudgetUsedJpy": round(recommended_budget_used, 1),
        "maxBudgetUsedJpy": round(budget_used, 1),
        "maxBudgetTargetProfitJpy": round(target_profit, 1),
        "maxBudgetMaxLossJpy": round(max_loss, 1),
        "maxBudgetExpectedProfitJpy": round(expected_profit, 1),
        "formula": "maxBudgetScore=max(0, targetProfitJpy * confidencePct - maxLossJpy * (1 - confidencePct) * 0.75); final=maxBudgetScore * auditMultiplier * positionSizeFraction",
    }
    return {
        "ticker": item.get("ticker"),
        "name": item.get("name"),
        "siteRank": item.get("siteRank") or item.get("rank"),
        "candidateRank": item.get("candidateRank"),
        "rank": item.get("rank"),
        "budgetJpy": budget_jpy,
        "entryPrice": round(price, 1),
        "targetPrice": round(target_price, 1),
        "stopLoss": round(stop_loss, 1),
        "shares": recommended_shares,
        "maxBudgetShares": shares,
        "recommendedShares": recommended_shares,
        "budgetUsedJpy": round(recommended_budget_used, 1),
        "maxBudgetUsedJpy": round(budget_used, 1),
        "recommendedBudgetUsedJpy": round(recommended_budget_used, 1),
        "targetProfitJpy": round(recommended_target_profit, 1),
        "maxBudgetTargetProfitJpy": round(target_profit, 1),
        "maxLossJpy": round(recommended_max_loss, 1),
        "maxBudgetMaxLossJpy": round(max_loss, 1),
        "confidencePct": confidence,
        "expectedProfitJpy": round(recommended_expected_profit, 1),
        "maxBudgetExpectedProfitJpy": round(expected_profit, 1),
        "opportunityScore": opportunity_score,
        "riskAdjustedExpectedJpy": opportunity_score,
        "scoreBreakdown": score_breakdown,
        "changePct": item.get("changePct"),
        "surgeScore": item.get("surgeScore"),
        "overheatRisk": item.get("overheatRisk"),
        "reason": item.get("reason", ""),
        "whyBuy": why_buy,
        "whyNotBuy": why_not_buy,
        "invalidConditions": invalid_conditions,
        "setupQualityGrade": setup_quality_grade,
        "expertRiskLevel": expert_risk_level,
        "tradeReadiness": trade_readiness,
        "positionSizingVerdict": position_sizing_verdict,
        "expertWarnings": expert_warnings,
        "expertChecklist": expert_checklist,
        "dataFreshness": {
            "latestBarDate": latest_bar,
            "priceAsOfDate": item.get("priceAsOfDate") or latest_bar,
            "latestBarAgeDays": latest_bar_age_days,
            "priceOk": latest_bar_age_days is not None and latest_bar_age_days <= 5,
            "source": item.get("priceSource") or item.get("source"),
            "priceSource": item.get("priceSource") or item.get("source"),
            **source_flags,
            "rankingSource": item.get("source"),
            "sourceFetchedAt": item.get("sourceFetchedAt"),
            "sourceFetchedDate": item.get("sourceFetchedDate"),
        "provider": "J-Quantsまたはyfinanceの日足データです。リアルタイムの板情報ではありません。",
        },
        "decisionAudit": decision_audit,
        "material": material,
        "marketRelative": market_relative,
        "disclaimer": "シミュレーション専用の分析です。投資助言や注文指示ではありません。手動で判断する前に、リアルタイム価格、流動性、開示情報、リスクを確認してください。",
    }


def _attach_intraday_opportunities(items: list[dict[str, Any]], budget_jpy: int) -> list[dict[str, Any]]:
    return [{**item, "intradayOpportunity": _build_intraday_opportunity(item, budget_jpy)} for item in items]


def _strip_intraday_opportunity(item: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key != "intradayOpportunity"}


def _opportunity_tradeability_weight(opportunity: dict[str, Any]) -> float:
    readiness = str(opportunity.get("tradeReadiness") or "").lower()
    position_sizing = str(opportunity.get("positionSizingVerdict") or "").lower()
    weight = {"ready": 3.0, "review": 2.0, "avoid": 0.0}.get(readiness, 1.0)
    if position_sizing == "skip":
        return 0.0
    if position_sizing == "reduced":
        return min(weight, 2.0)
    return weight


def _opportunity_cross_engine_weight(item: dict[str, Any], opportunity: dict[str, Any]) -> float:
    cross_check = (
        opportunity.get("advancedCrossEngineCheck")
        or item.get("advancedCrossEngineCheck")
        or item.get("crossEngineCheck")
        or {}
    )
    status = str(cross_check.get("status") or "").lower()
    return {"aligned": 3.0, "review": 2.0, "pending": 1.5, "blocked": 0.0}.get(status, 1.5)


def _opportunity_has_actionable_size(opportunity: dict[str, Any] | None) -> bool:
    if not opportunity:
        return False
    risk_adjusted = opportunity.get("opportunityScore")
    if risk_adjusted is None:
        risk_adjusted = opportunity.get("riskAdjustedExpectedJpy")
    if risk_adjusted is None:
        risk_adjusted = opportunity.get("expectedProfitJpy")
    return bool(
        _finite(opportunity.get("shares") or opportunity.get("recommendedShares")) > 0
        and _finite(opportunity.get("budgetUsedJpy") or opportunity.get("recommendedBudgetUsedJpy")) > 0
        and _finite(opportunity.get("expectedProfitJpy")) > 0
        and _finite(risk_adjusted) > 0
    )


def _rank_by_audited_opportunity(items: list[dict[str, Any]], *, preserve_rank: bool = False) -> list[dict[str, Any]]:
    def key(item: dict[str, Any]) -> tuple[float, float, float, float, float, float]:
        opportunity = item.get("intradayOpportunity") or {}
        audit = opportunity.get("decisionAudit") or {}
        verdict_weight = {"PASS": 3.0, "REVIEW": 2.0, "REJECT": 1.0}.get(audit.get("verdict"), 0.0)
        return (
            verdict_weight,
            _opportunity_tradeability_weight(opportunity),
            _opportunity_cross_engine_weight(item, opportunity),
            _finite(opportunity.get("opportunityScore")),
            _finite(audit.get("auditScore")),
            _finite(item.get("turnoverJpy")),
        )

    ranked = sorted(items, key=key, reverse=True)
    ranked_with_positions: list[dict[str, Any]] = []
    for index, item in enumerate(ranked):
        site_rank = item.get("rank") if preserve_rank else item.get("siteRank")
        candidate_rank = index + 1
        opportunity = item.get("intradayOpportunity") or {}
        ranked_with_positions.append(
            {
                **item,
                "siteRank": site_rank,
                "candidateRank": candidate_rank,
                "intradayOpportunity": {
                    **opportunity,
                    "siteRank": site_rank,
                    "candidateRank": candidate_rank,
                    "rank": item.get("rank"),
                },
            }
        )
    return ranked_with_positions


def _select_best_ranked_opportunity(
    items: list[dict[str, Any]],
    *,
    require_cross_engine_check: bool = False,
) -> dict[str, Any] | None:
    for item in items:
        opportunity = item.get("intradayOpportunity")
        if not opportunity:
            continue
        if str(opportunity.get("tradeReadiness") or "").lower() != "ready":
            continue
        audit_verdict = str((opportunity.get("decisionAudit") or {}).get("verdict") or "").upper()
        if audit_verdict != "PASS":
            continue
        if _opportunity_tradeability_weight(opportunity) <= 0:
            continue
        if not _opportunity_has_actionable_size(opportunity):
            continue
        cross_check = (
            opportunity.get("advancedCrossEngineCheck")
            or item.get("advancedCrossEngineCheck")
            or item.get("crossEngineCheck")
            or {}
        )
        cross_status = str(cross_check.get("status") or "").lower()
        if require_cross_engine_check and cross_status != "aligned":
            continue
        if _opportunity_cross_engine_weight(item, opportunity) <= 0:
            continue
        return opportunity
    return None


def _best_available_decision(opportunity: dict[str, Any], item: dict[str, Any]) -> tuple[str, str, str]:
    tradeability = _opportunity_tradeability_weight(opportunity)
    cross_weight = _opportunity_cross_engine_weight(item, opportunity)
    actionable_size = _opportunity_has_actionable_size(opportunity)
    audit = opportunity.get("decisionAudit") or {}
    verdict = str(audit.get("verdict") or "").upper()
    warnings = opportunity.get("expertWarnings") or opportunity.get("whyNotBuy") or []
    primary_warning = str(warnings[0]) if warnings else "リアルタイム価格、出来高、材料を確認してから判断してください。"

    if tradeability > 0 and cross_weight > 0 and actionable_size and verdict != "REJECT":
        return "TRADE_CANDIDATE", "買い候補", "条件に近い候補です。価格上限と撤退ラインを守る前提で確認してください。"
    if tradeability > 0 and cross_weight > 0:
        return "WAIT_FOR_PRICE", "待つ", primary_warning
    return "WATCH_ONLY", "見送り寄り", primary_warning


def _annotate_best_available_opportunity(
    opportunity: dict[str, Any],
    item: dict[str, Any],
    *,
    strict_match: bool,
) -> dict[str, Any]:
    display_decision, simple_action, primary_warning = _best_available_decision(opportunity, item)
    return {
        **opportunity,
        "availabilityMode": "STRICT_MATCH" if strict_match else "BEST_AVAILABLE",
        "isFallbackCandidate": not strict_match,
        "displayDecision": display_decision,
        "simpleAction": simple_action,
        "primaryWarning": primary_warning,
    }


def _select_best_available_opportunity(items: list[dict[str, Any]], strict_best: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if strict_best:
        strict_ticker = strict_best.get("ticker")
        strict_item = next(
            (item for item in items if (item.get("intradayOpportunity") or {}).get("ticker") == strict_ticker),
            {},
        )
        return _annotate_best_available_opportunity(strict_best, strict_item, strict_match=True)

    candidates: list[tuple[tuple[float, float, float, float, float, float, float], dict[str, Any], dict[str, Any]]] = []
    for index, item in enumerate(items):
        opportunity = item.get("intradayOpportunity") or {}
        if not opportunity.get("ticker"):
            continue
        audit = opportunity.get("decisionAudit") or {}
        verdict_weight = {"PASS": 3.0, "REVIEW": 2.0, "REJECT": 0.5}.get(str(audit.get("verdict") or "").upper(), 1.0)
        expected_profit = max(
            _finite(opportunity.get("expectedProfitJpy")),
            _finite(opportunity.get("opportunityScore")),
            _finite(opportunity.get("riskAdjustedExpectedJpy")),
        )
        key = (
            1.0 if _finite(opportunity.get("shares") or opportunity.get("recommendedShares")) > 0 else 0.0,
            _opportunity_tradeability_weight(opportunity),
            _opportunity_cross_engine_weight(item, opportunity),
            expected_profit,
            _finite(opportunity.get("confidencePct")),
            verdict_weight,
            -float(index),
        )
        candidates.append((key, item, opportunity))
    if not candidates:
        return None
    _, item, opportunity = max(candidates, key=lambda entry: entry[0])
    return _annotate_best_available_opportunity(opportunity, item, strict_match=False)


def _rank_with_material_refresh(
    items: list[dict[str, Any]],
    budget_jpy: int,
    *,
    preserve_rank: bool = False,
    refresh_limit: int = 12,
) -> list[dict[str, Any]]:
    prelim_ranked = _rank_by_audited_opportunity(_attach_intraday_opportunities(items, budget_jpy), preserve_rank=preserve_rank)
    if refresh_limit <= 0:
        return prelim_ranked

    refresh_targets = [
        (index, _strip_intraday_opportunity(item))
        for index, item in enumerate(prelim_ranked)
        if index < refresh_limit
        and not (item.get("material") or (item.get("intradayOpportunity") or {}).get("material"))
    ]
    refreshed_by_index: dict[int, dict[str, Any]] = {}
    if refresh_targets:
        bases = [base_item for _, base_item in refresh_targets]
        try:
            material_items = _attach_material_events(bases)
        except Exception:
            material_items = bases
        refreshed_by_index = {
            index: material_item
            for (index, _), material_item in zip(refresh_targets, material_items)
            if material_item.get("material")
        }

    refreshed_items: list[dict[str, Any]] = []
    changed = False
    for index, item in enumerate(prelim_ranked):
        material_item = refreshed_by_index.get(index)
        if material_item:
            changed = True
            refreshed_items.append({**material_item, "intradayOpportunity": _build_intraday_opportunity(material_item, budget_jpy)})
            continue
        refreshed_items.append(item)

    if not changed:
        return prelim_ranked
    return _rank_by_audited_opportunity(refreshed_items, preserve_rank=preserve_rank)


def _attach_candidate_quality(items: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    def enrich(entry: tuple[int, dict[str, Any]]) -> dict[str, Any]:
        index, item = entry
        if item.get("candidateQuality") or index >= limit:
            return item
        quality = quality_for_ticker(item.get("ticker", ""))
        if quality:
            data_quality = quality.get("dataQuality") or {}
            price_as_of = data_quality.get("latestBarDate")
            quality_price = _finite(data_quality.get("latestClosePrice"))
            enriched_item = {
                **item,
                "candidateQuality": quality,
                "dataQuality": data_quality or item.get("dataQuality"),
            }
            if price_as_of:
                old_price = _finite(item.get("price"))
                quality_updates = {
                    "latestBarDate": price_as_of,
                    "latestBarAgeDays": data_quality.get("latestBarAgeDays"),
                    "priceAsOfDate": price_as_of,
                    "priceSource": data_quality.get("source") or item.get("priceSource"),
                }
                if quality_price > 0:
                    quality_updates["price"] = quality_price
                enriched_item.update(quality_updates)
                if quality_price > 0 and abs(quality_price - old_price) > 0.01:
                    for stale_level_key in ("targetPrice", "stopLoss", "rewardPct", "riskPct", "rrRatio"):
                        enriched_item.pop(stale_level_key, None)
                if quality_price > 0 and enriched_item.get("intradayOpportunity"):
                    enriched_item["intradayOpportunity"] = _build_intraday_opportunity(enriched_item, DEFAULT_INTRADAY_BUDGET_JPY)
            return enriched_item
        return item

    entries = list(enumerate(items))
    if len(entries) <= 1:
        return [enrich(entry) for entry in entries]
    with ThreadPoolExecutor(max_workers=min(8, len(entries))) as pool:
        return list(pool.map(enrich, entries))


def _attach_material_events(items: list[dict[str, Any]], include_jquants: bool = False) -> list[dict[str, Any]]:
    def enrich(item: dict[str, Any]) -> dict[str, Any]:
        if item.get("material"):
            return item
        try:
            material = material_events_for_ticker(
                item.get("ticker", ""),
                item.get("name", ""),
                include_jquants=include_jquants,
            )
        except Exception:
            material = {
                "available": False,
                "materialAvailable": False,
                "materialScore": 0,
                "tone": "unconfirmed",
                "summary": "Material event lookup failed; treat this signal as unconfirmed.",
                "items": [],
            }
        return {**item, "material": material}

    if len(items) <= 1:
        return [enrich(item) for item in items]
    with ThreadPoolExecutor(max_workers=min(8, len(items))) as pool:
        return list(pool.map(enrich, items))


def _best_intraday_opportunity(items: list[dict[str, Any]], budget_jpy: int) -> dict[str, Any] | None:
    opportunities = [
        opportunity
        for opportunity in (_build_intraday_opportunity(item, budget_jpy) for item in items)
        if opportunity is not None
    ]
    opportunities = [opportunity for opportunity in opportunities if _opportunity_has_actionable_size(opportunity)]
    if not opportunities:
        return None
    return max(
        opportunities,
        key=lambda item: (
            _opportunity_tradeability_weight(item),
            _finite(item.get("opportunityScore")),
            _finite(item.get("expectedProfitJpy")),
            _finite(item.get("confidencePct")),
        ),
    )


def _ai_fund_watch_state(item: dict[str, Any] | None) -> str:
    if not item:
        return "WAIT"
    if _opportunity_tradeability_weight(item) <= 0:
        return "RESEARCH_ONLY"
    if not _opportunity_has_actionable_size(item):
        return "RESEARCH_ONLY"
    risk_adjusted = item.get("opportunityScore") if item.get("opportunityScore") is not None else item.get("expectedProfitJpy")
    if _finite(risk_adjusted) > 0 and _finite(item.get("confidencePct")) >= 55:
        return "APPROVAL_REQUIRED"
    return "RESEARCH_ONLY"


def _ai_fund_desk_payload(
    *,
    best_opportunity: dict[str, Any] | None,
    ranked_items: list[dict[str, Any]],
    portfolio: dict[str, Any],
    generated_at: str | None,
    budget_jpy: int,
) -> dict[str, Any]:
    holdings = portfolio.get("holdings") or []
    active_holding_count = len(holdings)
    portfolio_risk = portfolio.get("marketContext") or {}
    watch_state = _ai_fund_watch_state(best_opportunity)
    best_ticker = best_opportunity.get("ticker") if best_opportunity else None
    best_name = best_opportunity.get("name") if best_opportunity else None
    expected_profit = _finite(best_opportunity.get("expectedProfitJpy")) if best_opportunity else 0
    max_loss = _finite(best_opportunity.get("maxLossJpy")) if best_opportunity else 0
    confidence = _finite(best_opportunity.get("confidencePct")) if best_opportunity else 0

    draft_order = None
    if best_opportunity and watch_state == "APPROVAL_REQUIRED" and _opportunity_has_actionable_size(best_opportunity):
        draft_order = {
            "status": "DRAFT_ONLY",
            "ticker": best_ticker,
            "name": best_name,
            "side": "BUY",
            "orderType": "LIMIT_REVIEW",
            "entryPrice": best_opportunity.get("entryPrice"),
            "shares": best_opportunity.get("shares"),
            "takeProfit": best_opportunity.get("targetPrice"),
            "stopLoss": best_opportunity.get("stopLoss"),
            "budgetUsedJpy": best_opportunity.get("budgetUsedJpy"),
            "expiresAt": "手入力前に当日の値動きと板情報を再確認してください。",
            "brokerInstruction": "\u6ce8\u6587\u306f\u4f5c\u6210\u3057\u307e\u305b\u3093\u3002\u624b\u5165\u529b\u524d\u306e\u78ba\u8a8d\u30c1\u30a7\u30c3\u30af\u30ea\u30b9\u30c8\u3068\u3057\u3066\u306e\u307f\u4f7f\u7528\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
        }

    lanes = [
        {
            "id": "research",
            "label": "候補とシグナルの調査",
            "status": "COMPLETE" if ranked_items else "WAIT",
            "summary": f"市場データからランキング候補 {len(ranked_items)}件を確認しました。",
            "evidence": [
                "JPX上場銘柄一覧をスクリーニング対象にしています。",
                "日足価格、出来高、売買代金、モメンタム、品質指標を確認しています。",
                "監査済みの機会評価に基づいて候補順を決めています。",
            ],
        },
        {
            "id": "plan",
            "label": "手入力計画の下書き",
            "status": "READY" if best_opportunity else "WAIT",
            "summary": (
                f"{best_ticker} {best_name} を手入力前の確認候補に選びました。期待損益 {expected_profit:.0f}円、最大損失 {max_loss:.0f}円です。"
                if best_opportunity
                else "現在の確認基準を満たす候補はありません。"
            ),
            "evidence": (best_opportunity.get("whyBuy") or [])[:3] if best_opportunity else [],
        },
        {
            "id": "approval",
            "label": "人による承認確認",
            "status": watch_state,
            "summary": "外部操作の前には必ず人による確認が必要です。このシステムは証券会社へ注文を送りません。",
            "evidence": [
                "実注文の執行機能は無効です。",
                "注文下書きは確認用の参考情報です。",
                "リアルタイムの板情報と適時開示は手作業で確認してください。",
            ],
        },
        {
            "id": "audit",
            "label": "リスク監査記録",
            "status": "LOGGED",
            "summary": "リスク、データ鮮度、材料、判定無効条件を確認記録として残します。",
            "evidence": (best_opportunity.get("invalidConditions") or [])[:3] if best_opportunity else [],
        },
    ]

    top_research = [
        {
            "ticker": item.get("ticker"),
            "name": item.get("name"),
            "score": item.get("surgeScore") or item.get("candidateScore"),
            "changePct": item.get("changePct"),
            "turnoverJpy": item.get("turnoverJpy"),
            "reason": item.get("reason"),
        }
        for item in ranked_items[:6]
    ]

    guardrails = [
        {
            "label": "実注文機能は無効",
            "ok": not LIVE_BROKER_ORDERS_ENABLED,
            "detail": "このアプリはローカルの確認データのみを作成し、実注文は行いません。",
        },
        {
            "label": "人による承認が必要",
            "ok": draft_order is not None and watch_state == "APPROVAL_REQUIRED",
            "detail": "手入力前の確認に値する候補がある場合だけ下書きを表示します。",
        },
        {
            "label": "保有集中の確認",
            "ok": active_holding_count <= 5,
            "detail": f"保有中 {active_holding_count}銘柄。新たなリスクを加える前に集中度を確認してください。",
        },
        {
            "label": "最大損失の試算",
            "ok": max_loss > 0,
            "detail": f"試算上の最大損失は {max_loss:.0f}円です。",
        },
    ]

    return {
        "mode": "LOCAL_AI_HEDGE_FUND_DESK",
        "licenseNote": "学習・検証用のシミュレーターです。証券会社接続や投資助言は提供しません。",
        "generatedAt": generated_at or dt.datetime.now(dt.timezone.utc).isoformat(),
        "budgetJpy": budget_jpy,
        "liveBrokerOrdersEnabled": LIVE_BROKER_ORDERS_ENABLED,
        "summary": {
            "state": watch_state,
            "headline": (
                f"{best_ticker} {best_name}: 手入力前の確認候補です。期待損益 {expected_profit:.0f}円 / 最大損失 {max_loss:.0f}円。"
                if best_opportunity
                else "手入力前の確認に進める候補はありません。"
            ),
            "expectedProfitJpy": round(expected_profit, 1),
            "maxLossJpy": round(max_loss, 1),
            "confidencePct": round(confidence, 1),
            "activeHoldingCount": active_holding_count,
            "portfolioCashJpy": portfolio.get("cash"),
            "marketContext": portfolio_risk,
        },
        "workflow": lanes,
        "draftOrder": draft_order,
        "guardrails": guardrails,
        "researchQueue": top_research,
        "auditTrail": {
            "whyBuy": (best_opportunity.get("whyBuy") or []) if best_opportunity else [],
            "whyNotBuy": (best_opportunity.get("whyNotBuy") or []) if best_opportunity else [],
            "invalidConditions": (best_opportunity.get("invalidConditions") or []) if best_opportunity else [],
            "dataFreshness": best_opportunity.get("dataFreshness") if best_opportunity else {},
            "material": best_opportunity.get("material") if best_opportunity else {},
        },
        "disclaimer": "学習・検証用のローカルシミュレーションです。独自の確認とリスク検討なしに売買判断へ使用しないでください。",
    }


def _market_review_candidates_for_budget(
    budget_jpy: int,
    *,
    kind: str = "surge",
    limit: int = 30,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, dict[str, Any] | None, str | None]:
    ranking_payload = market_rankings(kind=kind, budget=budget_jpy, limit=limit)
    return (
        ranking_payload.get("items") or [],
        ranking_payload.get("bestOpportunity"),
        ranking_payload.get("bestAvailableOpportunity"),
        ranking_payload.get("generatedAt"),
    )


def _rank_market_items(items: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    items = [_market_quality_overlay(item) for item in items if item]
    if kind == "surge":
        key = lambda item: (_finite(item.get("surgeScore")), -_finite(item.get("overheatRisk")), _finite(item.get("turnoverJpy")))
    elif kind == "breakout":
        key = lambda item: (1 if item.get("ytdHighBreakout") else 0, 1 if item.get("high20Breakout") else 0, _finite(item.get("surgeScore")), _finite(item.get("turnoverJpy")))
    elif kind == "overheat":
        key = lambda item: (_finite(item.get("overheatRisk")), _finite(item.get("changePct")), _finite(item.get("divergence25Pct")))
    elif kind == "popular":
        key = lambda item: (_finite(item.get("popularityScore")), _finite(item.get("turnoverJpy")), _finite(item.get("volumeRatio")))
    elif kind == "volume":
        key = lambda item: (_finite(item.get("volume")), _finite(item.get("turnoverJpy")))
    elif kind == "quality":
        key = lambda item: (_finite(item.get("candidateScore")), _finite(item.get("preopenScore")), _finite(item.get("momentum20Pct")))
    else:
        key = lambda item: (_finite(item.get("changePct")), _finite(item.get("turnoverJpy")), _finite(item.get("candidateScore")))
    ranked = sorted(items, key=key, reverse=True)
    return [{**item, "rank": index + 1} for index, item in enumerate(ranked)]


def _market_relative_context(item: dict[str, Any], universe_items: list[dict[str, Any]]) -> dict[str, Any]:
    changes = [_finite(candidate.get("changePct")) for candidate in universe_items if candidate.get("changePct") is not None]
    if not changes:
        return {"available": False, "tone": "UNKNOWN", "summary": "市場全体の状況を取得できません。"}
    market_avg = float(np.mean(changes))
    advancer_pct = sum(1 for value in changes if value > 0) / len(changes) * 100
    sector = str(item.get("sector") or "").strip()
    sector_candidates = [
        candidate
        for candidate in universe_items
        if sector and str(candidate.get("sector") or "").strip().lower() == sector.lower()
    ]
    sector_changes = [_finite(candidate.get("changePct")) for candidate in sector_candidates if candidate.get("changePct") is not None]
    sector_avg = float(np.mean(sector_changes)) if sector_changes else market_avg
    sector_advancer_pct = sum(1 for value in sector_changes if value > 0) / len(sector_changes) * 100 if sector_changes else advancer_pct
    relative = _finite(item.get("changePct")) - market_avg
    sector_relative = _finite(item.get("changePct")) - sector_avg
    risk_off = advancer_pct < 38 or market_avg <= -0.8
    risk_on = advancer_pct >= 58 and market_avg >= 0.25
    sector_tailwind = sector_avg >= market_avg + 0.35 and sector_advancer_pct >= 52
    sector_headwind = sector_avg <= market_avg - 0.35 or sector_advancer_pct < 42
    tone = "RISK_OFF" if risk_off else "RISK_ON" if risk_on else "NEUTRAL"
    if sector_tailwind and not risk_off:
        tone = "SECTOR_TAILWIND"
    elif sector_headwind:
        tone = "SECTOR_HEADWIND" if not risk_off else "RISK_OFF"
    return {
        "available": True,
        "tone": tone,
        "riskOff": risk_off,
        "riskOn": risk_on,
        "sectorTailwind": sector_tailwind,
        "sectorHeadwind": sector_headwind,
        "marketAvgChangePct": round(market_avg, 2),
        "marketAdvancerPct": round(advancer_pct, 1),
        "sector": sector or None,
        "sectorSampleCount": len(sector_changes),
        "sectorAvgChangePct": round(sector_avg, 2),
        "sectorAdvancerPct": round(sector_advancer_pct, 1),
        "relativeToMarketPct": round(relative, 2),
        "relativeToSectorPct": round(sector_relative, 2),
        "summary": (
            f"市場平均 {market_avg:+.2f}% / 値上がり銘柄 {advancer_pct:.1f}%; "
            f"{sector or '業種'}平均 {sector_avg:+.2f}% / 市場比 {relative:+.2f}%"
        ),
    }


def _attach_market_relative_context(
    items: list[dict[str, Any]],
    universe_items: list[dict[str, Any]],
    *,
    fallback_to_items: bool = True,
    context_integrity: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    context_source = universe_items if universe_items or not fallback_to_items else items
    enriched: list[dict[str, Any]] = []
    for item in items:
        relative = _market_relative_context(item, context_source)
        if context_integrity:
            relative = {**relative, "contextIntegrity": context_integrity}
            if not relative.get("available"):
                relative["summary"] = context_integrity.get("detail") or relative.get("summary")
        enriched.append({**item, "marketRelative": relative})
    return enriched


def _attach_market_master_metadata(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        universe = load_market_universe()
    except Exception:
        universe = {}
    if not universe:
        return items
    enriched: list[dict[str, Any]] = []
    for item in items:
        master = universe.get(str(item.get("ticker") or ""))
        if not master:
            enriched.append(item)
            continue
        enriched.append(
            {
                **item,
                "marketSection": item.get("marketSection") or master.get("market_section") or "",
                "sector": item.get("sector") or master.get("sector") or "",
            }
        )
    return enriched


def _market_context_freshness(snapshot: dict[str, Any] | None, max_age_days: int = MARKET_CONTEXT_MAX_AGE_DAYS) -> dict[str, Any]:
    generated_at = snapshot.get("generatedAt") if snapshot else None
    age_days = _latest_bar_age_days(generated_at)
    stale = bool(age_days is None or age_days > max_age_days)
    return {
        "generatedAt": generated_at,
        "ageDays": age_days,
        "stale": stale,
        "maxAgeDays": max_age_days,
    }


def _market_context_items_from_snapshot(
    snapshot: dict[str, Any] | None,
    freshness: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    freshness = freshness or _market_context_freshness(snapshot)
    if freshness.get("stale"):
        return []
    context_items = _market_snapshot_items(snapshot)
    return [item for item in context_items if item.get("changePct") is not None]


def _market_context_integrity(
    snapshot: dict[str, Any] | None,
    freshness: dict[str, Any],
    context_items: list[dict[str, Any]],
    *,
    required: bool = False,
    source_policy: str = "full_market_snapshot",
) -> dict[str, Any]:
    provider = snapshot.get("provider") if snapshot else None
    source = snapshot.get("source") if snapshot else None
    context_count = len(context_items)
    stale = bool(freshness.get("stale"))
    if not snapshot:
        usable = False
        reason = "missing_snapshot"
        label = "市場全体の状況を取得できません"
        detail = "市場全体のスナップショットがないため、地合い判定は中立として手作業で確認してください。"
    elif stale:
        usable = False
        reason = "stale_snapshot"
        label = "市場全体のデータが古い状態です"
        detail = (
            f"市場全体のスナップショットは {freshness.get('ageDays')}日前のものです。"
            "表示中のランキングだけで地合いを判断しないでください。"
        )
    elif context_count <= 0:
        usable = False
        reason = "empty_context"
        label = "市場全体のデータが空です"
        detail = "市場全体の日次変動データを利用できないため、地合いは手作業で確認してください。"
    else:
        usable = True
        reason = "fresh_full_market_context"
        label = "市場全体のデータを利用できます"
        detail = f"市場と業種の地合い判定に {context_count}銘柄のデータを使用できます。"
    return {
        "required": bool(required),
        "usable": bool(usable),
        "verdict": "PASS" if usable else "REVIEW" if required else "INFO",
        "reason": reason,
        "label": label,
        "detail": detail,
        "provider": provider,
        "source": source,
        "sourcePolicy": source_policy,
        "contextCount": context_count,
        "generatedAt": freshness.get("generatedAt"),
        "ageDays": freshness.get("ageDays"),
        "stale": stale,
        "maxAgeDays": freshness.get("maxAgeDays"),
    }


def _audit_gate(gate_id: str, label: str, ok: bool, severity: str, detail: str, value: Any = None) -> dict[str, Any]:
    return {
        "id": gate_id,
        "label": label,
        "ok": bool(ok),
        "severity": severity,
        "detail": detail,
        "value": value,
    }


def _candidate_decision_audit(
    *,
    item: dict[str, Any],
    confidence: float,
    target_profit: float,
    max_loss: float,
    latest_bar_age_days: int | None,
    material: dict[str, Any],
    market_relative: dict[str, Any],
    backtest: dict[str, Any],
) -> dict[str, Any]:
    rr = target_profit / max_loss if max_loss > 0 else 0
    backtest_samples = int(_finite(backtest.get("sampleCount")))
    backtest_risk_adjusted = _finite(backtest.get("riskAdjustedReturnPct"))
    backtest_profit_factor = _finite(backtest.get("profitFactor"))
    material_tone = material.get("tone", "unconfirmed")
    material_ok = bool(
        material_tone in {"positive", "important", "neutral"}
        and not material.get("hasNegative")
        and material.get("freshnessVerdict") != "stale"
    )
    backtest_ok = bool(
        backtest_samples >= 3
        and backtest_risk_adjusted > 0
        and backtest_profit_factor >= 1.05
    )
    market_integrity = market_relative.get("contextIntegrity") or {}
    market_context_required = bool(market_integrity.get("required"))
    market_context_blocked = market_context_required and not bool(market_integrity.get("usable"))
    market_ok = not bool(market_relative.get("riskOff") or market_relative.get("sectorHeadwind") or market_context_blocked)
    market_detail = (
        market_integrity.get("detail")
        if market_context_blocked
        else market_relative.get("summary") or "市場の地合いを取得できません。"
    )
    market_value = market_integrity.get("verdict") if market_context_blocked else market_relative.get("tone")
    gates = [
        _audit_gate(
            "price_freshness",
            "価格の鮮度",
            latest_bar_age_days is not None and latest_bar_age_days <= 5,
            "high",
            "最新の日足は許容する鮮度範囲内です。",
            latest_bar_age_days,
        ),
        _audit_gate(
            "liquidity",
            "流動性",
            bool(item.get("liquidityOk")),
            "high",
            f"流動性区分 {item.get('liquidityGrade', '不明')}",
            item.get("liquidityGrade"),
        ),
        _audit_gate(
            "material",
            "材料イベント",
            material_ok,
            "high" if material_tone in {"negative", "unconfirmed"} else "medium",
            f"材料区分 {material_tone} / 鮮度 {material.get('freshnessVerdict', '不明')}",
            material_tone,
        ),
        _audit_gate(
            "pattern_backtest",
            "類似パターン検証",
            backtest_ok,
            "medium",
            f"検証件数 {backtest_samples}、リスク調整後 {backtest_risk_adjusted:+.2f}%、PF {backtest_profit_factor:.2f}",
            backtest_risk_adjusted,
        ),
        _audit_gate(
            "market_regime",
            "市場の地合い",
            market_ok,
            "medium",
            market_detail,
            market_value,
        ),
        _audit_gate(
            "risk_reward",
            "損益比",
            rr >= 1.3 and target_profit > 0 and max_loss > 0,
            "high",
            f"RR {rr:.2f} / 目標利益 {target_profit:.2f} / 最大損失 {max_loss:.2f}",
            round(rr, 2),
        ),
        _audit_gate(
            "overheat",
            "過熱度",
            _finite(item.get("overheatRisk")) < 58,
            "medium",
            f"過熱リスク {item.get('overheatRisk', 0)}",
            item.get("overheatRisk"),
        ),
    ]
    failed_high = [gate for gate in gates if not gate["ok"] and gate["severity"] == "high"]
    failed_medium = [gate for gate in gates if not gate["ok"] and gate["severity"] == "medium"]
    passed = sum(1 for gate in gates if gate["ok"])
    audit_score = round(max(0, min(100, confidence - len(failed_high) * 9 - len(failed_medium) * 4 + passed * 1.2)), 1)
    if failed_high or audit_score < 55:
        verdict = "REJECT"
        label = "\u6761\u4ef6\u4e00\u81f4\u30b9\u30b3\u30a2: \u898b\u9001\u308a"
    elif failed_medium or audit_score < 72:
        verdict = "REVIEW"
        label = "\u6761\u4ef6\u4e00\u81f4\u30b9\u30b3\u30a2: \u8981\u78ba\u8a8d"
    else:
        verdict = "PASS"
        label = "\u6761\u4ef6\u4e00\u81f4\u30b9\u30b3\u30a2: \u901a\u904e"
    return {
        "verdict": verdict,
        "label": label,
        "auditScore": audit_score,
        "passedCount": passed,
        "failedHighCount": len(failed_high),
        "failedMediumCount": len(failed_medium),
        "gates": gates,
    }


def _cross_engine_consistency(
    *,
    ticker: str,
    candidate: dict[str, Any] | None = None,
    opportunity: dict[str, Any] | None = None,
    advanced_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    candidate = candidate or {}
    opportunity = opportunity or {}
    advanced_report = advanced_report or {}
    expected_ticker = validate_market_ticker(ticker)

    candidate_quality = candidate.get("candidateQuality") or {}
    data_quality = candidate.get("dataQuality") or candidate_quality.get("dataQuality") or advanced_report.get("dataQuality")
    candidate_score = _finite(
        candidate.get("candidateScore")
        or candidate.get("score")
        or candidate_quality.get("qualityScore")
        or candidate.get("confidence")
    )
    trade_readiness = str(opportunity.get("tradeReadiness") or candidate.get("tradeReadiness") or "").lower()
    if not trade_readiness:
        execution = candidate.get("analysis", {}).get("execution", {}) if isinstance(candidate.get("analysis"), dict) else {}
        decision = str(candidate.get("decision") or execution.get("decision") or "").upper()
        if decision in {"DAYTRADE_ENTRY_OK", "BUY_LIMIT_OK"}:
            trade_readiness = "ready"
        elif decision in {"AVOID", "SELL"}:
            trade_readiness = "avoid"
        else:
            trade_readiness = "review"

    decision_audit = opportunity.get("decisionAudit") or candidate.get("decisionAudit") or {}
    audit_verdict = str(decision_audit.get("verdict") or "UNKNOWN").upper()
    advanced_verdict = str(advanced_report.get("verdict") or "UNKNOWN").upper()
    reliability = advanced_report.get("analysisReliability") or {}
    reliability_grade = str(reliability.get("grade") or "insufficient").lower()
    guardrails = advanced_report.get("guardrails") or []
    guardrails_ok = bool(guardrails) and all(bool(item.get("ok")) for item in guardrails)
    advanced_data_quality = advanced_report.get("dataQuality") or {}
    advanced_data_ok = bool(
        advanced_data_quality
        and advanced_data_quality.get("sourceOk")
        and advanced_data_quality.get("priceOk")
        and _finite(advanced_data_quality.get("score")) >= 65
    )
    data_quality_ok = bool(data_quality and _candidate_data_quality_ok(data_quality)) and (advanced_data_ok if advanced_report else True)

    if not candidate or not advanced_report:
        missing = []
        if not candidate:
            missing.append("ランキング候補")
        if not advanced_report:
            missing.append("高度分析")
        return {
            "source": "backend-cross-engine",
            "ticker": expected_ticker,
            "status": "pending",
            "label": "クロスチェック待ち",
            "detail": f"{', '.join(missing)} の分析結果がそろうと、ランキング・短期売買・高度分析を照合します。",
            "candidateScore": candidate_score,
            "tradeReadiness": trade_readiness or "unknown",
            "decisionAuditVerdict": audit_verdict,
            "advancedVerdict": advanced_verdict,
            "advancedCompositeScore": _finite(advanced_report.get("compositeScore")),
            "analysisReliabilityGrade": reliability_grade,
            "guardrailsOk": guardrails_ok,
            "dataQualityOk": data_quality_ok,
            "gates": [],
        }

    source_tickers = [
        value
        for value in [
            candidate.get("ticker"),
            opportunity.get("ticker"),
            advanced_report.get("ticker"),
        ]
        if value
    ]
    ticker_match = all(validate_market_ticker(str(value)) == expected_ticker for value in source_tickers)
    opportunity_ok = trade_readiness == "ready" and audit_verdict in {"PASS", "UNKNOWN"}
    advanced_ready = advanced_verdict == "ADVANCED_READY"
    reliability_ok = reliability_grade in {"strong", "moderate"}

    gates = [
        _audit_gate(
            "ticker_match",
            "銘柄コードの一致",
            ticker_match,
            "high",
            f"対象 {expected_ticker}、各分析の銘柄 {', '.join(map(str, source_tickers)) or 'なし'}",
            source_tickers,
        ),
        _audit_gate(
            "candidate_strength",
            "候補の強さ",
            candidate_score >= 55,
            "high" if candidate_score < 45 else "medium",
            f"候補スコア {candidate_score:.1f}/100",
            candidate_score,
        ),
        _audit_gate(
            "price_data_quality",
            "価格データの品質",
            data_quality_ok,
            "high",
            f"{(data_quality or {}).get('source', '出所不明')} / 品質スコア {(data_quality or {}).get('score', '-')}",
            data_quality,
        ),
        _audit_gate(
            "opportunity_readiness",
            "短期判断の準備状況",
            opportunity_ok,
            "high" if trade_readiness == "avoid" or audit_verdict == "REJECT" else "medium",
            f"準備状況 {trade_readiness or '不明'} / 監査 {audit_verdict}",
            {"tradeReadiness": trade_readiness, "decisionAuditVerdict": audit_verdict},
        ),
        _audit_gate(
            "advanced_verdict",
            "高度分析の判定",
            advanced_ready,
            "high" if advanced_verdict in {"DEFENSIVE", "UNKNOWN"} else "medium",
            advanced_report.get("actionLabel") or advanced_verdict,
            advanced_verdict,
        ),
        _audit_gate(
            "analysis_reliability",
            "分析の信頼性",
            reliability_ok,
            "high" if reliability_grade == "insufficient" else "medium",
            reliability.get("label") or reliability_grade,
            reliability_grade,
        ),
        _audit_gate(
            "advanced_guardrails",
            "高度分析の安全条件",
            guardrails_ok,
            "medium",
            f"{len(guardrails)}件中 {sum(1 for item in guardrails if item.get('ok'))}件が通過",
            guardrails,
        ),
    ]
    failed_high = [gate for gate in gates if not gate["ok"] and gate["severity"] == "high"]
    failed_medium = [gate for gate in gates if not gate["ok"] and gate["severity"] == "medium"]
    if failed_high:
        status = "blocked"
        label = "クロスチェック不一致"
        failed_labels = "、".join(gate["label"] for gate in failed_high[:3])
        detail = f"ランキング候補ですが、{failed_labels} が未通過です。新規判断は見送り寄りです。"
    elif failed_medium:
        status = "review"
        label = "クロスチェック要確認"
        failed_labels = "、".join(gate["label"] for gate in failed_medium[:3])
        detail = f"方向性は残りますが、{failed_labels} は追加確認が必要です。"
    else:
        status = "aligned"
        label = "クロスチェック一致"
        detail = "ランキング候補、短期売買監査、高度分析の方向性が一致しています。"

    return {
        "source": "backend-cross-engine",
        "ticker": expected_ticker,
        "status": status,
        "label": label,
        "detail": detail,
        "candidateScore": round(candidate_score, 1),
        "tradeReadiness": trade_readiness or "unknown",
        "decisionAuditVerdict": audit_verdict,
        "advancedVerdict": advanced_verdict,
        "advancedCompositeScore": _finite(advanced_report.get("compositeScore")),
        "analysisReliabilityGrade": reliability_grade,
        "guardrailsOk": guardrails_ok,
        "dataQualityOk": data_quality_ok,
        "gates": gates,
    }


def _advanced_report_summary(advanced_report: dict[str, Any] | None) -> dict[str, Any] | None:
    if not advanced_report:
        return None
    reliability = advanced_report.get("analysisReliability") or {}
    return {
        "verdict": advanced_report.get("verdict"),
        "actionLabel": advanced_report.get("actionLabel"),
        "compositeScore": _finite(advanced_report.get("compositeScore")),
        "analysisReliabilityGrade": reliability.get("grade"),
    }


def _opportunity_with_cross_engine_check(
    opportunity: dict[str, Any],
    cross_check: dict[str, Any],
    advanced_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    updated = {**opportunity, "advancedCrossEngineCheck": cross_check}
    if advanced_summary:
        updated["advancedReportSummary"] = advanced_summary

    status = str(cross_check.get("status") or "").lower()
    if status not in {"blocked", "review"}:
        return updated

    warning = f"Advanced cross-engine check: {status}"
    expert_warnings = list(updated.get("expertWarnings") or [])
    if warning not in expert_warnings:
        expert_warnings.append(warning)
    updated["expertWarnings"] = expert_warnings

    why_not_buy = list(updated.get("whyNotBuy") or [])
    if warning not in why_not_buy:
        why_not_buy.append(warning)
    updated["whyNotBuy"] = why_not_buy

    if status != "blocked":
        return updated

    updated.update(
        {
            "shares": 0,
            "recommendedShares": 0,
            "budgetUsedJpy": 0,
            "recommendedBudgetUsedJpy": 0,
            "targetProfitJpy": 0,
            "maxLossJpy": 0,
            "expectedProfitJpy": 0,
            "riskAdjustedExpectedJpy": 0,
            "opportunityScore": 0,
            "tradeReadiness": "avoid",
            "positionSizingVerdict": "skip",
        }
    )
    breakdown = dict(updated.get("scoreBreakdown") or {})
    breakdown.update(
        {
            "finalOpportunityScore": 0,
            "positionSizeFraction": 0,
            "recommendedShares": 0,
            "recommendedBudgetUsedJpy": 0,
            "tradeReadiness": "avoid",
            "positionSizingVerdict": "skip",
            "advancedCrossEngineStatus": status,
        }
    )
    updated["scoreBreakdown"] = breakdown
    return updated


def _attach_advanced_cross_engine_checks(
    items: list[dict[str, Any]],
    *,
    limit: int = 3,
    budget_jpy: int = DEFAULT_INTRADAY_BUDGET_JPY,
) -> list[dict[str, Any]]:
    if not items or limit <= 0 or build_advanced_report is None:
        return items
    try:
        eligible_tickers = set(load_market_universe())
    except Exception:
        eligible_tickers = set()
    eligible_tickers.update(STOCKS)
    eligible_tickers.update(FALLBACK_CANDIDATE_POOL)

    enriched: list[dict[str, Any]] = []
    checked = 0
    for item in items:
        if checked >= limit:
            enriched.append(item)
            continue
        if item.get("advancedCrossEngineCheck") or (item.get("intradayOpportunity") or {}).get("advancedCrossEngineCheck"):
            enriched.append(item)
            continue
        try:
            ticker = validate_market_ticker(item.get("ticker"))
        except Exception:
            enriched.append(item)
            continue
        is_domestic_exchange_code = bool(re.fullmatch(r"[0-9]{4,5}\.T", ticker))
        if ticker not in eligible_tickers and not is_domestic_exchange_code:
            enriched.append(item)
            continue

        opportunity = item.get("intradayOpportunity") or _build_intraday_opportunity(item, budget_jpy)
        if opportunity is None:
            enriched.append(item)
            continue

        checked += 1
        hist = None
        try:
            hist = clean_price_history(get_stock_data(ticker, period="1y", interval="1d"))
        except Exception:
            hist = None

        data_quality = item.get("dataQuality") or (item.get("candidateQuality") or {}).get("dataQuality")
        quality = item.get("candidateQuality")
        advanced_report = None
        if hist is not None and not hist.empty:
            closes = [_finite(value) for value in hist["Close"].tolist()] if "Close" in hist else []
            highs = [_finite(value) for value in hist["High"].tolist()] if "High" in hist else closes
            lows = [_finite(value) for value in hist["Low"].tolist()] if "Low" in hist else closes
            volumes = [_finite(value) for value in hist["Volume"].tolist()] if "Volume" in hist else [0] * len(closes)
            data_quality = _candidate_data_quality(hist, closes, volumes)
            if closes and highs and lows and volumes and (not quality or not quality.get("dataQuality")):
                rr = calculate_risk_reward(closes[-1], highs, lows, closes)
                quality = build_candidate_quality(closes, highs, lows, volumes, rr=rr, data_quality=data_quality)
            try:
                advanced_report = build_advanced_report(
                    ticker,
                    hist,
                    capital_jpy=INITIAL_CASH,
                    risk_pct=1.0,
                )
            except Exception:
                advanced_report = None

        candidate = {**item, "ticker": ticker}
        if data_quality:
            candidate["dataQuality"] = data_quality
        if quality:
            candidate["candidateQuality"] = quality

        cross_check = _cross_engine_consistency(
            ticker=ticker,
            candidate=candidate,
            opportunity=opportunity,
            advanced_report=advanced_report,
        )
        advanced_summary = _advanced_report_summary(advanced_report)
        updated_opportunity = _opportunity_with_cross_engine_check(opportunity, cross_check, advanced_summary)
        enriched_item = {
            **item,
            "advancedCrossEngineCheck": cross_check,
            "intradayOpportunity": updated_opportunity,
        }
        if advanced_summary:
            enriched_item["advancedReportSummary"] = advanced_summary
        if data_quality:
            enriched_item["dataQuality"] = data_quality
            price_as_of = data_quality.get("latestBarDate")
            quality_price = _finite(data_quality.get("latestClosePrice"))
            if price_as_of:
                old_price = _finite(enriched_item.get("price"))
                quality_updates = {
                    "latestBarDate": price_as_of,
                    "latestBarAgeDays": data_quality.get("latestBarAgeDays"),
                    "priceAsOfDate": price_as_of,
                    "priceSource": data_quality.get("source") or item.get("priceSource"),
                }
                if quality_price > 0:
                    quality_updates["price"] = quality_price
                enriched_item.update(quality_updates)
                if quality_price > 0:
                    if abs(quality_price - old_price) > 0.01:
                        for stale_level_key in ("targetPrice", "stopLoss", "rewardPct", "riskPct", "rrRatio"):
                            enriched_item.pop(stale_level_key, None)
                    rebuilt_opportunity = _build_intraday_opportunity(enriched_item, budget_jpy)
                    if rebuilt_opportunity:
                        cross_check = _cross_engine_consistency(
                            ticker=ticker,
                            candidate=enriched_item,
                            opportunity=rebuilt_opportunity,
                            advanced_report=advanced_report,
                        )
                        enriched_item["intradayOpportunity"] = _opportunity_with_cross_engine_check(
                            rebuilt_opportunity,
                            cross_check,
                            advanced_summary,
                        )
        if quality:
            enriched_item["candidateQuality"] = quality
        enriched.append(enriched_item)
    return enriched


def _number_from_yahoo_text(value: str, default: float = 0.0) -> float:
    text = html_lib.unescape(str(value or "")).replace(",", "").replace("+", "").strip()
    if not text or text == "-":
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _decode_http_text(response: Any) -> str:
    raw_content = getattr(response, "content", None)
    if raw_content is None:
        return str(getattr(response, "text", "") or "")
    if isinstance(raw_content, str):
        return raw_content

    candidates = [
        "utf-8-sig",
        getattr(response, "apparent_encoding", None),
        getattr(response, "encoding", None),
        "cp932",
        "shift_jis",
    ]
    attempted: set[str] = set()
    for candidate in candidates:
        encoding = str(candidate or "").strip()
        normalized = encoding.lower().replace("_", "-")
        if not encoding or normalized in attempted:
            continue
        attempted.add(normalized)
        try:
            return raw_content.decode(encoding, errors="strict")
        except (LookupError, UnicodeDecodeError):
            continue
    return raw_content.decode("utf-8", errors="replace")


def _yahoo_finance_gainers(limit: int = MARKET_RANKING_LIMIT) -> list[dict[str, Any]]:
    response = requests.get(
        YAHOO_FINANCE_GAINERS_URL,
        timeout=12,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()
    html = _decode_http_text(response)
    rows = re.findall(r'<tr class="RankingTable__row__1Gwp">.*?</tr>', html, re.S)
    items: list[dict[str, Any]] = []
    fetched_at = dt.datetime.now(JST)
    fetched_date = fetched_at.date().isoformat()
    for row in rows[:limit]:
        rank_match = re.search(r'RankingTable__rank__2fAZ">(\d+)</th>', row)
        quote_match = re.search(r'href="https://finance\.yahoo\.co\.jp/quote/([0-9A-Z]{4,5})\.T"[^>]*>(.*?)</a>', row, re.S)
        supplements = re.findall(r'<li class="RankingTable__supplement__vv_m">(.*?)</li>', row, re.S)
        values = re.findall(r'StyledNumber__value__3rXW">([^<]+)', row)
        if not quote_match or len(values) < 4:
            continue
        code = quote_match.group(1)
        ticker = f"{code}.T"
        name = html_lib.unescape(re.sub(r"<[^>]+>", "", quote_match.group(2))).strip() or ticker
        market_section = ""
        if len(supplements) >= 2:
            market_section = html_lib.unescape(re.sub(r"<[^>]+>", "", supplements[1])).strip()
        price = _number_from_yahoo_text(values[0])
        change_jpy = _number_from_yahoo_text(values[1])
        change_pct = _number_from_yahoo_text(values[2])
        volume = int(_number_from_yahoo_text(values[3]))
        turnover = price * volume
        items.append(
            {
                "ticker": ticker,
                "name": name,
                "marketSection": market_section,
                "sector": "",
                "price": price,
                "changeJpy": change_jpy,
                "changePct": change_pct,
                "volume": volume,
                "turnoverJpy": round(turnover, 1),
                "volumeRatio": 0,
                "momentum5Pct": change_pct,
                "momentum20Pct": change_pct,
                "candidateScore": round(max(0, min(100, change_pct * 2)), 1),
                "popularityScore": round(min(100, max(0, math.log10(max(turnover, 1)) * 8 + max(change_pct, 0))), 1),
                "surgeScore": round(max(0, min(100, change_pct * 2 + math.log10(max(turnover, 1)) * 3)), 1),
                "overheatRisk": round(max(0, min(100, max(change_pct - 15, 0) * 2)), 1),
                "surgeStage": "Yahoo Finance 値上がりランキング",
                "surgeFlags": ["Yahoo Finance 値上がりランキング"],
                "latestBarDate": None,
                "latestBarAgeDays": None,
                "priceAsOfDate": None,
                "priceSource": None,
                "sourceFetchedAt": fetched_at.isoformat(),
                "sourceFetchedDate": fetched_date,
                "source": YAHOO_FINANCE_GAINERS_URL,
                "externalLinks": external_research_links(ticker, name),
                "reason": f"Yahoo Finance 値上がり率 {change_pct:+.2f}%",
                "rank": int(rank_match.group(1)) if rank_match else len(items) + 1,
            }
        )
    return items


def _snapshot_payload(items: list[dict[str, Any]], universe_count: int, source: str) -> dict[str, Any]:
    ranked_source = [item for item in items if item]
    ranking_source = [_market_quality_overlay(item) for item in ranked_source]
    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": source,
        "provider": "JPX listed issue master + yfinance daily prices",
        "universeCount": universe_count,
        "analyzedCount": len(ranked_source),
        "items": ranked_source,
        "rankings": {
            "surge": _rank_market_items(ranking_source, "surge")[:MARKET_RANKING_LIMIT],
            "gainers": _rank_market_items(ranking_source, "gainers")[:MARKET_RANKING_LIMIT],
            "breakout": _rank_market_items(ranking_source, "breakout")[:MARKET_RANKING_LIMIT],
            "popular": _rank_market_items(ranking_source, "popular")[:MARKET_RANKING_LIMIT],
            "volume": _rank_market_items(ranking_source, "volume")[:MARKET_RANKING_LIMIT],
            "quality": _rank_market_items(ranking_source, "quality")[:MARKET_RANKING_LIMIT],
            "overheat": _rank_market_items(ranking_source, "overheat")[:MARKET_RANKING_LIMIT],
        },
    }


def _save_market_snapshot(payload: dict[str, Any]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        MARKET_SNAPSHOT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _load_market_snapshot() -> dict[str, Any] | None:
    try:
        if not MARKET_SNAPSHOT_PATH.exists():
            return None
        payload = json.loads(MARKET_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None
        return {
            **payload,
            **_data_source_flags("cache", cached=True),
        }
    except Exception:
        return None


def _market_snapshot_items(snapshot: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not snapshot:
        return []
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for item in snapshot.get("items") or []:
        ticker = item.get("ticker")
        if ticker and ticker not in seen:
            seen.add(ticker)
            items.append({**item, **_data_source_flags(item.get("priceSource") or item.get("source"), item.get("dataQuality"), cached=bool(snapshot.get("isCached") or snapshot.get("is_cached") or snapshot.get("cache")))})
    for ranking in (snapshot.get("rankings") or {}).values():
        for item in ranking:
            ticker = item.get("ticker")
            if ticker and ticker not in seen:
                seen.add(ticker)
                items.append({**item, **_data_source_flags(item.get("priceSource") or item.get("source"), item.get("dataQuality"), cached=bool(snapshot.get("isCached") or snapshot.get("is_cached") or snapshot.get("cache")))})
    return items


def _market_search_item(ticker: str, info: dict[str, Any], market_item: dict[str, Any] | None = None) -> dict[str, Any]:
    market_item = market_item or {}
    links = market_item.get("externalLinks") or external_research_links(ticker, info.get("name") or market_item.get("name") or ticker)
    source_flags = _data_source_flags(market_item.get("priceSource") or market_item.get("source"), market_item.get("dataQuality"), cached=bool(market_item.get("isCached") or market_item.get("is_cached") or market_item.get("cache")))
    return {
        "ticker": ticker,
        "name": info.get("name") or market_item.get("name") or ticker,
        "marketSection": info.get("market_section") or market_item.get("marketSection", ""),
        "sector": info.get("sector") or market_item.get("sector", ""),
        "price": market_item.get("price"),
        "changePct": market_item.get("changePct"),
        "volume": market_item.get("volume"),
        "candidateScore": market_item.get("candidateScore"),
        "latestBarDate": market_item.get("latestBarDate"),
        "latestBarAgeDays": market_item.get("latestBarAgeDays"),
        "priceAsOfDate": market_item.get("priceAsOfDate"),
        "priceSource": market_item.get("priceSource"),
        "sourceFetchedAt": market_item.get("sourceFetchedAt"),
        "sourceFetchedDate": market_item.get("sourceFetchedDate"),
        "source": market_item.get("source", "JPX_MASTER"),
        **source_flags,
        "externalLinks": links,
    }


def _hydrate_market_search_prices(
    entries: list[tuple[str, dict[str, Any]]],
    snapshot_items: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    missing = [
        ticker
        for ticker, _ in entries
        if not snapshot_items.get(ticker, {}).get("price")
    ][:MARKET_SEARCH_LIVE_PRICE_LIMIT]
    if missing:
        try:
            downloaded = yf.download(
                missing,
                period="1mo",
                interval="1d",
                group_by="ticker",
                threads=True,
                progress=False,
                timeout=10,
            )
        except Exception:
            downloaded = None
        info_by_ticker = dict(entries)
        for ticker in missing:
            live_item = _market_item_from_history(ticker, info_by_ticker[ticker], _history_from_download(downloaded, ticker))
            if live_item is None:
                live_item = _market_item_from_history(ticker, info_by_ticker[ticker], _history_from_stooq(ticker))
            if live_item is None:
                live_item = _market_item_from_history(ticker, info_by_ticker[ticker], _history_from_yahoo_chart(ticker))
            if live_item is not None:
                snapshot_items[ticker] = live_item
    return [
        _market_search_item(ticker, info, snapshot_items.get(ticker))
        for ticker, info in entries
    ]


def _market_item_from_stock_payload(stock: dict[str, Any]) -> dict[str, Any]:
    quality = stock.get("candidateQuality") or {}
    metrics = quality.get("metrics") or {}
    data_quality = stock.get("dataQuality") or quality.get("dataQuality")
    source_flags = _data_source_flags(stock.get("priceSource") or stock.get("source"), data_quality, cached=bool(stock.get("isCached") or stock.get("is_cached") or stock.get("cache")))
    change_pct = _finite(stock.get("changePct", metrics.get("momentum5", 0)))
    candidate_score = _finite(stock.get("candidateScore", 0))
    fallback_overheat = 65 if change_pct >= 12 and candidate_score < 45 else 20 if change_pct >= 5 else 5
    overheat_risk = _finite(stock.get("overheatRisk", fallback_overheat))
    fallback_surge = round(max(0, min(100, candidate_score + max(change_pct, 0) * 2 - overheat_risk * 0.25)), 1)
    surge_score = _finite(stock.get("surgeScore", fallback_surge))
    return {
        "ticker": stock.get("ticker"),
        "name": stock.get("name"),
        "marketSection": stock.get("marketSection", ""),
        "sector": stock.get("sector", ""),
        "price": stock.get("price", 0),
        "changeJpy": 0,
        "changePct": change_pct,
        "volume": _finite(stock.get("volume", 0)),
        "turnoverJpy": _finite(stock.get("turnoverJpy", 0)),
        "volumeRatio": _finite(stock.get("volumeRatio", metrics.get("volumeRatio", 0))),
        "momentum5Pct": metrics.get("momentum5", 0),
        "momentum20Pct": metrics.get("momentum20", 0),
        "candidateScore": candidate_score,
        "preopenScore": stock.get("preopenScore"),
        "popularityScore": _finite(stock.get("popularityScore", candidate_score)),
        "surgeScore": surge_score,
        "surgeStage": "短期モメンタム",
        "surgeFlags": ["日次価格モメンタム"],
        "overheatRisk": overheat_risk,
        "divergence25Pct": 0,
        "divergence75Pct": 0,
        "high20Breakout": bool(stock.get("high20Breakout", False)),
        "ytdHighBreakout": bool(stock.get("ytdHighBreakout", False)),
        "goldenCross": False,
        "trendOk": True,
        "liquidityOk": True,
        "rrRatio": stock.get("rrRatio"),
        "latestBarDate": None,
        "dataQuality": data_quality,
        "source": "watchlist_live_payload",
        **source_flags,
        "reason": stock.get("candidateReason", "Market ranking candidate"),
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
            **watch_candidate(item["score"], item.get("reason", "AI screening candidate"), rank=rank),
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


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    return value


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


def _empty_next_day_backtest(match_quality: str = "insufficient") -> dict[str, Any]:
    evidence = _backtest_evidence_strength(0, match_quality)
    return {
        "sampleCount": 0,
        "winRate": 0,
        "avgNextDayReturnPct": 0,
        "medianNextDayReturnPct": 0,
        "avgWinPct": 0,
        "avgLossPct": 0,
        "profitFactor": 0,
        "avgAdversePct": 0,
        "riskAdjustedReturnPct": 0,
        "expectancyScore": 0,
        "matchQuality": match_quality,
        "evidenceStrength": evidence,
    }


def _backtest_evidence_strength(sample_count: int, match_quality: str) -> dict[str, Any]:
    quality_bonus = {"similar": 25, "broad": 5, "insufficient": -20}.get(match_quality, 0)
    score = max(0, min(100, sample_count * 9 + quality_bonus))
    if score >= 75:
        grade = "strong"
        label = "検証根拠: 強"
    elif score >= 50:
        grade = "moderate"
        label = "検証根拠: 中"
    elif score >= 25:
        grade = "weak"
        label = "検証根拠: 弱"
    else:
        grade = "insufficient"
        label = "検証根拠: 不足"
    return {
        "score": round(score, 1),
        "grade": grade,
        "label": label,
        "sampleCount": sample_count,
        "matchQuality": match_quality,
    }


def estimate_next_day_backtest(
    prices: list[float],
    volumes: list[float],
    highs: list[float] | None = None,
    lows: list[float] | None = None,
) -> dict[str, Any]:
    if len(prices) < 35:
        return _empty_next_day_backtest()
    current = prices[-1]
    current_mom5 = (current / prices[-6] - 1) * 100 if len(prices) >= 6 and prices[-6] else 0
    current_mom20 = (current / prices[-21] - 1) * 100 if len(prices) >= 21 and prices[-21] else 0
    current_rsi = _calc_rsi_window(prices)
    current_avg_vol20 = float(np.mean(volumes[-21:-1])) if len(volumes) >= 21 else 0
    current_vol_ratio = volumes[-1] / current_avg_vol20 if current_avg_vol20 else 0

    similar_returns: list[float] = []
    similar_adverse: list[float] = []
    broad_returns: list[float] = []
    broad_adverse: list[float] = []
    lows = lows or prices

    for index in range(21, len(prices) - 1):
        prior = prices[: index + 1]
        if prior[-6] <= 0 or prior[-21] <= 0:
            continue
        mom5 = (prior[-1] / prior[-6] - 1) * 100
        mom20 = (prior[-1] / prior[-21] - 1) * 100
        rsi = _calc_rsi_window(prior)
        avg_vol20 = float(np.mean(volumes[index - 20:index])) if len(volumes) > index and index >= 20 else 0
        volume_ratio = volumes[index] / avg_vol20 if avg_vol20 else 0
        next_return = (prices[index + 1] / prices[index] - 1) * 100
        next_adverse = ((lows[index + 1] if len(lows) > index + 1 else prices[index + 1]) / prices[index] - 1) * 100
        broad_match = mom5 > 0.8 and mom20 > 3.0 and 45 <= rsi <= 78
        similar_match = (
            broad_match
            and abs(mom5 - current_mom5) <= max(2.5, abs(current_mom5) * 0.75)
            and abs(mom20 - current_mom20) <= max(5.0, abs(current_mom20) * 0.65)
            and abs(rsi - current_rsi) <= 14
            and (
                current_vol_ratio < 1.2
                or volume_ratio >= 1.0
                or abs(volume_ratio - current_vol_ratio) <= max(0.8, current_vol_ratio * 0.8)
            )
        )
        if broad_match:
            broad_returns.append(next_return)
            broad_adverse.append(next_adverse)
        if similar_match:
            similar_returns.append(next_return)
            similar_adverse.append(next_adverse)

    returns = similar_returns if len(similar_returns) >= 3 else broad_returns
    adverse = similar_adverse if len(similar_returns) >= 3 else broad_adverse
    match_quality = "similar" if len(similar_returns) >= 3 else "broad" if returns else "insufficient"
    if not returns:
        return _empty_next_day_backtest(match_quality)
    wins = [value for value in returns if value > 0]
    losses = [value for value in returns if value <= 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    avg_return = float(np.mean(returns))
    avg_adverse = float(np.mean(adverse)) if adverse else 0.0
    risk_adjusted = avg_return - max(0.0, abs(min(avg_adverse, 0.0)) * 0.35)
    profit_factor = gross_profit / gross_loss if gross_loss else (gross_profit if gross_profit else 0)
    evidence = _backtest_evidence_strength(len(returns), match_quality)
    return {
        "sampleCount": len(returns),
        "winRate": round(sum(1 for value in returns if value > 0) / len(returns) * 100, 1),
        "avgNextDayReturnPct": round(avg_return, 2),
        "medianNextDayReturnPct": round(float(np.median(returns)), 2),
        "avgWinPct": round(float(np.mean(wins)), 2) if wins else 0,
        "avgLossPct": round(float(np.mean(losses)), 2) if losses else 0,
        "profitFactor": round(profit_factor, 2),
        "avgAdversePct": round(avg_adverse, 2),
        "riskAdjustedReturnPct": round(risk_adjusted, 2),
        "expectancyScore": round(max(0, min(100, 50 + risk_adjusted * 8 + (profit_factor - 1) * 12)), 1),
        "matchQuality": match_quality,
        "evidenceStrength": evidence,
    }


def build_candidate_quality(
    prices: list[float],
    highs: list[float],
    lows: list[float],
    volumes: list[float],
    rr: dict[str, Any] | None = None,
    vcp_ok: bool = False,
    accum_ok: bool = False,
    data_quality: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current = prices[-1] if prices else 0
    mom5 = (current / prices[-6] - 1) * 100 if len(prices) >= 6 and prices[-6] else 0
    mom20 = (current / prices[-21] - 1) * 100 if len(prices) >= 21 and prices[-21] else 0
    rsi = _calc_rsi_window(prices)
    avg_vol20 = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else 0
    vol_ratio = (volumes[-1] / avg_vol20) if avg_vol20 else 0
    rr = rr or calculate_risk_reward(current, highs, lows, prices)
    backtest = estimate_next_day_backtest(prices, volumes, highs=highs, lows=lows)

    evidence_strength = backtest.get("evidenceStrength") or _backtest_evidence_strength(
        int(_finite(backtest.get("sampleCount"))),
        str(backtest.get("matchQuality") or "insufficient"),
    )
    evidence_ok = evidence_strength.get("grade") in {"strong", "moderate"}
    data_quality_ok = _candidate_data_quality_ok(data_quality)
    gates = [
        {"id": "momentum", "label": "5日・20日モメンタム", "passed": mom5 > 0 and mom20 > 0, "ok": mom5 > 0 and mom20 > 0},
        {"id": "rsi", "label": "RSIが取引可能域", "passed": 40 <= rsi <= 78, "ok": 40 <= rsi <= 78},
        {"id": "liquidity", "label": "流動性が十分", "passed": vol_ratio >= 0.8, "ok": vol_ratio >= 0.8},
        {"id": "rr", "label": "損益比が基準内", "passed": _finite(rr.get("rr_ratio")) >= 1.6, "ok": _finite(rr.get("rr_ratio")) >= 1.6},
        {
            "id": "backtest",
            "label": "バックテスト優位性",
            "passed": bool(
                backtest["sampleCount"] >= 3
                and backtest["winRate"] >= 52
                and backtest["riskAdjustedReturnPct"] > 0
                and backtest["profitFactor"] >= 1.05
            ),
            "ok": bool(
                backtest["sampleCount"] >= 3
                and backtest["winRate"] >= 52
                and backtest["riskAdjustedReturnPct"] > 0
                and backtest["profitFactor"] >= 1.05
            ),
        },
        {"id": "evidence_strength", "label": evidence_strength["label"], "passed": evidence_ok, "ok": evidence_ok},
    ]
    if data_quality:
        gates.append(
            {
                "id": "data_quality",
                "label": data_quality["label"],
                "passed": data_quality_ok,
                "ok": data_quality_ok,
            }
        )
    if vcp_ok:
        gates.append({"id": "vcp", "label": "VCP構造", "passed": True, "ok": True})
    if accum_ok:
        gates.append({"id": "accumulation", "label": "買い集めパターン", "passed": True, "ok": True})

    score = 45
    score += min(max(mom5, -4) * 2.2, 16)
    score += min(max(mom20, -8) * 1.15, 20)
    score += max(0, 12 - abs(rsi - 62) * 0.45)
    score += min(vol_ratio * 4, 8)
    score += min(_finite(rr.get("rr_ratio")) * 4, 12)
    if backtest["sampleCount"]:
        score += (backtest["winRate"] - 50) * 0.25 + backtest["riskAdjustedReturnPct"] * 4.0 + (backtest["profitFactor"] - 1) * 3.0
    if evidence_strength["grade"] == "weak":
        score -= 4
    elif evidence_strength["grade"] == "insufficient":
        score -= 8
    if vcp_ok:
        score += 4
    if accum_ok:
        score += 4
    if data_quality:
        if not data_quality.get("sourceOk"):
            score = min(score, 55)
        elif not data_quality.get("priceOk"):
            score = min(score, 64)
        elif not data_quality.get("historyDepthOk"):
            score = min(score, 64)
        elif _finite(data_quality.get("score")) < 65:
            score = min(score, 70)

    warnings = []
    if rsi > 78:
        warnings.append("RSIが高いため、高値追いを避けてください。")
    if vol_ratio < 0.8:
        warnings.append("出来高の裏付けが弱いため、判断前に流動性を確認してください。")
    if _finite(rr.get("rr_ratio")) < 1.6:
        warnings.append("損益比が推奨基準を下回っています。")
    if backtest["sampleCount"] >= 3 and backtest["riskAdjustedReturnPct"] <= 0:
        warnings.append("\u985e\u4f3c\u30d1\u30bf\u30fc\u30f3\u306e\u7fcc\u65e5\u671f\u5f85\u5024\u304c\u5f31\u3044\u3067\u3059\u3002")
    if evidence_strength["grade"] in {"weak", "insufficient"}:
        warnings.append(f"{evidence_strength['label']}: 判断に使う根拠が十分ではありません。")
    if data_quality and not data_quality_ok:
        warnings.append(
            f"{data_quality['label']}: 出所={data_quality.get('source')}、"
            f"最新日={data_quality.get('latestBarDate') or '-'}、経過日数={data_quality.get('latestBarAgeDays')}"
        )

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
        "qualityReliability": evidence_strength,
        "dataQuality": data_quality,
        "gates": gates,
        "warnings": warnings,
    }


def quality_for_ticker(ticker: str) -> dict[str, Any] | None:
    hist = get_stock_data(ticker, period="1y", interval="1d")
    if hist is None or hist.empty or len(hist) < 30:
        return None
    prices = hist["Close"].tolist()
    highs = hist["High"].tolist()
    lows = hist["Low"].tolist()
    volumes = hist["Volume"].tolist()
    rr = calculate_risk_reward(prices[-1], highs, lows, prices)
    data_quality = _candidate_data_quality(hist, prices, volumes)
    return build_candidate_quality(prices, highs, lows, volumes, rr=rr, data_quality=data_quality)


def preopen_for_ticker(
    ticker: str,
    info: dict[str, Any] | None = None,
    hist: pd.DataFrame | None = None,
    optional_feeds: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
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
            optional_feeds=optional_feeds,
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


def _stooq_symbol(ticker: str) -> str | None:
    normalized = normalize_portfolio_ticker(ticker)
    code = normalized.replace(".T", "")
    if code.isdigit() and len(code) in {4, 5}:
        return f"{code}.jp"
    return None


def _history_from_stooq(ticker: str) -> pd.DataFrame | None:
    if not STOOQ_API_KEY:
        return None
    symbol = _stooq_symbol(ticker)
    if not symbol:
        return None
    try:
        response = requests.get(
            "https://stooq.com/q/d/l/",
            params={"s": symbol, "i": "d", "apikey": STOOQ_API_KEY},
            timeout=8,
        )
        response.raise_for_status()
    except Exception:
        return None
    text = response.text.strip()
    if not text or "Get your apikey" in text or "Date,Open,High,Low,Close,Volume" not in text.splitlines()[0]:
        return None
    try:
        frame = pd.read_csv(io.StringIO(text))
        frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
        frame = frame.dropna(subset=["Date", "Close"]).set_index("Date")
        frame = frame[["Open", "High", "Low", "Close", "Volume"]].apply(pd.to_numeric, errors="coerce")
        frame = clean_price_history(frame)
    except Exception:
        return None
    if frame is None or frame.empty:
        return None
    frame.attrs["source"] = "stooq_free_api"
    frame.attrs["synthetic"] = False
    return frame


def get_stock_data(ticker: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame | None:
    cache_key = (ticker, period, interval)

    while True:
        now = time.monotonic()
        with PRICE_HISTORY_CACHE_LOCK:
            cached = PRICE_HISTORY_CACHE.get(cache_key)
            if cached and now - float(cached.get("cachedAt") or 0) <= PRICE_HISTORY_CACHE_TTL_SEC:
                frame = cached.get("frame")
                return frame.copy(deep=True) if frame is not None else None

            in_flight = PRICE_HISTORY_INFLIGHT.get(cache_key)
            if in_flight is None:
                in_flight = threading.Event()
                PRICE_HISTORY_INFLIGHT[cache_key] = in_flight
                is_owner = True
            else:
                is_owner = False

        if not is_owner:
            in_flight.wait()
            continue

        try:
            frame = fetch_price_history(
                ticker=ticker,
                period=period,
                interval=interval,
                yfinance_history=lambda symbol, request_period, request_interval: yf.Ticker(symbol).history(
                    period=request_period,
                    interval=request_interval,
                    timeout=6,
                    auto_adjust=False,
                ),
                yahoo_chart_history=_history_from_yahoo_chart,
                stooq_history=_history_from_stooq,
                synthetic_history=_synthetic_history,
                clean_price_history=clean_price_history,
            )
        except BaseException:
            with PRICE_HISTORY_CACHE_LOCK:
                PRICE_HISTORY_INFLIGHT.pop(cache_key, None)
                in_flight.set()
            raise

        cached_frame = frame.copy(deep=True) if frame is not None else None
        with PRICE_HISTORY_CACHE_LOCK:
            PRICE_HISTORY_CACHE[cache_key] = {"cachedAt": time.monotonic(), "frame": cached_frame}
            PRICE_HISTORY_INFLIGHT.pop(cache_key, None)
            in_flight.set()
        return frame.copy(deep=True) if frame is not None else None


def normalize_portfolio_ticker(value: Any) -> str:
    ticker = str(value or "").strip().upper().replace(" ", "")
    if not ticker:
        return ""
    if ticker.endswith(".T"):
        return ticker
    if ticker.isdigit() and len(ticker) in {4, 5}:
        return f"{ticker[:4]}.T"
    return ticker


def validate_market_ticker(value: Any) -> str:
    ticker = normalize_portfolio_ticker(value)
    if not ticker or not MARKET_TICKER_PATTERN.fullmatch(ticker):
        raise HTTPException(status_code=400, detail="invalid ticker")
    return ticker


def external_research_links(ticker: str, company_name: str = "") -> list[dict[str, str]]:
    return build_external_research_links(
        ticker,
        company_name,
        normalize_ticker=normalize_portfolio_ticker,
        tdnet_code_url_template=TDNET_CODE_RSS_URL_TEMPLATE,
    )


def _parse_material_datetime(value: Any) -> str | None:
    return service_parse_material_datetime(value)


def _material_age_days(published_at: str | None) -> int | None:
    return service_material_age_days(published_at)


def _tdnet_recent_items(ticker: str, company_name: str = "", limit: int = 6) -> list[dict[str, Any]]:
    return service_tdnet_recent_items(
        ticker,
        company_name,
        normalize_ticker=normalize_portfolio_ticker,
        http_get=requests.get,
        tdnet_recent_rss_url=TDNET_RECENT_RSS_URL,
        tdnet_code_url_template=TDNET_CODE_RSS_URL_TEMPLATE,
        limit=limit,
    )


def _statement_material_item(packet: dict[str, Any] | None) -> dict[str, Any] | None:
    return service_statement_material_item(packet)


def material_events_for_ticker(ticker: str, company_name: str = "", *, include_jquants: bool = False) -> dict[str, Any]:
    research_packet = jquants_bridge.research_packet if include_jquants and jquants_bridge is not None else None
    return build_material_events_for_ticker(
        ticker,
        company_name,
        include_jquants=include_jquants,
        normalize_ticker=normalize_portfolio_ticker,
        yahoo_news_provider=lambda symbol: yf.Ticker(symbol).news or [],
        http_get=requests.get,
        tdnet_recent_rss_url=TDNET_RECENT_RSS_URL,
        tdnet_code_url_template=TDNET_CODE_RSS_URL_TEMPLATE,
        research_packet=research_packet,
    )


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
        "日経平均とTOPIXがともに弱いため、撤退基準を厳格にし、安易な買い増しを避けてください。"
        if risk_off
        else "日経平均とTOPIXがともに支えとなっています。損切り基準を維持しながら、含み益銘柄は追随管理できます。"
        if risk_on
        else "市場全体の方向感が混在しています。銘柄固有のトレンドと撤退ラインを優先してください。"
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
        label = "リスク撤退検討"
        timing = "価格がリスク管理基準を下回ったため、撤退を検討します。"
        review_price = _round_review_price(current_price * 0.995)
        sell_review_shares = shares
        hold_allowed = False
    elif pnl_pct >= 8 and (current_price >= first_target * 0.985 or rsi >= 74 or market_context.get("riskOff")):
        action = "SCALE_OUT"
        label = "一部利確検討"
        timing = "含み益または市場リスクを踏まえ、一部利確を検討します。"
        review_price = _round_review_price(max(current_price * 0.998, first_target))
    elif pnl_pct >= 14 or rsi >= 80:
        action = "TAKE_PROFIT"
        label = "利確検討"
        timing = "上昇が進んだため、利確を検討します。"
        review_price = _round_review_price(current_price * 0.998)
        sell_review_shares = shares
    elif pnl_pct > 0 and current_price <= protective_stop:
        action = "TRAIL_STOP_HIT"
        label = "追随型損切り到達"
        timing = "保護用の損切り水準に到達したため、撤退を検討します。"
        review_price = _round_review_price(current_price * 0.995)
        sell_review_shares = shares
        hold_allowed = False
    elif mom20 > 3 and (not sma25 or current_price > sma25) and 45 <= rsi <= 76 and not market_context.get("riskOff"):
        action = "HOLD_RIDE_TREND"
        label = "\u4fdd\u6709\u7d99\u7d9a"
        timing = "トレンドが維持される間は保有し、目標価格付近で見直します。"
        review_price = _round_review_price(first_target)
    else:
        action = "HOLD_WITH_STOP"
        label = "\u4fdd\u6709\u7d99\u7d9a"
        timing = "損切り基準を守って保有し、目標価格で見直します。"
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
            {"label": "5\u65e5\u77ed\u671f\u30c8\u30ec\u30f3\u30c9", "value": round(mom5, 2), "unit": "%"},
            {"label": "20日モメンタム", "value": round(mom20, 2), "unit": "%"},
            {"label": "RSI", "value": round(rsi, 1), "unit": ""},
            {"label": "ATR", "value": round(atr, 1), "unit": "円"},
            {"label": "損益率", "value": round(pnl_pct, 2), "unit": "%"},
            {"label": "25日移動平均", "value": round(sma25 or 0, 1), "unit": "円"},
        ],
        "rules": [
            "含み益が8%以上、またはRSIが高い場合は一部利確を検討します。",
            "モメンタム低下や損切り水準割れでは撤退を検討します。",
            "25日移動平均と追随型損切りをリスク管理に使用します。",
            "市場がリスク回避局面の場合は、保有継続の信頼度を下げます。",
        ],
        "disclaimer": "シミュレーション専用の撤退計画です。証券会社へ注文は送信されません。",
    }

def build_history_context(hist: pd.DataFrame | None, material: dict[str, Any] | None = None) -> dict[str, Any]:
    material = material or {}
    news_payload = {
        "count": len(material.get("items") or []),
        "items": material.get("items") or [],
        "latestPublishedAt": material.get("latestPublishedAt"),
        "tone": material.get("tone", "unconfirmed"),
        "summary": material.get("summary"),
        "sources": material.get("sources", []),
        "officialNote": material.get("officialNote"),
    }
    news_freshness = {
        "newsOk": bool(material.get("hasRecentImportant")) and not bool(material.get("hasNegative")),
        "latestNewsAgeDays": material.get("latestAgeDays"),
        "materialTone": material.get("tone", "unconfirmed"),
    }
    frame = clean_price_history(hist)
    if frame is None or frame.empty:
        return {
            "source": "unavailable",
            "latestBarDate": None,
            "latestBarAgeDays": None,
            "changePct": 0,
            "recentWindow": {},
            "freshness": {"priceOk": False, **news_freshness},
            "news": news_payload,
            "material": material,
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
    latest_age_days = _latest_bar_age_days(latest_bar_date) if latest_date else None

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
            **news_freshness,
        },
        "news": news_payload,
        "material": material,
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
    def calculate_sma(prices: list[float], period: int) -> float:
        if len(prices) < period:
            return 0
        return sum(prices[-period:]) / period

    @staticmethod
    def calculate_rsi(prices: list[float], period: int = 14) -> float:
        return _calc_rsi_window(prices, period)

    @staticmethod
    def build_execution_plan(raw_signal, confidence, current_price, buy_limit, sell_limit, stop_loss):
        if not current_price or not buy_limit or not stop_loss:
            return {
                "decision": "WATCH",
                "label": "監視継続",
                "headline": "テクニカルデータが不足しています",
                "plainReason": "実行計画を作るための価格データが不足しています。",
                "entryCondition": "有効な価格、損切り、利確目標がそろうまで待ちます。",
                "avoidCondition": "データがそろうまでは判断を見送ります。",
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
            label = "見送り"
            headline = "テクニカルは売り方向"
            plain_reason = "テクニカルが弱いため、新規エントリーは見送ります。"
            entry_condition = "エントリーせず、新しい条件が整うまで待ちます。"
        elif raw_is_buy and confidence >= 68 and -1.5 <= entry_gap_pct <= 0.35:
            decision = "DAYTRADE_ENTRY_OK"
            label = "デイトレ候補を確認"
            headline = "参考指値に近い状態です"
            plain_reason = "勢いと信頼度が一定水準にあり、手入力前の確認候補です。"
            entry_condition = f"手作業で確認後、{buy_limit:,.0f}円付近を参考にします。"
        elif raw_is_buy and entry_gap_pct < -1.5:
            decision = "REPRICE_FOR_DAYTRADE"
            label = "参考指値を再計算"
            headline = "参考指値が現在値から離れています"
            plain_reason = f"現在値との差が {entry_gap_pct:+.2f}% あるため、参考指値の見直しが必要です。"
            entry_condition = "値動きが落ち着いてから参考指値を再計算します。"
        elif raw_is_buy and confidence >= 60:
            decision = "BUY_LIMIT_OK"
            label = "指値候補を確認"
            headline = "指値を前提に確認します"
            plain_reason = "方向性は良好ですが、積極的なエントリーを裏付けるほど強くありません。"
            entry_condition = f"手作業で確認後、{buy_limit:,.0f}円付近の指値を参考にします。"
        else:
            decision = "WATCH"
            label = "監視継続"
            headline = "現時点ではエントリー条件未達"
            plain_reason = "信頼度または現在値との差が基準を満たしていません。"
            entry_condition = "より強い根拠または条件の良い価格を待ちます。"

        return {
            "decision": decision,
            "label": label,
            "headline": headline,
            "plainReason": plain_reason,
            "entryCondition": entry_condition,
            "avoidCondition": f"撤退ライン {stop_loss:,.0f}円を下回る、または流動性が悪化した場合は見送ります。",
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
            return {"signal": "HOLD", "confidence": 30, "reason": "価格履歴が不足しています。", "technicalSummary": "価格履歴が不足しています。", "indicators": {}, "strategy": {}, "execution": cls.build_execution_plan("HOLD", 30, current_price, current_price, current_price, current_price)}
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
            reasons.append("現在値が短期・中期移動平均線を上回っています。")
        if sma75 and current_price > sma75:
            score += 1
            reasons.append("現在値が長期移動平均線を上回っています。")
        if mom5 > 1 and mom20 > 5 and 45 <= rsi <= 75:
            score += 4
            reasons.append(f"モメンタムは強めです: 5日 {mom5:+.2f}%、20日 {mom20:+.2f}%。")
        elif mom5 > 0 and mom20 > 0 and rsi < 78:
            score += 2
            reasons.append(f"モメンタムはやや上向きです: 5日 {mom5:+.2f}%、20日 {mom20:+.2f}%。")
        if rsi > 80:
            score -= 3
            reasons.append("RSIが過熱圏にあるため、判断の確度を下げます。")

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
        no_signal = "明確なテクニカルシグナルは確認できません。"
        return {
            "signal": signal,
            "confidence": round(confidence, 1),
            "reason": " ".join(reasons) if reasons else no_signal,
            "technicalSummary": " / ".join(reasons[:2]) if reasons else no_signal,
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
    ranking_metrics = info.get("ranking_metrics") or {}
    hist = get_stock_data(ticker, period="6mo", interval="1d")
    if hist is None or hist.empty:
        price = 0
        analysis = TechnicalAnalyzer.analyze([], 0)
        quality = None
    else:
        price = _finite(hist["Close"].iloc[-1])
        analysis = TechnicalAnalyzer.analyze(hist["Close"].tolist(), price)
        data_quality = _candidate_data_quality(hist, hist["Close"].tolist(), hist["Volume"].tolist())
        quality = build_candidate_quality(
            hist["Close"].tolist(),
            hist["High"].tolist(),
            hist["Low"].tolist(),
            hist["Volume"].tolist(),
            rr=calculate_risk_reward(price, hist["High"].tolist(), hist["Low"].tolist(), hist["Close"].tolist()),
            data_quality=data_quality,
        )
    source_flags = _data_source_flags(hist.attrs.get("source", "unknown") if hist is not None else "unknown", quality.get("dataQuality") if quality else None)
    preopen_report = preopen_for_ticker(ticker, info, hist if hist is not None and not hist.empty else None)
    live_score = preopen_report["score"] if preopen_report else (quality["qualityScore"] if quality else analysis["confidence"])
    if ranking_metrics and not quality:
        live_score = max(live_score, _finite(ranking_metrics.get("qualityScore", ranking_metrics.get("surgeScore", 0))))
    if quality and not _candidate_data_quality_ok(quality.get("dataQuality")):
        live_score = min(live_score, quality["qualityScore"])
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
        "changePct": _finite(ranking_metrics.get("changePct", analysis["execution"]["entryGapPct"])),
        "surgeScore": _finite(ranking_metrics.get("surgeScore", live_score)),
        "volumeRatio": _finite(ranking_metrics.get("volumeRatio", 0)),
        "volume": int(_finite(ranking_metrics.get("volume", ranking_metrics.get("volumeRatio", 0) * 100000))),
        "turnoverJpy": int(_finite(ranking_metrics.get("turnoverJpy", ranking_metrics.get("volumeRatio", 0) * max(price, 1) * 100000))),
        "popularityScore": _finite(ranking_metrics.get("popularityScore", live_score)),
        "overheatRisk": _finite(ranking_metrics.get("overheatRisk", 0)),
        "high20Breakout": bool(ranking_metrics.get("high20Breakout", False)),
        "ytdHighBreakout": bool(ranking_metrics.get("ytdHighBreakout", False)),
        "surgeFlags": ["20日高値更新"] if ranking_metrics.get("high20Breakout") else [],
        "candidateReason": live_reason,
        "publishedCandidateScore": info.get("candidate_score"),
        "publishedCandidateReason": info.get("candidate_reason"),
        "candidateRank": info.get("candidate_rank"),
        "mustInclude": bool(info.get("must_include")),
        "candidateQuality": quality or ({"qualityScore": _finite(ranking_metrics.get("qualityScore", 0))} if ranking_metrics else None),
        "dataQuality": quality.get("dataQuality") if quality else None,
        **source_flags,
        "externalLinks": external_research_links(ticker, info.get("name", ticker)),
    }


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Zen Stock Prophet Pro", version="1.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_origin_regex=LOCAL_NETWORK_CORS_PATTERN,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def get_health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": app.version,
        "mode": "manual_decision_support",
        "liveOrdersEnabled": LIVE_BROKER_ORDERS_ENABLED,
    }

@app.get("/api/stocks")
def get_stocks() -> list[dict[str, Any]]:
    items = [_stock_payload(ticker, info) for ticker, info in STOCKS.items()]
    sorted_items = sorted(items, key=lambda item: (item.get("candidateRank") or 999, -_finite(item.get("candidateScore"))))
    return _json_safe(sorted_items)


@app.get("/api/market/universe")
def market_universe() -> dict[str, Any]:
    return build_market_universe_response(
        load_market_universe=load_market_universe,
        load_market_snapshot=_load_market_snapshot,
        market_snapshot_items=_market_snapshot_items,
        market_search_item=_market_search_item,
        universe_source=JPX_UNIVERSE_PATH or JPX_LISTED_ISSUES_URL,
    )


@app.get("/api/market/search")
def market_search(
    q: str = Query("", max_length=80),
    market: str = Query("", max_length=80),
    sector: str = Query("", max_length=80),
    limit: int = Query(50, ge=1, le=150),
) -> dict[str, Any]:
    return build_market_search_response(
        query=q,
        market=market,
        sector=sector,
        limit=limit,
        load_market_universe=load_market_universe,
        load_market_snapshot=_load_market_snapshot,
        market_snapshot_items=_market_snapshot_items,
        hydrate_market_search_prices=_hydrate_market_search_prices,
    )


def _get_or_build_market_rankings(
    *,
    kind: str,
    budget: int,
    limit: int,
    build: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    cache_key = f"{kind}:{budget}:{limit}"

    while True:
        now = dt.datetime.now(dt.timezone.utc)
        with MARKET_REVIEW_CACHE_LOCK:
            cached = MARKET_REVIEW_CACHE.get(cache_key)
            if cached:
                cached_at = cached.get("cachedAt")
                age_sec = (
                    (now - cached_at).total_seconds()
                    if isinstance(cached_at, dt.datetime)
                    else MARKET_REVIEW_CACHE_TTL_SEC + 1
                )
                if age_sec <= MARKET_REVIEW_CACHE_TTL_SEC:
                    return cached.get("payload") or {}

            in_flight = MARKET_REVIEW_INFLIGHT.get(cache_key)
            if in_flight is None:
                in_flight = threading.Event()
                MARKET_REVIEW_INFLIGHT[cache_key] = in_flight
                is_owner = True
            else:
                is_owner = False

        if not is_owner:
            in_flight.wait()
            continue

        try:
            payload = build()
        except BaseException:
            with MARKET_REVIEW_CACHE_LOCK:
                MARKET_REVIEW_INFLIGHT.pop(cache_key, None)
                in_flight.set()
            raise

        with MARKET_REVIEW_CACHE_LOCK:
            MARKET_REVIEW_CACHE[cache_key] = {
                "cachedAt": dt.datetime.now(dt.timezone.utc),
                "payload": payload,
            }
            MARKET_REVIEW_INFLIGHT.pop(cache_key, None)
            in_flight.set()
        return payload


@app.get("/api/market/rankings")
def market_rankings(
    kind: str = Query("surge", pattern="^(surge|gainers|breakout|popular|volume|quality|overheat)$"),
    limit: int = Query(30, ge=1, le=100),
    budget: int = Query(DEFAULT_INTRADAY_BUDGET_JPY, ge=100_000, le=10_000_000),
) -> dict[str, Any]:
    return _get_or_build_market_rankings(
        kind=kind,
        budget=budget,
        limit=limit,
        build=lambda: build_market_rankings_response(
            kind=kind,
            limit=limit,
            budget=budget,
            market_status=tokyo_market_status(),
            load_market_snapshot=_load_market_snapshot,
            load_market_universe=load_market_universe,
            market_snapshot_items=_market_snapshot_items,
            market_context_freshness=_market_context_freshness,
            market_context_items_from_snapshot=_market_context_items_from_snapshot,
            market_context_integrity=_market_context_integrity,
            attach_market_master_metadata=_attach_market_master_metadata,
            market_quality_overlay=_market_quality_overlay,
            attach_material_events=_attach_material_events,
            attach_candidate_quality=_attach_candidate_quality,
            attach_market_relative_context=_attach_market_relative_context,
            rank_with_material_refresh=_rank_with_material_refresh,
            attach_advanced_cross_engine_checks=_attach_advanced_cross_engine_checks,
            rank_by_audited_opportunity=_rank_by_audited_opportunity,
            rank_market_items=_rank_market_items,
            select_best_ranked_opportunity=_select_best_ranked_opportunity,
            select_best_available_opportunity=_select_best_available_opportunity,
            yahoo_finance_gainers=_yahoo_finance_gainers,
            data_source_flags=_data_source_flags,
            json_safe=_json_safe,
            fallback_candidate_pool=FALLBACK_CANDIDATE_POOL,
            stocks=STOCKS,
            market_item_from_stock_payload=_market_item_from_stock_payload,
            stock_payload=_stock_payload,
            snapshot_payload=_snapshot_payload,
            yahoo_finance_gainers_url=YAHOO_FINANCE_GAINERS_URL,
        ),
    )


@app.get("/api/ai-fund/desk")
def ai_fund_desk(
    budget: int = Query(DEFAULT_INTRADAY_BUDGET_JPY, ge=100_000, le=10_000_000),
    kind: str = Query("surge", pattern="^(surge|breakout|volume|quality|popular|overheat|gainers)$"),
) -> dict[str, Any]:
    ranked_items, strict_best, _best_available, generated_at = _market_review_candidates_for_budget(budget, kind=kind)
    best_opportunity = strict_best
    portfolio = get_portfolio()
    return _ai_fund_desk_payload(
        best_opportunity=best_opportunity,
        ranked_items=ranked_items[:30],
        portfolio=portfolio,
        generated_at=generated_at,
        budget_jpy=budget,
    )


@app.get("/api/stock/{ticker}")
def get_stock_detail(ticker: str) -> dict[str, Any]:
    ticker = validate_market_ticker(ticker)
    info = STOCKS.get(ticker) or FALLBACK_CANDIDATE_POOL.get(ticker) or {"name": ticker, "emoji": "STK"}
    hist = get_stock_data(ticker, period="1y", interval="1d")
    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail="No stock data")
    price = _finite(hist["Close"].iloc[-1])
    analysis = TechnicalAnalyzer.analyze(hist["Close"].tolist(), price)
    rr = calculate_risk_reward(price, hist["High"].tolist(), hist["Low"].tolist(), hist["Close"].tolist())
    data_quality = _candidate_data_quality(hist, hist["Close"].tolist(), hist["Volume"].tolist())
    quality = build_candidate_quality(
        hist["Close"].tolist(),
        hist["High"].tolist(),
        hist["Low"].tolist(),
        hist["Volume"].tolist(),
        rr=rr,
        data_quality=data_quality,
    )
    material = material_events_for_ticker(ticker, info.get("name", ticker), include_jquants=True)
    preopen_report = preopen_for_ticker(
        ticker,
        info,
        hist,
        optional_feeds={
            "materialAvailable": material.get("materialAvailable"),
            "materialScore": material.get("materialScore"),
        },
    )
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
    history_context = build_history_context(hist, material)
    live_score = preopen_report["score"] if preopen_report else quality["qualityScore"]
    if not _candidate_data_quality_ok(data_quality):
        live_score = min(live_score, quality["qualityScore"])
    market_item = _market_item_from_history(
        ticker,
        info,
        hist,
        data_quality=data_quality,
        quality=quality,
        preopen_report=preopen_report,
    ) or {
        "ticker": ticker,
        "name": info.get("name", ticker),
        "price": round(price, 1),
        "candidateScore": live_score,
        "candidateQuality": quality,
        "dataQuality": data_quality,
        "latestBarDate": _latest_bar_label(hist.index[-1]),
        "latestBarAgeDays": data_quality.get("latestBarAgeDays"),
        "priceAsOfDate": data_quality.get("latestBarDate"),
        "priceSource": hist.attrs.get("source", "yfinance"),
        "source": hist.attrs.get("source", "yfinance"),
        "targetPrice": rr.get("target_price"),
        "stopLoss": rr.get("stop_loss"),
        "rewardPct": rr.get("reward_pct"),
        "riskPct": rr.get("risk_pct"),
    }
    market_item = {
        **market_item,
        "candidateScore": live_score,
        "candidateQuality": quality,
        "dataQuality": data_quality,
        "material": material,
        "analysis": analysis,
    }
    intraday_opportunity = _build_intraday_opportunity(market_item, DEFAULT_INTRADAY_BUDGET_JPY)
    advanced_report_for_cross = None
    if build_advanced_report is not None:
        try:
            advanced_report_for_cross = build_advanced_report(
                ticker,
                hist,
                capital_jpy=INITIAL_CASH,
                risk_pct=1.0,
            )
        except Exception:
            advanced_report_for_cross = None
    cross_engine_check = _cross_engine_consistency(
        ticker=ticker,
        candidate=market_item,
        opportunity=intraday_opportunity,
        advanced_report=advanced_report_for_cross,
    )
    source_flags = _data_source_flags(hist.attrs.get("source", "yfinance"), data_quality)
    return _json_safe({
        "ticker": ticker,
        "name": info.get("name", ticker),
        "price": round(price, 1),
        **source_flags,
        "analysis": analysis,
        "chart": chart,
        "candidateQuality": quality,
        "dataQuality": data_quality,
        "preopenReport": preopen_report,
        "preopenScore": preopen_report["score"] if preopen_report else None,
        "preopenDecision": preopen_report["decisionLabel"] if preopen_report else None,
        "riskFlags": preopen_report["riskFlags"] if preopen_report else [],
        "watchPoints": preopen_report["watchPoints"] if preopen_report else [],
        "candidateScore": live_score,
        "intradayOpportunity": intraday_opportunity,
        "crossEngineCheck": cross_engine_check,
        "advancedReport": advanced_report_for_cross,
        "externalLinks": external_research_links(ticker, info.get("name", ticker)),
        **history_context,
    })


@app.get("/api/preopen/{ticker}")
def get_preopen_analysis(ticker: str) -> dict[str, Any]:
    ticker = validate_market_ticker(ticker)
    info = STOCKS.get(ticker) or FALLBACK_CANDIDATE_POOL.get(ticker) or {"name": ticker, "emoji": "STK"}
    return build_preopen_analysis_response(
        ticker=ticker,
        info=info,
        material_events_for_ticker=material_events_for_ticker,
        preopen_for_ticker=preopen_for_ticker,
    )


@app.get("/api/analysis/advanced/{ticker}")
def get_advanced_analysis(ticker: str) -> dict[str, Any]:
    ticker = validate_market_ticker(ticker)
    return build_advanced_analysis_response(
        ticker=ticker,
        get_stock_data=get_stock_data,
        build_advanced_report=build_advanced_report,
        initial_cash=INITIAL_CASH,
    )


@app.get("/api/portfolio")
def get_portfolio() -> dict[str, Any]:
    return build_portfolio_response(
        init_db=init_db,
        get_db=get_db,
        get_stock_data=get_stock_data,
        candidate_data_quality=_candidate_data_quality,
        data_source_flags=_data_source_flags,
        portfolio_market_context=_portfolio_market_context,
        build_exit_plan=build_exit_plan,
        finite=_finite,
        stocks=STOCKS,
        fallback_candidate_pool=FALLBACK_CANDIDATE_POOL,
        portfolio_active=PORTFOLIO_ACTIVE,
        portfolio_closed_statuses=(PORTFOLIO_SOLD, PORTFOLIO_VOIDED, PORTFOLIO_ARCHIVED),
        initial_cash=INITIAL_CASH,
    )


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
    market_status = tokyo_market_status()
    universe = load_market_universe()
    items = list(universe.items())
    if SCREEN_MAX_UNIVERSE > 0:
        items = items[:SCREEN_MAX_UNIVERSE]

    candidates = []
    market_items = []
    SCREENING_PROGRESS.update({"status": "running", "message": "Analyzing JPX universe.", "progress": 0, "total": len(items)})
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
            market_item = _market_item_from_history(ticker, info, hist)
            if market_item is not None:
                market_items.append(market_item)
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
            "message": "Analyzing JPX universe.",
            "progress": min(start + len(batch), len(items)),
            "total": len(items),
        })

    _publish_watchlist_candidates(candidates)
    snapshot = _snapshot_payload(market_items, len(items), JPX_UNIVERSE_PATH or JPX_LISTED_ISSUES_URL)
    _save_market_snapshot(snapshot)
    top_candidates = sorted(candidates, key=lambda value: value["score"], reverse=True)[:10]
    SCREENING_PROGRESS.update({"status": "completed", "message": "Screening completed.", "progress": len(items), "total": len(items)})
    return {
        "success": True,
        "marketStatus": market_status,
        "selected": list(STOCKS),
        "top_candidates": top_candidates,
        "rankings": {key: value[:10] for key, value in snapshot["rankings"].items()},
        "stats": {
            "analyzed": len(candidates),
            "ranked": len(market_items),
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
    return {"message": "Watchlist alert engine is unavailable.", "alerts": []}


@app.get("/api/research/jquants/status")
def jquants_status() -> dict[str, Any]:
    if jquants_bridge is None:
        return {
            "name": "J-Quants API",
            "configured": False,
            "available": False,
            "mode": "MODULE_UNAVAILABLE",
            "message": "J-Quants connector module is unavailable.",
        }
    status = jquants_bridge.connector_status()
    return {
        **status,
        "available": bool(status.get("configured")),
        "message": (
            "J-Quants API is configured."
            if status.get("configured")
            else "J-Quants API is not configured; using public/free sources."
        ),
    }


@app.get("/api/research/edinet/documents")
def edinet_documents(
    start_date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
) -> dict[str, Any]:
    return fetch_edinet_documents_by_date_range(start_date, end_date)


@app.get("/api/research/earnings-calendar")
def earnings_calendar(
    start_date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
) -> dict[str, Any]:
    return build_earnings_calendar_payload(start_date, end_date)


@app.get("/api/research/jquants/{code}")
def jquants_research(code: str) -> dict[str, Any]:
    if jquants_bridge is None:
        raise HTTPException(status_code=503, detail="J-Quants connector unavailable")
    try:
        return jquants_bridge.research_packet(code)
    except jquants_bridge.JQuantsError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

@app.get("/api/news/{ticker}")
def get_news(ticker: str) -> dict[str, Any]:
    ticker = validate_market_ticker(ticker)
    info = STOCKS.get(ticker) or FALLBACK_CANDIDATE_POOL.get(ticker) or {"name": ticker}
    material = material_events_for_ticker(ticker, info.get("name", ticker), include_jquants=True)
    return {
        "overall_sentiment": material.get("tone", "unconfirmed"),
        "ticker": ticker,
        "items": material.get("items", []),
        "news": material.get("items", []),
        "material": material,
        "externalLinks": external_research_links(ticker, info.get("name", ticker)),
    }


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
    return record_manual_position(
        request,
        normalize_portfolio_ticker=normalize_portfolio_ticker,
        finite=_finite,
        init_db=init_db,
        get_db=get_db,
        initial_cash=INITIAL_CASH,
    )


@app.post("/api/portfolio/positions")
def save_portfolio_position(request: PortfolioPositionRequest) -> dict[str, Any]:
    return _record_manual_position(request)


@app.post("/api/portfolio/positions/{ticker}/lifecycle")
def update_portfolio_position_lifecycle(ticker: str, request: PortfolioLifecycleRequest) -> dict[str, Any]:
    return close_portfolio_position(
        ticker,
        request,
        normalize_portfolio_ticker=normalize_portfolio_ticker,
        finite=_finite,
        init_db=init_db,
        get_db=get_db,
        portfolio_closed_statuses=PORTFOLIO_CLOSED_STATUSES,
        portfolio_active=PORTFOLIO_ACTIVE,
        portfolio_sold=PORTFOLIO_SOLD,
        portfolio_voided=PORTFOLIO_VOIDED,
        portfolio_archived=PORTFOLIO_ARCHIVED,
        initial_cash=INITIAL_CASH,
    )


@app.post("/api/buy")
def buy_stock(request: TradeRequest) -> dict[str, Any]:
    return {"success": False, "message": "証券会社への注文送信は無効です。シミュレーター上の手動確認だけに使ってください。", "mode": "BROKER_DISABLED"}


@app.post("/api/sell")
def sell_stock(request: TradeRequest) -> dict[str, Any]:
    return {"success": False, "message": "証券会社への注文送信は無効です。シミュレーター上の手動確認だけに使ってください。", "mode": "BROKER_DISABLED"}


@app.post("/api/reset")
def reset_portfolio() -> dict[str, Any]:
    init_db()
    conn = get_db()
    conn.execute("UPDATE portfolio SET cash = ?", (INITIAL_CASH,))
    conn.execute("UPDATE holdings SET shares = 0, avg_cost = 0")
    conn.execute("DELETE FROM transactions")
    conn.commit()
    conn.close()
    return {"success": True, "message": "保有台帳をシミュレーター初期状態へ戻しました。"}


@app.post("/api/learn")
def ai_learn() -> dict[str, Any]:
    return {"success": True, "message": "シミュレーター用の学習サイクルを記録しました。"}


@app.get("/api/daytrade/plan")
def get_daytrade_plan() -> dict[str, Any]:
    from daytrade_engine import plan
    return plan()


def _ranking_aligned_daytrade_signal_payload(kind: str = "surge") -> dict[str, Any]:
    from daytrade_engine import BoardSnapshot, build_signal_ticket

    ranked_items, strict_best, _best_available, _generated_at = _market_review_candidates_for_budget(DEFAULT_INTRADAY_BUDGET_JPY, kind=kind, limit=30)
    signal_items = []
    if strict_best:
        signal_items.append({"intradayOpportunity": strict_best, "ticker": strict_best.get("ticker"), "name": strict_best.get("name")})
    for item in ranked_items:
        if len(signal_items) >= 3:
            break
        opportunity = item.get("intradayOpportunity") or {}
        ticker = opportunity.get("ticker") or item.get("ticker")
        if not ticker or any((existing.get("intradayOpportunity") or {}).get("ticker") == ticker for existing in signal_items):
            continue
        if str(opportunity.get("tradeReadiness") or "").lower() != "ready":
            continue
        if str((opportunity.get("decisionAudit") or {}).get("verdict") or "").upper() != "PASS":
            continue
        if not _opportunity_has_actionable_size(opportunity):
            continue
        signal_items.append(item)

    signals = []
    for rank, item in enumerate(signal_items, start=1):
        opportunity = item.get("intradayOpportunity") or item
        ticker = opportunity.get("ticker") or item.get("ticker")
        entry = _finite(opportunity.get("entryPrice") or item.get("price"))
        target = _finite(opportunity.get("targetPrice"))
        stop = _finite(opportunity.get("stopLoss"))
        if not ticker or entry <= 0:
            continue
        spread = max(entry * 0.0008, 0.1)
        best_bid = max(entry, spread)
        best_ask = best_bid + spread
        ml_probability = max(0.5, min(0.78, _finite(opportunity.get("confidencePct")) / 100))
        material = opportunity.get("material") or item.get("material") or {}
        has_news = not bool(material.get("hasNegative"))
        ticket = build_signal_ticket(
            ticker=ticker,
            name=opportunity.get("name") or item.get("name") or ticker,
            gap_pct=_finite(opportunity.get("changePct") or item.get("changePct")),
            board=BoardSnapshot(
                ticker,
                best_bid,
                best_ask,
                90_000 - rank * 5_000,
                48_000,
                0.7,
                entry,
                entry,
            ),
            has_news=has_news,
            atr_pct=max(1.6, abs(_finite(opportunity.get("changePct") or item.get("changePct"))) * 0.45),
            volume_rank=int(_finite(item.get("candidateRank") or item.get("rank") or rank)),
            ml_probability=ml_probability,
            minutes_after_open=3,
            mode="RANKING_ALIGNED_SIGNAL",
        )
        ticket["limitPrice"] = round(entry, 1)
        ticket["takeProfit"] = round(target, 1) if target > 0 else ticket["takeProfit"]
        ticket["stopLoss"] = round(stop, 1) if stop > 0 else ticket["stopLoss"]
        ticket["shares"] = int(_finite(opportunity.get("shares") or ticket.get("shares")))
        ticket["sourceTicker"] = ticker
        ticket["sourceOpportunityPrice"] = round(entry, 1)
        signals.append(ticket)

    if not signals:
        return {
            "source": "NO_VERIFIED_RANKING_SIGNAL",
            "signals": [],
        }
    return {
        "source": "LOCAL_PAPER_SIMULATION_RANKING_ALIGNED",
        "signals": signals,
    }


@app.get("/api/daytrade/signals")
def get_daytrade_signals(kind: str = Query("surge", pattern="^(surge|breakout|volume|quality|popular|overheat|gainers)$")) -> dict[str, Any]:
    return _ranking_aligned_daytrade_signal_payload(kind)


def _daytrade_cache_get(key: str) -> dict[str, Any] | None:
    now = dt.datetime.now(dt.timezone.utc)
    cached = DAYTRADE_CONTEXT_CACHE.get(key)
    if not cached:
        return None
    cached_at = cached.get("cachedAt")
    age_sec = (now - cached_at).total_seconds() if isinstance(cached_at, dt.datetime) else DAYTRADE_CONTEXT_CACHE_TTL_SEC + 1
    if age_sec > DAYTRADE_CONTEXT_CACHE_TTL_SEC:
        return None
    return dict(cached.get("payload") or {})


def _daytrade_cache_set(key: str, payload: dict[str, Any]) -> dict[str, Any]:
    DAYTRADE_CONTEXT_CACHE[key] = {"cachedAt": dt.datetime.now(dt.timezone.utc), "payload": payload}
    return payload


def _safe_float(value: Any, default: float = 0.0) -> float:
    return service_safe_float(value, default)


def _parse_event_timestamp(value: Any) -> dt.datetime | None:
    return service_parse_event_timestamp(value)


def _news_item_from_yfinance(raw: dict[str, Any]) -> dict[str, Any] | None:
    return service_news_item_from_yfinance(
        raw,
        positive_keywords=MATERIAL_POSITIVE_KEYWORDS,
        negative_keywords=MATERIAL_NEGATIVE_KEYWORDS,
        important_keywords=MATERIAL_IMPORTANT_KEYWORDS,
    )


def _fetch_daytrade_quote_context(ticker: str) -> dict[str, Any]:
    cache_key = f"quote:{ticker}"
    cached = _daytrade_cache_get(cache_key)
    if cached is not None:
        return cached
    payload = build_daytrade_quote_context(ticker, symbol_provider=yf.Ticker)
    return _daytrade_cache_set(cache_key, payload)


def _fetch_daytrade_event_context(ticker: str) -> dict[str, Any]:
    cache_key = f"events:{ticker}"
    cached = _daytrade_cache_get(cache_key)
    if cached is not None:
        return cached
    payload = build_daytrade_event_context(
        ticker,
        symbol_provider=yf.Ticker,
        positive_keywords=MATERIAL_POSITIVE_KEYWORDS,
        negative_keywords=MATERIAL_NEGATIVE_KEYWORDS,
        important_keywords=MATERIAL_IMPORTANT_KEYWORDS,
    )
    return _daytrade_cache_set(cache_key, payload)


def _fetch_daytrade_contexts(ticker: str, timeout_sec: float | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch optional quote/news context without blocking the core analysis path."""
    timeout = max(0.01, float(timeout_sec or DAYTRADE_CONTEXT_TIMEOUT_SEC))
    futures = {
        "quote": DAYTRADE_CONTEXT_EXECUTOR.submit(_fetch_daytrade_quote_context, ticker),
        "events": DAYTRADE_CONTEXT_EXECUTOR.submit(_fetch_daytrade_event_context, ticker),
    }
    deadline = time.monotonic() + timeout
    results: dict[str, dict[str, Any]] = {}
    fallbacks = {
        "quote": {"source": "UNAVAILABLE", "bid": None, "ask": None, "quoteAgeSec": 999, "errorCode": "OPTIONAL_CONTEXT_TIMEOUT"},
        "events": {
            "source": "UNAVAILABLE",
            "tone": "unknown",
            "hasRecentMaterial": False,
            "hasUpcomingEarnings": False,
            "items": [],
            "errorCode": "OPTIONAL_CONTEXT_TIMEOUT",
        },
    }
    for key, future in futures.items():
        remaining = max(0.01, deadline - time.monotonic())
        try:
            results[key] = future.result(timeout=remaining)
        except FutureTimeoutError:
            results[key] = fallbacks[key]
        except Exception as exc:
            results[key] = {**fallbacks[key], "errorCode": "OPTIONAL_CONTEXT_FAILED", "error": str(exc)[:160]}
    return results["quote"], results["events"]


@app.get("/api/daytrade/analysis/{ticker}")
def get_daytrade_analysis(ticker: str, interval: str = Query("5m", pattern="^(1m|5m|15m|1d)$")) -> dict[str, Any]:
    ticker = validate_market_ticker(ticker)
    if build_daytrade_analysis is None:
        raise HTTPException(status_code=503, detail="Daytrade analysis engine unavailable")
    cache_key = (ticker, interval)
    while True:
        now = dt.datetime.now(dt.timezone.utc)
        with DAYTRADE_ANALYSIS_CACHE_LOCK:
            cached = DAYTRADE_ANALYSIS_CACHE.get(cache_key)
            if cached:
                cached_at = cached.get("cachedAt")
                age_sec = (now - cached_at).total_seconds() if isinstance(cached_at, dt.datetime) else DAYTRADE_ANALYSIS_CACHE_TTL_SEC + 1
                if age_sec <= DAYTRADE_ANALYSIS_CACHE_TTL_SEC:
                    return {
                        **cached["payload"],
                        "cacheStatus": "HIT",
                        "cacheAgeSec": round(max(0, age_sec), 1),
                        "cacheTtlSec": DAYTRADE_ANALYSIS_CACHE_TTL_SEC,
                    }
            in_flight = DAYTRADE_ANALYSIS_INFLIGHT.get(cache_key)
            if in_flight is None:
                in_flight = threading.Event()
                DAYTRADE_ANALYSIS_INFLIGHT[cache_key] = in_flight
                is_owner = True
            else:
                is_owner = False
        if is_owner:
            break
        in_flight.wait()
    try:
        period = INTERVAL_PERIODS.get(interval, "60d")
        hist = get_stock_data(ticker, period=period, interval=interval)
        if hist is None or hist.empty:
            raise HTTPException(status_code=404, detail=f"No {interval} history for {ticker}")
        quote_context, event_context = _fetch_daytrade_contexts(ticker)
        payload = build_daytrade_analysis(ticker, hist, interval=interval, quote_context=quote_context, event_context=event_context)
        with DAYTRADE_ANALYSIS_CACHE_LOCK:
            DAYTRADE_ANALYSIS_CACHE[cache_key] = {"cachedAt": dt.datetime.now(dt.timezone.utc), "payload": payload}
            DAYTRADE_ANALYSIS_INFLIGHT.pop(cache_key, None)
            in_flight.set()
        return {
            **payload,
            "cacheStatus": "MISS",
            "cacheAgeSec": 0,
            "cacheTtlSec": DAYTRADE_ANALYSIS_CACHE_TTL_SEC,
        }
    except HTTPException:
        with DAYTRADE_ANALYSIS_CACHE_LOCK:
            DAYTRADE_ANALYSIS_INFLIGHT.pop(cache_key, None)
            in_flight.set()
        raise
    except ValueError as exc:
        with DAYTRADE_ANALYSIS_CACHE_LOCK:
            DAYTRADE_ANALYSIS_INFLIGHT.pop(cache_key, None)
            in_flight.set()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        with DAYTRADE_ANALYSIS_CACHE_LOCK:
            DAYTRADE_ANALYSIS_INFLIGHT.pop(cache_key, None)
            in_flight.set()
        raise HTTPException(status_code=502, detail=f"Daytrade analysis failed: {exc}") from exc


@app.get("/api/daytrade/routine/{ticker}")
def get_daytrade_routine(ticker: str, interval: str = Query("5m", pattern="^(1m|5m|15m|1d)$")) -> dict[str, Any]:
    if build_commute_daytrade_routine is None:
        raise HTTPException(status_code=503, detail="Daytrade routine planner unavailable")
    analysis = get_daytrade_analysis(ticker, interval=interval)
    try:
        return {
            **build_commute_daytrade_routine(analysis),
            "analysisCacheStatus": analysis.get("cacheStatus"),
            "analysisCacheAgeSec": analysis.get("cacheAgeSec"),
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Daytrade routine failed: {exc}") from exc


@app.post("/api/daytrade/scan")
def scan_daytrade_signals(kind: str = Query("surge", pattern="^(surge|breakout|volume|quality|popular|overheat|gainers)$")) -> dict[str, Any]:
    payload = _ranking_aligned_daytrade_signal_payload(kind)
    return {
        "success": True,
        "source": payload["source"],
        "message": f"Generated {len(payload['signals'])} simulator signals.",
        "signals": payload["signals"],
    }


@app.get("/api/daytrade/broker-status")
def get_daytrade_broker_status() -> dict[str, Any]:
    return {"mode": "BROKER_DISABLED", "workbookExists": False, "workbookOpen": False, "excelComAvailable": False, "csvTemplateReady": False, "message": "証券会社連携は無効です。シミュレーション専用モードです。"}


@app.get("/api/daytrade/signal-log")
def get_daytrade_signal_log() -> list[dict[str, Any]]:
    return []


@app.post("/api/daytrade/autopilot/start")
def start_daytrade_autopilot() -> dict[str, Any]:
    return {"mode": "BROKER_DISABLED", "workbookExists": False, "workbookOpen": False, "excelComAvailable": False, "csvTemplateReady": False, "running": False, "message": "自動運用は無効です。シミュレーション専用モードです。"}


@app.post("/api/daytrade/autopilot/stop")
def stop_daytrade_autopilot() -> dict[str, Any]:
    return {"running": False, "mode": "BROKER_DISABLED"}


@app.get("/api/daytrade/autopilot/status")
def get_daytrade_autopilot_status() -> dict[str, Any]:
    return {"running": False, "mode": "BROKER_DISABLED", "intervalSec": 60}


@app.get("/api/daytrade/risk-state")
def get_daytrade_risk_state() -> dict[str, Any]:
    from daytrade_engine import risk_state
    return _json_safe(risk_state())


FRONTEND_DIST_DIR = ROOT_DIR / "dist"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"

if FRONTEND_ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="frontend-assets")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    """Serve the production SPA without intercepting unknown API routes."""
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
    if not FRONTEND_DIST_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Frontend build is unavailable")

    requested = (FRONTEND_DIST_DIR / full_path).resolve()
    try:
        requested.relative_to(FRONTEND_DIST_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Frontend asset not found") from exc
    if full_path and requested.is_file():
        return FileResponse(requested)
    return FileResponse(FRONTEND_DIST_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=API_HOST, port=API_PORT)
