"""Quote and event context helpers for daytrade analysis.

The functions here are dependency-injected so tests can avoid network calls.
They provide simulator research context only and never connect to brokers.
"""

from __future__ import annotations

import datetime as dt
import email.utils
import math
from typing import Any, Callable

import pandas as pd


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except Exception:
        return default


def parse_event_timestamp(value: Any) -> dt.datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    if isinstance(value, (int, float)):
        try:
            return dt.datetime.fromtimestamp(float(value), tz=dt.timezone.utc)
        except Exception:
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except Exception:
        pass
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def news_item_from_yfinance(
    raw: dict[str, Any],
    *,
    positive_keywords: tuple[str, ...],
    negative_keywords: tuple[str, ...],
    important_keywords: tuple[str, ...],
) -> dict[str, Any] | None:
    content = raw.get("content", raw)
    title = content.get("title") or raw.get("title")
    if not title:
        return None
    publisher = content.get("provider", {}).get("displayName") or raw.get("publisher") or ""
    url = content.get("canonicalUrl", {}).get("url") or content.get("clickThroughUrl", {}).get("url") or raw.get("link") or ""
    published = content.get("pubDate") or raw.get("providerPublishTime") or raw.get("publishedAt") or ""
    parsed = parse_event_timestamp(published)
    title_text = str(title)
    positive = any(keyword in title_text for keyword in positive_keywords)
    negative = any(keyword in title_text for keyword in negative_keywords)
    important = positive or negative or any(keyword in title_text for keyword in important_keywords)
    return {
        "title": title_text,
        "publisher": str(publisher),
        "url": str(url),
        "publishedAt": parsed.isoformat() if parsed else str(published),
        "important": bool(important),
        "positive": bool(positive),
        "negative": bool(negative),
    }


def build_daytrade_quote_context(
    ticker: str,
    *,
    symbol_provider: Callable[[str], Any],
) -> dict[str, Any]:
    payload = {"source": "UNAVAILABLE", "bid": None, "ask": None, "quoteAgeSec": 999}
    try:
        symbol = symbol_provider(ticker)
        fast_info = getattr(symbol, "fast_info", {}) or {}
        bid = safe_float(getattr(fast_info, "bid", None) or fast_info.get("bid"))
        ask = safe_float(getattr(fast_info, "ask", None) or fast_info.get("ask"))
        last_price = safe_float(getattr(fast_info, "last_price", None) or fast_info.get("lastPrice") or fast_info.get("last_price"))
        if bid > 0 and ask > bid:
            payload.update({"source": "YFINANCE_FAST_INFO", "bid": bid, "ask": ask, "lastPrice": last_price or None, "quoteAgeSec": 60})
    except Exception as exc:
        payload.update({"source": "UNAVAILABLE", "error": str(exc)[:160]})
    return payload


def _calendar_values(calendar: Any) -> list[Any]:
    if isinstance(calendar, pd.DataFrame) and not calendar.empty:
        return calendar.values.flatten().tolist()
    if isinstance(calendar, dict):
        return list(calendar.values())
    return []


def build_daytrade_event_context(
    ticker: str,
    *,
    symbol_provider: Callable[[str], Any],
    positive_keywords: tuple[str, ...],
    negative_keywords: tuple[str, ...],
    important_keywords: tuple[str, ...],
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    now = now or dt.datetime.now(dt.timezone.utc)
    items: list[dict[str, Any]] = []
    upcoming_earnings = False
    source = "YFINANCE"
    try:
        symbol = symbol_provider(ticker)
        for raw in (symbol.news or [])[:8]:
            item = news_item_from_yfinance(
                raw,
                positive_keywords=positive_keywords,
                negative_keywords=negative_keywords,
                important_keywords=important_keywords,
            )
            if item:
                items.append(item)
        try:
            for raw_value in _calendar_values(symbol.calendar):
                values = raw_value if isinstance(raw_value, (list, tuple, set)) else [raw_value]
                for value in values:
                    parsed = parse_event_timestamp(value)
                    if parsed and -1 <= (parsed - now).days <= 5:
                        upcoming_earnings = True
                        break
                if upcoming_earnings:
                    break
        except Exception:
            pass
    except Exception as exc:
        source = "UNAVAILABLE"
        items = [{"title": f"event fetch failed: {str(exc)[:120]}", "important": False, "positive": False, "negative": False}]

    recent_items = []
    for item in items:
        published = parse_event_timestamp(item.get("publishedAt"))
        if published and (now - published).total_seconds() <= 3 * 24 * 3600:
            recent_items.append(item)
    material_recent = [item for item in recent_items if item.get("important")]
    positives = sum(1 for item in material_recent if item.get("positive"))
    negatives = sum(1 for item in material_recent if item.get("negative"))
    if positives and negatives:
        tone = "mixed"
    elif negatives:
        tone = "negative"
    elif positives:
        tone = "positive"
    else:
        tone = "neutral" if recent_items else "unknown"
    latest = recent_items[0] if recent_items else items[0] if items else {}
    return {
        "source": source,
        "tone": tone,
        "hasRecentMaterial": bool(material_recent),
        "hasUpcomingEarnings": bool(upcoming_earnings),
        "latestTitle": latest.get("title", ""),
        "latestPublishedAt": latest.get("publishedAt", ""),
        "items": items[:3],
    }
