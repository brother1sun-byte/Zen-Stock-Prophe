"""Optional read-only J-Quants research connector for Japanese equities.

Free J-Quants plans are delayed. The app therefore treats J-Quants as the
official historical source outside the recent 12-week window, while a separate
recent-data lane can fill the latest quote for the dashboard.
"""

from __future__ import annotations

import os
import re
from datetime import date, timedelta
from typing import Any, Callable

import requests


V1_API_BASE = "https://api.jquants.com/v1"
V2_API_BASE = "https://api.jquants.com/v2"
DOCS_URL = "https://jpx.gitbook.io/j-quants-ja/api-reference"
JPX_URL = "https://jpx-jquants.com/"
REQUEST_TIMEOUT_SEC = 8
FREE_PLAN_DELAY_DAYS = int(os.environ.get("JQUANTS_FREE_PLAN_DELAY_DAYS", "84"))
OFFICIAL_HISTORY_DAYS = int(os.environ.get("JQUANTS_OFFICIAL_HISTORY_DAYS", "730"))
_CODE_RE = re.compile(r"^\d{4,5}$")


class JQuantsError(RuntimeError):
    """Raised for recoverable connector errors."""


def configured_token() -> str:
    return (
        os.environ.get("JQUANTS_API_KEY")
        or os.environ.get("JQUANTS_ID_TOKEN")
        or os.environ.get("JQUANTS_REFRESH_TOKEN")
        or ""
    ).strip()


def auth_mode() -> str:
    if os.environ.get("JQUANTS_API_KEY"):
        return "API_KEY"
    if os.environ.get("JQUANTS_ID_TOKEN"):
        return "ID_TOKEN"
    if os.environ.get("JQUANTS_REFRESH_TOKEN"):
        return "REFRESH_TOKEN"
    return "NOT_CONFIGURED"


def connector_status() -> dict[str, Any]:
    configured = bool(configured_token())
    return {
        "name": "J-Quants API",
        "configured": configured,
        "mode": auth_mode(),
        "docsUrl": DOCS_URL,
        "jpxUrl": JPX_URL,
        "executionImpact": "research_only",
        "liveOrdersEnabled": False,
        "coverage": "Japanese listed equities. Free-plan official data is treated as delayed historical data.",
        "dataPolicy": data_policy(),
        "safeUse": [
            "12週間より古い日本株の公式ヒストリカル確認",
            "直近12週間の補完データとの比較",
            "売買判断の根拠確認に使う読み取り専用リサーチ",
        ],
        "unsupported": [
            "ライブ発注",
            "板・歩み値のリアルタイム代替",
            "楽天証券やMarketSpeedとの自動連携",
            "APIキー未設定時の外部データ取得",
        ],
        "endpoints": [
            "/v2/equities/bars/daily",
            "/v1/listed/info",
            "/v1/prices/daily_quotes",
            "/v1/fins/statements",
        ],
        "nextStep": (
            "Ready for read-only J-Quants API calls."
            if configured
            else "J-Quants APIキー未設定です。実データ取得を使う場合は JQUANTS_API_KEY を設定してください。"
        ),
    }


def data_policy() -> dict[str, Any]:
    return {
        "recentWindowDays": FREE_PLAN_DELAY_DAYS,
        "officialHistoryDays": OFFICIAL_HISTORY_DAYS,
        "recentProvider": "yfinance fallback",
        "officialProvider": "J-Quants delayed official history",
        "recentRule": "直近12週間はJ-Quants無料プランでは取得できないため補完ソースを使う",
        "officialRule": "12週間より古い最大2年分はJ-Quants APIを公式履歴として使う",
    }

def normalize_jpx_code(value: str) -> str:
    code = (value or "").strip().upper()
    if code.endswith(".T"):
        code = code[:-2]
    code = code.replace("-", "")
    if not _CODE_RE.match(code):
        raise JQuantsError("銘柄コードは 4980 または 4980.T の形式で指定してください。")
    return code[:4]


