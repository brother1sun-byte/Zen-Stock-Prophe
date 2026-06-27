"""Read-only earnings calendar helpers for pre-open research checks.

P1.7 keeps J-Quants credentials on the FastAPI side only. The current J-Quants
earnings-calendar endpoint is treated as a V2 x-api-key endpoint; refresh-token
or id-token credentials remain useful for the older V1 research helpers but are
not enough for this endpoint.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any, Callable

import requests

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MANUAL_EARNINGS_PATH = ROOT_DIR / "src" / "data" / "manualEarningsCalendar.json"
DEFAULT_CACHE_EARNINGS_PATH = ROOT_DIR / "backend" / "cache" / "earnings_calendar_cache.json"
JQUANTS_V2_BASE = "https://api.jquants.com/v2"
REQUEST_TIMEOUT_SEC = 8
MAX_RANGE_DAYS = 10


def _ymd(value: Any) -> str:
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value or "").strip()
    try:
        return dt.date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return ""


def _normalize_stock_code(value: Any) -> str:
    match = re.search(r"\d{4}", str(value or ""))
    return match.group(0) if match else ""


def _clean_text(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return re.sub(r"\s+", " ", text) if text else fallback


def normalize_earnings_calendar_item(raw: dict[str, Any]) -> dict[str, Any]:
    code = _normalize_stock_code(
        raw.get("ticker")
        or raw.get("code")
        or raw.get("stockCode")
        or raw.get("LocalCode")
        or raw.get("Code")
    )
    date = _ymd(
        raw.get("date")
        or raw.get("announcementDate")
        or raw.get("scheduledDate")
        or raw.get("DisclosedDate")
        or raw.get("Date")
        or raw.get("EarningsDate")
    )
    source = raw.get("source") or raw.get("Source") or "手動データ"
    status = raw.get("status") or raw.get("Status") or ("cache_used" if raw.get("cached") else "manual")
    return {
        "date": date,
        "ticker": f"{code}.T" if code else "",
        "stockCode": code,
        "companyName": _clean_text(raw.get("companyName") or raw.get("name") or raw.get("CompanyName"), "会社名未取得"),
        "fiscalPeriod": _clean_text(
            raw.get("fiscalPeriod")
            or raw.get("period")
            or raw.get("TypeOfCurrentPeriod")
            or raw.get("FiscalPeriod"),
            "未取得",
        ),
        "scheduledTime": _clean_text(
            raw.get("scheduledTime")
            or raw.get("time")
            or raw.get("DisclosedTime")
            or raw.get("ScheduledTime"),
            "未定",
        ),
        "source": source,
        "status": status,
        "cached": bool(raw.get("cached") or raw.get("isCached") or raw.get("is_cached") or status == "cache_used"),
        "url": raw.get("url") or raw.get("link") or raw.get("URL") or "",
        "summary": _clean_text(raw.get("summary") or raw.get("note"), "決算発表予定を一次情報で確認してください。"),
    }


def _load_items_from_json(path: Path, *, source: str, status: str, cached: bool = False) -> tuple[list[dict[str, Any]], str]:
    if not path.exists():
        return [], f"{status}_missing"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return [], f"{status}_failed"
    items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return [], f"{status}_failed"
    normalized = []
    for item in items:
        if isinstance(item, dict):
            normalized.append(normalize_earnings_calendar_item({
                **item,
                "source": item.get("source") or source,
                "status": item.get("status") or status,
                "cached": cached or item.get("cached"),
            }))
    return normalized, f"{status}_loaded"


def _load_manual_items(path: Path = DEFAULT_MANUAL_EARNINGS_PATH) -> tuple[list[dict[str, Any]], str]:
    return _load_items_from_json(path, source="手動データ", status="manual_data", cached=False)


def _load_cached_items(path: Path = DEFAULT_CACHE_EARNINGS_PATH) -> tuple[list[dict[str, Any]], str]:
    return _load_items_from_json(path, source="キャッシュ利用", status="cache_used", cached=True)


def _date_range(start_date: str, end_date: str) -> set[str]:
    start_text = _ymd(start_date)
    end_text = _ymd(end_date)
    if not start_text or not end_text:
        return set()
    start = dt.date.fromisoformat(start_text)
    end = dt.date.fromisoformat(end_text)
    if start > end:
        return set()
    days: set[str] = set()
    cursor = start
    while cursor <= end and len(days) < MAX_RANGE_DAYS:
        days.add(cursor.isoformat())
        cursor += dt.timedelta(days=1)
    return days


def _filter_items_by_range(items: list[dict[str, Any]], target_dates: set[str]) -> list[dict[str, Any]]:
    if not target_dates:
        return []
    return [item for item in items if item.get("date") in target_dates]


def _source_status(
    status: str,
    *,
    item_count: int = 0,
    jquants_configured: bool = False,
    detail: str = "",
    manual_status: str = "manual_missing",
    cache_status: str = "cache_missing",
) -> dict[str, Any]:
    mapping = {
        "success": ("J-Quants実取得済み", "good", "J-Quantsの決算発表予定日APIから取得しました。"),
        "api_key_missing": ("J-Quants API未設定", "warn", "JQUANTS_API_KEY が未設定のため、決算予定データは未取得です。"),
        "auth_failed": ("認証失敗", "danger", "J-Quants APIの認証に失敗しました。環境変数と契約プランを確認してください。"),
        "fetch_failed": ("取得失敗", "warn", "J-Quantsの決算予定データを取得できませんでした。"),
        "no_data": ("データなし", "neutral", "対象期間に決算発表予定は見つかりませんでした。"),
        "manual_data": ("手動データ", "warn", "手動JSONの決算予定を表示しています。必ず一次情報をご確認ください。"),
        "cache_used": ("キャッシュ利用", "warn", "一時保存された決算予定を表示しています。最新情報と異なる可能性があります。"),
    }
    label, tone, default_detail = mapping.get(status, ("決算予定データ未取得", "warn", "決算予定データは未取得です。"))
    return {
        "label": label,
        "tone": tone,
        "detail": detail or default_detail,
        "jquantsConfigured": jquants_configured,
        "itemCount": item_count,
        "manualStatus": manual_status,
        "cacheStatus": cache_status,
    }


def get_earnings_calendar_source_status(
    *,
    env: dict[str, str] | None = None,
    manual_status: str = "manual_missing",
    cache_status: str = "cache_missing",
    item_count: int = 0,
    status: str | None = None,
) -> dict[str, Any]:
    source = env if env is not None else os.environ
    jquants_configured = bool(source.get("JQUANTS_API_KEY"))
    resolved = status or ("manual_data" if item_count else "api_key_missing")
    return _source_status(
        resolved,
        item_count=item_count,
        jquants_configured=jquants_configured,
        manual_status=manual_status,
        cache_status=cache_status,
    )


def _extract_jquants_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("data", "earningsCalendar", "earnings_calendar", "items", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _fetch_jquants_earnings_calendar(
    start_date: str,
    end_date: str,
    *,
    env: dict[str, str] | None = None,
    http_get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    source = env if env is not None else os.environ
    api_key = str(source.get("JQUANTS_API_KEY") or "").strip()
    if not api_key:
        return {"status": "api_key_missing", "items": [], "message": "JQUANTS_API_KEY is not configured."}

    params = {"from": _ymd(start_date), "to": _ymd(end_date)}
    if params["from"] == params["to"]:
        params["date"] = params["from"]
    get = http_get or requests.get
    try:
        response = get(
            f"{JQUANTS_V2_BASE}/equities/earnings-calendar",
            params=params,
            headers={"x-api-key": api_key},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.HTTPError as exc:
        status_code = getattr(exc.response, "status_code", 0)
        status = "auth_failed" if status_code in {401, 403} else "fetch_failed"
        return {"status": status, "items": [], "message": f"J-Quants returned HTTP {status_code}."}
    except requests.RequestException as exc:
        return {"status": "fetch_failed", "items": [], "message": f"J-Quants request failed: {exc}"}
    except ValueError:
        return {"status": "fetch_failed", "items": [], "message": "J-Quants returned invalid JSON."}

    if not isinstance(payload, dict):
        return {"status": "fetch_failed", "items": [], "message": "J-Quants returned unexpected payload."}

    items = [
        normalize_earnings_calendar_item({
            **item,
            "source": item.get("source") or "J-Quants",
            "status": "success",
        })
        for item in _extract_jquants_items(payload)
    ]
    return {
        "status": "success" if items else "no_data",
        "items": items,
        "message": "J-Quants earnings calendar loaded." if items else "No earnings calendar items were returned.",
    }


def build_earnings_calendar_payload(
    start_date: str,
    end_date: str,
    *,
    env: dict[str, str] | None = None,
    manual_path: Path = DEFAULT_MANUAL_EARNINGS_PATH,
    cache_path: Path = DEFAULT_CACHE_EARNINGS_PATH,
    http_get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    target_dates = _date_range(start_date, end_date)
    source = env if env is not None else os.environ
    jquants_configured = bool(source.get("JQUANTS_API_KEY"))
    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()

    jquants_result = _fetch_jquants_earnings_calendar(
        start_date,
        end_date,
        env=source,
        http_get=http_get,
    )
    jquants_items = _filter_items_by_range(jquants_result.get("items") or [], target_dates)
    jquants_status = jquants_result.get("status") or "fetch_failed"

    if jquants_status in {"success", "no_data"}:
        status = "success" if jquants_items else "no_data"
        return {
            "status": status,
            "source": "J-Quants",
            "startDate": _ymd(start_date),
            "endDate": _ymd(end_date),
            "fetchedAt": fetched_at,
            "items": jquants_items,
            "sourceStatus": _source_status(
                status,
                item_count=len(jquants_items),
                jquants_configured=jquants_configured,
            ),
            "jquantsStatus": jquants_status,
            "message": "決算予定をJ-Quantsから取得しました。" if jquants_items else "対象期間に決算予定はありません。",
        }

    manual_items, manual_status = _load_manual_items(manual_path)
    manual_items = _filter_items_by_range(manual_items, target_dates)
    if manual_items:
        return {
            "status": "manual_data",
            "source": "manual_json",
            "startDate": _ymd(start_date),
            "endDate": _ymd(end_date),
            "fetchedAt": fetched_at,
            "items": manual_items,
            "sourceStatus": _source_status(
                "manual_data",
                item_count=len(manual_items),
                jquants_configured=jquants_configured,
                manual_status=manual_status,
            ),
            "jquantsStatus": jquants_status,
            "message": "手動JSONの決算予定を表示しています。",
        }

    cache_items, cache_status = _load_cached_items(cache_path)
    cache_items = _filter_items_by_range(cache_items, target_dates)
    if cache_items:
        return {
            "status": "cache_used",
            "source": "cache",
            "startDate": _ymd(start_date),
            "endDate": _ymd(end_date),
            "fetchedAt": fetched_at,
            "items": cache_items,
            "sourceStatus": _source_status(
                "cache_used",
                item_count=len(cache_items),
                jquants_configured=jquants_configured,
                manual_status=manual_status,
                cache_status=cache_status,
            ),
            "jquantsStatus": jquants_status,
            "message": "キャッシュの決算予定を表示しています。",
        }

    source_status = _source_status(
        jquants_status,
        item_count=0,
        jquants_configured=jquants_configured,
        detail=jquants_result.get("message") or "",
        manual_status=manual_status,
        cache_status=cache_status,
    )
    return {
        "status": jquants_status,
        "source": "J-Quants" if jquants_configured else "none",
        "startDate": _ymd(start_date),
        "endDate": _ymd(end_date),
        "fetchedAt": fetched_at,
        "items": [],
        "sourceStatus": source_status,
        "jquantsStatus": jquants_status,
        "message": source_status["detail"],
    }
