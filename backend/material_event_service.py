"""Material event and research-link helpers for simulator analysis.

This module keeps market-event gathering separate from FastAPI route wiring.
It only returns research context for manual review; it never places orders.
"""

from __future__ import annotations

import datetime as dt
import email.utils
import xml.etree.ElementTree as ET
from typing import Any, Callable

MATERIAL_POSITIVE_KEYWORDS = (
    "上方修正", "増益", "自己株式取得", "自社株買い", "公開買付け", "TOB", "受注", "業績予想の修正",
    "配当予想の修正", "株式分割", "資本業務提携", "最高値", "上場来高値", "新製品",
)
MATERIAL_NEGATIVE_KEYWORDS = (
    "下方修正", "減益", "無配", "赤字", "損失", "特別損失", "不正", "調査", "訂正", "遅延",
    "上場廃止", "監理銘柄", "注意喚起", "業績予想の下方修正", "行政処分", "訴訟",
)
MATERIAL_IMPORTANT_KEYWORDS = (
    "決算", "短信", "四半期", "適時開示", "業績", "配当", "修正", "TOB", "公開買付け",
    "自己株式取得", "株主優待", "新製品", "提携", "訴訟", "行政処分", "月次", "説明資料",
)


def external_research_links(
    ticker: str,
    company_name: str = "",
    *,
    normalize_ticker: Callable[[Any], str],
    tdnet_code_url_template: str,
) -> list[dict[str, str]]:
    normalized = normalize_ticker(ticker)
    code = normalized.replace(".T", "")
    label_name = company_name or normalized
    if not code:
        return []
    return [
        {
            "label": "Yahoo Finance Japan",
            "url": f"https://finance.yahoo.co.jp/quote/{code}.T",
            "kind": "price",
            "note": "価格、チャート、気配値を手動確認するための参照先です。",
        },
        {
            "label": "Kabutan",
            "url": f"https://kabutan.jp/stock/?code={code}",
            "kind": "fundamental",
            "note": "業績と開示情報を手動確認するための参照先です。",
        },
        {
            "label": "Minkabu",
            "url": f"https://minkabu.jp/stock/{code}",
            "kind": "sentiment",
            "note": "市場の注目度や投資家心理を手動確認するための参照先です。",
        },
        {
            "label": "TDnet無料RSS",
            "url": tdnet_code_url_template.format(code=code),
            "kind": "disclosure",
            "note": "重要材料を確認するための適時開示フィードです。",
        },
        {
            "label": "EDINET検索",
            "url": f"https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx?searchWord={code}%20{label_name}",
            "kind": "filing",
            "note": "有価証券報告書などの法定開示を確認するための検索先です。",
        },
    ]


def parse_material_datetime(value: Any) -> str | None:
    if not value:
        return None
    text = str(value)
    try:
        parsed = email.utils.parsedate_to_datetime(text)
        if parsed.tzinfo:
            parsed = parsed.astimezone(dt.timezone(dt.timedelta(hours=9))).replace(tzinfo=None)
        return parsed.isoformat(timespec="minutes")
    except Exception:
        pass
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo:
            parsed = parsed.astimezone(dt.timezone(dt.timedelta(hours=9))).replace(tzinfo=None)
        return parsed.isoformat(timespec="minutes")
    except Exception:
        return text[:19]


def material_age_days(published_at: str | None, *, now: dt.datetime | None = None) -> int | None:
    if not published_at:
        return None
    try:
        parsed = dt.datetime.fromisoformat(published_at[:19])
        return ((now or dt.datetime.now()) - parsed).days
    except Exception:
        return None


def material_tone(title: str) -> str:
    if any(keyword.lower() in title.lower() for keyword in MATERIAL_NEGATIVE_KEYWORDS):
        return "negative"
    if any(keyword.lower() in title.lower() for keyword in MATERIAL_POSITIVE_KEYWORDS):
        return "positive"
    if any(keyword.lower() in title.lower() for keyword in MATERIAL_IMPORTANT_KEYWORDS):
        return "important"
    return "neutral"


