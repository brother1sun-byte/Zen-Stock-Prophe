"""Read-only earnings calendar helpers for pre-open research checks."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MANUAL_EARNINGS_PATH = ROOT_DIR / "src" / "data" / "manualEarningsCalendar.json"
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


def normalize_earnings_calendar_item(raw: dict[str, Any]) -> dict[str, Any]:
    code = _normalize_stock_code(raw.get("ticker") or raw.get("code") or raw.get("stockCode") or raw.get("LocalCode"))
    date = _ymd(raw.get("date") or raw.get("announcementDate") or raw.get("scheduledDate") or raw.get("DisclosedDate"))
    return {
        "date": date,
        "ticker": f"{code}.T" if code else "",
        "stockCode": code,
        "companyName": raw.get("companyName") or raw.get("name") or raw.get("CompanyName") or "会社名未取得",
        "fiscalPeriod": raw.get("fiscalPeriod") or raw.get("period") or raw.get("TypeOfCurrentPeriod") or "未取得",
        "scheduledTime": raw.get("scheduledTime") or raw.get("time") or raw.get("DisclosedTime") or "未定",
        "source": raw.get("source") or "手動データ",
        "status": raw.get("status") or "manual",
        "cached": bool(raw.get("cached") or raw.get("isCached") or raw.get("is_cached")),
        "url": raw.get("url") or raw.get("link") or "",
        "summary": raw.get("summary") or raw.get("note") or "決算発表予定を一次情報で確認してください。",
    }


def _load_manual_items(path: Path = DEFAULT_MANUAL_EARNINGS_PATH) -> tuple[list[dict[str, Any]], str]:
    if not path.exists():
        return [], "manual_missing"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return [], "manual_failed"
    items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return [], "manual_failed"
    return [normalize_earnings_calendar_item(item) for item in items], "manual_loaded"


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


def get_earnings_calendar_source_status(
    *,
    env: dict[str, str] | None = None,
    manual_status: str = "manual_missing",
    item_count: int = 0,
) -> dict[str, Any]:
    source = env if env is not None else os.environ
    jquants_configured = bool(source.get("JQUANTS_API_KEY") or source.get("JQUANTS_ID_TOKEN") or source.get("JQUANTS_REFRESH_TOKEN"))
    if item_count:
        return {
            "label": "手動データ",
            "tone": "warn",
            "detail": "手動JSONの決算予定を表示しています。一次情報を確認してください。",
            "jquantsConfigured": jquants_configured,
        }
    if jquants_configured:
        return {
            "label": "J-Quants未実装",
            "tone": "warn",
            "detail": "J-Quants認証情報はありますが、決算予定の実取得は未接続です。",
            "jquantsConfigured": True,
        }
    return {
        "label": "J-Quants API未設定",
        "tone": "warn",
        "detail": "決算予定データは未取得です。手動JSONまたはJ-Quants連携を設定してください。",
        "jquantsConfigured": False,
        "manualStatus": manual_status,
    }


def build_earnings_calendar_payload(
    start_date: str,
    end_date: str,
    *,
    env: dict[str, str] | None = None,
    manual_path: Path = DEFAULT_MANUAL_EARNINGS_PATH,
) -> dict[str, Any]:
    target_dates = _date_range(start_date, end_date)
    manual_items, manual_status = _load_manual_items(manual_path)
    items = [item for item in manual_items if item.get("date") in target_dates]
    source_status = get_earnings_calendar_source_status(env=env, manual_status=manual_status, item_count=len(items))
    status = "success" if items else "api_key_missing" if not source_status.get("jquantsConfigured") else "not_implemented"
    return {
        "status": status,
        "startDate": _ymd(start_date),
        "endDate": _ymd(end_date),
        "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "items": items,
        "sourceStatus": source_status,
        "message": "決算予定を取得しました。" if items else "決算予定データは未取得です。",
    }