def _v2_code(code: str) -> str:
    return f"{code[:4]}0"


def _id_token(session=requests) -> str:
    direct = os.environ.get("JQUANTS_ID_TOKEN", "").strip()
    if direct:
        return direct

    refresh = os.environ.get("JQUANTS_REFRESH_TOKEN", "").strip()
    if not refresh:
        raise JQuantsError("JQUANTS_REFRESH_TOKEN or JQUANTS_ID_TOKEN is not configured.")

    try:
        response = session.post(
            f"{V1_API_BASE}/token/auth_refresh",
            params={"refreshtoken": refresh},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        response.raise_for_status()
        token = response.json().get("idToken")
    except requests.HTTPError as exc:
        status_code = getattr(exc.response, "status_code", "unknown")
        raise JQuantsError(f"J-Quants auth returned HTTP {status_code}.") from exc
    except requests.RequestException as exc:
        raise JQuantsError(f"J-Quants auth request failed: {exc}") from exc
    except ValueError as exc:
        raise JQuantsError("J-Quants auth returned invalid JSON.") from exc

    if not token:
        raise JQuantsError("J-Quants auth response did not include idToken.")
    return token


def _get_json_v1(path: str, params: dict[str, Any], session=requests) -> dict[str, Any]:
    try:
        response = session.get(
            f"{V1_API_BASE}/{path.lstrip('/')}",
            params=params,
            headers={"Authorization": f"Bearer {_id_token(session)}"},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else {}
    except JQuantsError:
        raise
    except requests.HTTPError as exc:
        status_code = getattr(exc.response, "status_code", "unknown")
        raise JQuantsError(f"J-Quants returned HTTP {status_code}.") from exc
    except requests.RequestException as exc:
        raise JQuantsError(f"J-Quants request failed: {exc}") from exc
    except ValueError as exc:
        raise JQuantsError("J-Quants returned invalid JSON.") from exc


def _get_json_v2(path: str, params: dict[str, Any], session=requests) -> dict[str, Any]:
    api_key = os.environ.get("JQUANTS_API_KEY", "").strip()
    if not api_key:
        raise JQuantsError("JQUANTS_API_KEY is not configured.")
    try:
        response = session.get(
            f"{V2_API_BASE}/{path.lstrip('/')}",
            params=params,
            headers={"x-api-key": api_key},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else {}
    except requests.HTTPError as exc:
        status_code = getattr(exc.response, "status_code", "unknown")
        try:
            message = exc.response.json().get("message") if exc.response is not None else ""
        except ValueError:
            message = ""
        raise JQuantsError(f"J-Quants V2 returned HTTP {status_code}: {message}") from exc
    except requests.RequestException as exc:
        raise JQuantsError(f"J-Quants V2 request failed: {exc}") from exc
    except ValueError as exc:
        raise JQuantsError("J-Quants V2 returned invalid JSON.") from exc


def _latest(items: list[dict[str, Any]], date_key: str) -> dict[str, Any]:
    return sorted(items, key=lambda item: str(item.get(date_key) or ""))[-1] if items else {}


def _quote_from_item(item: dict[str, Any], source: str, delayed: bool) -> dict[str, Any]:
    return {
        "source": source,
        "delayed": delayed,
        "date": item.get("Date") or item.get("date"),
        "open": item.get("Open") or item.get("open"),
        "high": item.get("High") or item.get("high"),
        "low": item.get("Low") or item.get("low"),
        "close": item.get("Close") or item.get("close"),
        "adjustmentClose": item.get("AdjustmentClose") or item.get("adjustment_close"),
        "volume": item.get("Volume") or item.get("volume"),
        "turnoverValue": item.get("TurnoverValue") or item.get("turnover_value"),
    }


def _quote_has_price(quote: dict[str, Any] | None) -> bool:
    if not quote:
        return False
    return quote.get("close") is not None or quote.get("adjustmentClose") is not None


def _quote_age_days(quote: dict[str, Any] | None) -> int | None:
    if not quote or not quote.get("date"):
        return None
    raw_date = quote.get("date")
    try:
        if isinstance(raw_date, date):
            quote_date = raw_date
        else:
            quote_date = date.fromisoformat(str(raw_date)[:10])
    except ValueError:
        return None
    return max(0, (date.today() - quote_date).days)


def _statement_present(statement: dict[str, Any] | None) -> bool:
    if not statement:
        return False
    return any(value not in {None, ""} for value in statement.values())


def _source_integrity(
    status: dict[str, Any],
    *,
    latest_quote: dict[str, Any] | None = None,
    recent_quote: dict[str, Any] | None = None,
    delayed_quote: dict[str, Any] | None = None,
    latest_statement: dict[str, Any] | None = None,
    source_policy: str | None = None,
) -> dict[str, Any]:
    mode = status.get("mode") or "NOT_CONFIGURED"
    configured = bool(status.get("configured"))
    policy = source_policy or (
        "official_delayed_plus_recent_supplement" if mode == "API_KEY" else "direct_official_jquants"
    )
    v1_official_quote = latest_quote if mode != "API_KEY" and _quote_has_price(latest_quote) else None
    official_quote = delayed_quote or v1_official_quote
    official_history_present = bool(official_quote)
    recent_supplement_present = bool(recent_quote)
    official_history_usable = _quote_has_price(official_quote)
    recent_supplement_usable = _quote_has_price(recent_quote)
    statement_usable = _statement_present(latest_statement)
    latest_source = latest_quote.get("source") if latest_quote else None
    if not configured:
        verdict = "UNAVAILABLE"
        label = "J-Quants未接続"
        detail = "J-Quants APIキー未設定のため、公式履歴・財務データは未取得です。無料/公開ソースのみで確認します。"
    elif mode == "API_KEY":
        if official_history_usable and recent_supplement_usable:
            verdict = "PASS"
            label = "公式遅延履歴+直近補完"
            detail = "J-Quantsの遅延公式履歴と直近補完ソースを分離して確認できます。"
        elif official_history_usable:
            verdict = "REVIEW"
            label = "公式履歴のみ"
            detail = "J-Quants遅延公式履歴はありますが、直近価格の補完が未確認です。"
        elif recent_supplement_usable:
            verdict = "REVIEW"
            label = "直近補完のみ"
            detail = (
                "直近補完価格はありますが、J-Quants公式遅延履歴は終値または調整後終値が不足しているため"
                "未確認扱いです。根拠確認は要レビューです。"
                if official_history_present
                else "直近補完価格はありますが、J-Quants公式遅延履歴が未確認です。根拠確認は要レビューです。"
            )
        else:
            verdict = "UNAVAILABLE"
            if official_history_present or recent_supplement_present:
                label = "価格終値未確認"
                detail = (
                    "J-Quants APIキーは設定済みで一部データ応答はありますが、"
                    "分析に使う終値または調整後終値が不足しています。"
                )
            else:
                label = "公式履歴未取得"
                detail = "J-Quants APIキーは設定済みですが、公式履歴も直近補完も取得できていません。"
    elif official_history_usable:
        verdict = "PASS"
        label = "J-Quants公式データ"
        detail = "J-Quants V1の公式銘柄・日足・財務データを読み取り専用で確認できます。"
    else:
        verdict = "REVIEW"
        label = "J-Quants応答不足"
        detail = "J-Quantsは接続済みですが、日足または財務の取得結果が不足しています。"
    return {
        "verdict": verdict,
        "label": label,
        "detail": detail,
        "configured": configured,
        "mode": mode,
        "sourcePolicy": policy,
        "latestQuoteSource": latest_source,
        "latestQuoteAgeDays": _quote_age_days(latest_quote),
        "latestQuoteHasPrice": _quote_has_price(latest_quote),
        "officialHistoryPresent": official_history_present,
        "officialHistoryUsable": official_history_usable,
        "officialHistorySource": official_quote.get("source") if official_quote else None,
        "officialHistoryAgeDays": _quote_age_days(official_quote),
        "recentSupplementPresent": recent_supplement_present,
        "recentSupplementUsable": recent_supplement_usable,
        "recentSupplementSource": recent_quote.get("source") if recent_quote else None,
        "recentSupplementAgeDays": _quote_age_days(recent_quote),
        "statementUsable": statement_usable,
        "lanes": [
            {
                "id": "official_history",
                "label": "公式履歴",
                "ok": official_history_usable,
                "source": official_quote.get("source") if official_quote else None,
                "ageDays": _quote_age_days(official_quote),
            },
            {
                "id": "recent_supplement",
                "label": "直近補完",
                "ok": recent_supplement_usable,
                "source": recent_quote.get("source") if recent_quote else None,
                "ageDays": _quote_age_days(recent_quote),
            },
            {
                "id": "financial_statement",
                "label": "財務",
                "ok": statement_usable,
                "source": "J-Quants fins/statements" if statement_usable else None,
                "ageDays": None,
            },
        ],
    }


def _empty_packet(status: dict[str, Any], code: str, summary: str) -> dict[str, Any]:
    return {
        **status,
        "code": code,
        "available": False,
        "summary": summary,
        "issue": None,
        "latestQuote": None,
        "recentQuote": None,
        "delayedQuote": None,
        "latestStatement": None,
        "quotes": [],
        "sourceIntegrity": _source_integrity(status),
    }


def _recent_quote_yfinance(code: str) -> dict[str, Any] | None:
    try:
        import yfinance as yf

        frame = yf.Ticker(f"{code}.T").history(period="15d", interval="1d", auto_adjust=False)
    except Exception:
        return None
    if frame is None or frame.empty:
        return None
    cleaned = frame.dropna(how="all")
    if cleaned.empty:
        return None
    price_columns = [column for column in ("Close", "Adj Close") if column in cleaned.columns]
    priced_rows = cleaned[cleaned[price_columns].notna().any(axis=1)] if price_columns else cleaned
    row = (priced_rows if not priced_rows.empty else cleaned).tail(1)
    if row.empty:
        return None
    last = row.iloc[0]
    index_value = row.index[-1]
    return {
        "source": "yfinance",
        "delayed": False,
        "date": getattr(index_value, "date", lambda: index_value)().isoformat()
        if hasattr(getattr(index_value, "date", None), "__call__")
        else str(index_value),
        "open": float(last.get("Open")) if last.get("Open") == last.get("Open") else None,
        "high": float(last.get("High")) if last.get("High") == last.get("High") else None,
        "low": float(last.get("Low")) if last.get("Low") == last.get("Low") else None,
        "close": float(last.get("Close")) if last.get("Close") == last.get("Close") else None,
        "adjustmentClose": float(last.get("Adj Close")) if last.get("Adj Close") == last.get("Adj Close") else None,
        "volume": int(last.get("Volume")) if last.get("Volume") == last.get("Volume") else None,
    }


def _extract_v2_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = payload.get("daily_quotes") or payload.get("bars") or payload.get("data") or []
    return items if isinstance(items, list) else []


def _research_packet_v2(
    code: str,
    status: dict[str, Any],
    session=requests,
    recent_provider: Callable[[str], dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    delayed_anchor = date.today() - timedelta(days=FREE_PLAN_DELAY_DAYS)
    last_error = ""
    delayed_quote = None
    quotes: list[dict[str, Any]] = []

    for offset in range(0, 10):
        target_date = delayed_anchor - timedelta(days=offset)
        try:
            payload = _get_json_v2(
                "equities/bars/daily",
                {"code": _v2_code(code), "date": target_date.isoformat()},
                session=session,
            )
        except JQuantsError as exc:
            last_error = str(exc)
            if "Rate limit exceeded" in last_error:
                break
            continue

        items = _extract_v2_items(payload)
        latest = _latest(items, "Date") or _latest(items, "date")
        if latest:
            quotes = items[-10:]
            delayed_quote = _quote_from_item(latest, "J-Quants V2 delayed official", True)
            break

    recent_quote = (recent_provider or _recent_quote_yfinance)(code)
    latest_quote = recent_quote or delayed_quote

    if not delayed_quote and not recent_quote:
        return _empty_packet(
            status,
            code,
            f"J-Quants APIキーは設定済みですが、無料プランの遅延範囲またはレート制限により取得できませんでした。{last_error}",
        )

    return {
        **status,
        "code": code,
        "available": bool(delayed_quote or recent_quote),
        "summary": "直近12週間は補完ソース、12週間より古い公式履歴はJ-Quantsで確認します。",
        "issue": None,
        "latestQuote": latest_quote,
        "recentQuote": recent_quote,
        "delayedQuote": delayed_quote,
        "latestStatement": None,
        "quotes": quotes,
        "jquantsError": None if delayed_quote else last_error,
        "sourceIntegrity": _source_integrity(
            status,
            latest_quote=latest_quote,
            recent_quote=recent_quote,
            delayed_quote=delayed_quote,
            source_policy="official_delayed_plus_recent_supplement",
        ),
    }


def _research_packet_v1(code: str, status: dict[str, Any], session=requests) -> dict[str, Any]:
    today = date.today()
    start = today - timedelta(days=45)
    issue_payload = _get_json_v1("listed/info", {"code": code}, session=session)
    quote_payload = _get_json_v1(
        "prices/daily_quotes",
        {"code": code, "from": start.isoformat(), "to": today.isoformat()},
        session=session,
    )
    statement_payload = _get_json_v1("fins/statements", {"code": code}, session=session)

    issue = _latest(issue_payload.get("info") or [], "Date")
    quotes = quote_payload.get("daily_quotes") or []
    latest_quote = _latest(quotes, "Date")
    latest_statement = _latest(statement_payload.get("statements") or [], "DisclosedDate")

    latest_quote_payload = _quote_from_item(latest_quote, "J-Quants V1", False)
    latest_statement_payload = {
        "disclosedDate": latest_statement.get("DisclosedDate"),
        "type": latest_statement.get("TypeOfDocument"),
        "netSales": latest_statement.get("NetSales"),
        "operatingProfit": latest_statement.get("OperatingProfit"),
        "ordinaryProfit": latest_statement.get("OrdinaryProfit"),
        "profit": latest_statement.get("Profit"),
        "earningsPerShare": latest_statement.get("EarningsPerShare"),
        "bookValuePerShare": latest_statement.get("BookValuePerShare"),
        "forecastEarningsPerShare": latest_statement.get("ForecastEarningsPerShare"),
        "forecastDividendPerShareAnnual": latest_statement.get("ForecastDividendPerShareAnnual"),
    }

    return {
        **status,
        "code": code,
        "available": True,
        "summary": "Read-only J-Quants V1 Japanese equity research packet loaded.",
        "issue": {
            "name": issue.get("CompanyName"),
            "market": issue.get("MarketCodeName"),
            "sector17": issue.get("Sector17CodeName"),
            "sector33": issue.get("Sector33CodeName"),
            "scale": issue.get("ScaleCategory"),
        },
        "latestQuote": latest_quote_payload,
        "recentQuote": None,
        "delayedQuote": None,
        "latestStatement": latest_statement_payload,
        "quotes": quotes[-10:],
        "sourceIntegrity": _source_integrity(
            status,
            latest_quote=latest_quote_payload,
            latest_statement=latest_statement_payload,
            source_policy="direct_official_jquants",
        ),
    }


def research_packet(
    code: str,
    session=requests,
    recent_provider: Callable[[str], dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    normalized = normalize_jpx_code(code)
    status = connector_status()
    if not status["configured"]:
        return _empty_packet(
            status,
            normalized,
            "J-Quants APIキー未設定のため、実データは取得していません。これは正常な未接続状態です。",
        )
    if status["mode"] == "API_KEY":
        return _research_packet_v2(normalized, status, session=session, recent_provider=recent_provider)
    return _research_packet_v1(normalized, status, session=session)