def material_item(
    title: str,
    *,
    source: str,
    url: str = "",
    published_at: Any = None,
    kind: str = "news",
    now: dt.datetime | None = None,
) -> dict[str, Any] | None:
    title = str(title or "").strip()
    if not title:
        return None
    published = parse_material_datetime(published_at)
    return {
        "title": title,
        "source": source,
        "url": str(url or ""),
        "publishedAt": published,
        "ageDays": material_age_days(published, now=now),
        "tone": material_tone(title),
        "kind": kind,
    }


def news_items_from_yfinance(
    ticker: str,
    *,
    yahoo_news_provider: Callable[[str], list[dict[str, Any]]],
    limit: int = 6,
    now: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    try:
        raw_news = yahoo_news_provider(ticker) or []
    except Exception:
        return []
    items: list[dict[str, Any]] = []
    for raw in raw_news:
        content = raw.get("content", raw) if isinstance(raw, dict) else {}
        title = content.get("title") or raw.get("title")
        provider = (content.get("provider") or {}).get("displayName") or raw.get("publisher") or "Yahoo Finance"
        url = (content.get("canonicalUrl") or {}).get("url") or (content.get("clickThroughUrl") or {}).get("url") or raw.get("link") or ""
        published = content.get("pubDate") or raw.get("providerPublishTime") or ""
        if isinstance(published, (int, float)):
            published = dt.datetime.fromtimestamp(published).isoformat(timespec="minutes")
        item = material_item(title, source=provider, url=url, published_at=published, kind="news", now=now)
        if item:
            items.append(item)
        if len(items) >= limit:
            break
    return items


def tdnet_recent_items(
    ticker: str,
    company_name: str = "",
    *,
    normalize_ticker: Callable[[Any], str],
    http_get: Callable[..., Any],
    tdnet_recent_rss_url: str,
    tdnet_code_url_template: str,
    limit: int = 6,
    now: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    code = normalize_ticker(ticker).replace(".T", "")
    if not code:
        return []
    company_key = (company_name or "").split()[0][:5]

    def parse_feed(url: str, *, source: str, require_match: bool) -> list[dict[str, Any]]:
        try:
            response = http_get(url, timeout=8)
            response.raise_for_status()
            root = ET.fromstring(response.content)
        except Exception:
            return []
        parsed: list[dict[str, Any]] = []
        for node in root.findall(".//item"):
            title = (node.findtext("title") or "").strip()
            description = (node.findtext("description") or "").strip()
            haystack = f"{title} {description}"
            if require_match and code not in haystack and (not company_key or company_key not in haystack):
                continue
            item = material_item(
                title or description,
                source=source,
                url=node.findtext("link") or "",
                published_at=node.findtext("pubDate") or "",
                kind="disclosure",
                now=now,
            )
            if item:
                parsed.append(item)
            if len(parsed) >= limit:
                break
        return parsed

    code_items = parse_feed(
        tdnet_code_url_template.format(code=code),
        source="TDnet無料RSS",
        require_match=False,
    )
    if code_items:
        return code_items[:limit]
    recent_items = parse_feed(tdnet_recent_rss_url, source="TDnet無料RSS", require_match=True)
    return recent_items[:limit]


def statement_material_item(packet: dict[str, Any] | None, *, now: dt.datetime | None = None) -> dict[str, Any] | None:
    statement = (packet or {}).get("latestStatement") or (packet or {}).get("statement") or (packet or {})
    disclosed = statement.get("disclosedDate")
    if not disclosed:
        return None
    doc_type = statement.get("type") or "財務情報"
    eps = statement.get("earningsPerShare") or statement.get("forecastEarningsPerShare")
    dividend = statement.get("forecastDividendPerShareAnnual")
    extras = []
    if eps not in (None, ""):
        extras.append(f"EPS {eps}")
    if dividend not in (None, ""):
        extras.append(f"年間配当予想 {dividend}")
    suffix = f" / {' / '.join(extras)}" if extras else ""
    return material_item(
        f"J-Quants財務 財務開示: {doc_type}{suffix}",
        source="J-Quants fins/statements",
        published_at=disclosed,
        kind="earnings",
        now=now,
    )


def summarize_material_items(
    *,
    news_items: list[dict[str, Any]],
    disclosure_items: list[dict[str, Any]],
    earnings_items: list[dict[str, Any]],
) -> dict[str, Any]:
    official_note = "TDnet無料RSSと公開ニュースを確認します。有料APIは使用しません。J-Quants設定時のみ補助情報を追加します。"
    all_items = sorted(
        [*disclosure_items, *earnings_items, *news_items],
        key=lambda item: item.get("publishedAt") or "",
        reverse=True,
    )
    recent_items = [item for item in all_items if item.get("ageDays") is not None and item["ageDays"] <= 14]
    negative = [item for item in recent_items if item.get("tone") == "negative"]
    positive = [item for item in recent_items if item.get("tone") == "positive"]
    important = [item for item in recent_items if item.get("tone") in {"positive", "negative", "important"}]
    official_items = [item for item in all_items if item.get("kind") in {"disclosure", "earnings"}]
    recent_official_items = [item for item in official_items if item.get("ageDays") is not None and item["ageDays"] <= 14]
    if negative:
        tone = "negative"
        material_score = 0.0
    elif positive:
        tone = "positive"
        material_score = min(1.0, 0.55 + len(positive) * 0.15 + len(disclosure_items) * 0.1)
    elif important:
        tone = "important"
        material_score = 0.45
    elif recent_items:
        tone = "neutral"
        material_score = 0.25
    else:
        tone = "unconfirmed"
        material_score = 0.0
    latest = all_items[0] if all_items else None
    latest_age = latest.get("ageDays") if latest else None
    stale_material = bool(latest_age is not None and latest_age > 14)
    freshness_verdict = "fresh" if recent_items else "stale" if stale_material else "missing"
    return {
        "available": bool(all_items),
        "materialAvailable": bool(important or positive or negative),
        "materialScore": round(material_score, 2),
        "tone": tone,
        "summary": latest["title"] if latest else "直近の重要材料は確認できませんでした。",
        "latestPublishedAt": latest.get("publishedAt") if latest else None,
        "latestAgeDays": latest_age,
        "freshnessVerdict": freshness_verdict,
        "recentImportantCount": len(important),
        "officialDisclosureCount": len(official_items),
        "recentOfficialDisclosureCount": len(recent_official_items),
        "hasRecentImportant": bool(important or positive or negative),
        "hasNegative": bool(negative),
        "items": all_items[:8],
        "sources": sorted({item["source"] for item in all_items}),
        "officialNote": official_note,
    }


def material_events_for_ticker(
    ticker: str,
    company_name: str = "",
    *,
    include_jquants: bool = False,
    normalize_ticker: Callable[[Any], str],
    yahoo_news_provider: Callable[[str], list[dict[str, Any]]],
    http_get: Callable[..., Any],
    tdnet_recent_rss_url: str,
    tdnet_code_url_template: str,
    research_packet: Callable[[str], dict[str, Any]] | None = None,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    news_items = news_items_from_yfinance(
        ticker,
        yahoo_news_provider=yahoo_news_provider,
        now=now,
    )
    disclosure_items = tdnet_recent_items(
        ticker,
        company_name,
        normalize_ticker=normalize_ticker,
        http_get=http_get,
        tdnet_recent_rss_url=tdnet_recent_rss_url,
        tdnet_code_url_template=tdnet_code_url_template,
        now=now,
    )
    earnings_items: list[dict[str, Any]] = []
    if include_jquants and research_packet is not None:
        try:
            statement_item = statement_material_item(research_packet(ticker), now=now)
            if statement_item:
                earnings_items.append(statement_item)
        except Exception:
            pass
    return summarize_material_items(
        news_items=news_items,
        disclosure_items=disclosure_items,
        earnings_items=earnings_items,
    )
