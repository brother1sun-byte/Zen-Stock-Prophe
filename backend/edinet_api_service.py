"""Read-only EDINET disclosure helpers.

The service is research-only. It fetches public EDINET document metadata for
manual review and never connects to broker or order APIs.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from typing import Any, Callable

import requests

EDINET_DOCUMENTS_ENDPOINT = "https://disclosure.edinet-fsa.go.jp/api/v2/documents.json"
MAX_RANGE_DAYS = 5


def _ymd(value: dt.date | dt.datetime | str) -> str:
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value or "").strip()
    try:
        return dt.date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return ""


def _date_range(start_date: str, end_date: str) -> list[str]:
    start_text = _ymd(start_date)
    end_text = _ymd(end_date)
    if not start_text or not end_text:
        return []
    start = dt.date.fromisoformat(start_text)
    end = dt.date.fromisoformat(end_text)
    if start > end:
        return []
    days: list[str] = []
    cursor = start
    while cursor <= end and len(days) < MAX_RANGE_DAYS:
        days.append(cursor.isoformat())
        cursor += dt.timedelta(days=1)
    return days


def get_edinet_api_key(env: dict[str, str] | None = None) -> str:
    source = env if env is not None else os.environ
    return str(source.get("EDINET_API_KEY") or source.get("VITE_EDINET_API_KEY") or "").strip()


def _normalize_sec_code(value: Any) -> str:
    match = re.search(r"\d{4}", str(value or ""))
    return match.group(0) if match else ""


def normalize_edinet_document(raw: dict[str, Any]) -> dict[str, Any]:
    doc_id = raw.get("docID") or raw.get("docId") or raw.get("documentId") or ""
    title = raw.get("docDescription") or raw.get("title") or raw.get("documentType") or ""
    return {
        "docID": doc_id,
        "submitDateTime": raw.get("submitDateTime") or raw.get("submitDate") or raw.get("date") or "",
        "filerName": raw.get("filerName") or raw.get("submitterName") or raw.get("companyName") or "",
        "edinetCode": raw.get("edinetCode") or raw.get("filerEdinetCode") or "",
        "secCode": _normalize_sec_code(raw.get("secCode") or raw.get("securityCode") or raw.get("stockCode")),
        "docDescription": title,
        "formCode": raw.get("formCode") or "",
        "ordinanceCode": raw.get("ordinanceCode") or "",
        "documentType": raw.get("documentType") or title,
        "source": "EDINET",
        "url": f"https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx?docID={doc_id}" if doc_id else "",
    }


def fetch_edinet_documents_by_date(
    date: str,
    *,
    env: dict[str, str] | None = None,
    http_get: Callable[..., Any] = requests.get,
    timeout: int = 12,
) -> dict[str, Any]:
    api_key = get_edinet_api_key(env)
    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()
    if not api_key:
        return {
            "status": "api_key_missing",
            "date": date,
            "fetchedAt": fetched_at,
            "documents": [],
            "message": "EDINET APIキー未設定です。",
        }
    try:
        response = http_get(
            EDINET_DOCUMENTS_ENDPOINT,
            params={"date": _ymd(date), "type": 2, "Subscription-Key": api_key},
            headers={"Ocp-Apim-Subscription-Key": api_key},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        documents = [
            normalize_edinet_document(item)
            for item in payload.get("results", [])
            if item.get("docID") or item.get("docDescription")
        ]
        return {
            "status": "success",
            "date": date,
            "fetchedAt": fetched_at,
            "documents": documents,
            "message": "EDINET提出書類を取得しました。" if documents else "EDINET提出書類は見つかりませんでした。",
        }
    except Exception as exc:  # pragma: no cover - exact requests exception varies
        return {
            "status": "fetch_failed",
            "date": date,
            "fetchedAt": fetched_at,
            "documents": [],
            "message": f"EDINET API取得に失敗しました。{exc}",
        }


def fetch_edinet_documents_by_date_range(
    start_date: str,
    end_date: str,
    *,
    env: dict[str, str] | None = None,
    http_get: Callable[..., Any] = requests.get,
) -> dict[str, Any]:
    dates = _date_range(start_date, end_date)
    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()
    if not dates:
        return {
            "status": "fetch_failed",
            "startDate": start_date,
            "endDate": end_date,
            "fetchedAt": fetched_at,
            "days": [],
            "documents": [],
            "message": "EDINET取得対象期間を作成できませんでした。",
        }
    days = [
        fetch_edinet_documents_by_date(day, env=env, http_get=http_get)
        for day in dates
    ]
    documents = [document for day in days for document in day.get("documents", [])]
    missing_key = all(day.get("status") == "api_key_missing" for day in days)
    failed = next((day for day in days if day.get("status") == "fetch_failed"), None)
    status = "api_key_missing" if missing_key else "fetch_failed" if failed else "success"
    message = (
        "EDINET APIキー未設定です。"
        if missing_key
        else failed.get("message") if failed
        else "EDINET提出書類を取得しました。" if documents
        else "対象期間にEDINET提出書類はありません。"
    )
    return {
        "status": status,
        "startDate": dates[0],
        "endDate": dates[-1],
        "fetchedAt": fetched_at,
        "days": days,
        "documents": documents,
        "message": message,
    }
