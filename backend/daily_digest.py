"""Daily Gmail digest generation for Zen Stock Prophet Pro."""

from __future__ import annotations

import datetime as dt
from typing import Any, Callable

import yfinance as yf

from alert_engine import JST, build_watchlist_alert_report


DIGEST_SCHEMA_VERSION = 1


def _news_item_from_yfinance(raw: dict[str, Any]) -> dict[str, str] | None:
    content = raw.get("content", raw)
    title = content.get("title") or raw.get("title")
    if not title:
        return None
    publisher = content.get("provider", {}).get("displayName") or raw.get("publisher") or ""
    url = content.get("canonicalUrl", {}).get("url") or content.get("clickThroughUrl", {}).get("url") or raw.get("link") or ""
    published = content.get("pubDate") or raw.get("providerPublishTime") or ""
    return {"title": str(title), "publisher": str(publisher), "url": str(url), "published": str(published)}


def fetch_symbol_news(ticker: str, limit: int = 3) -> list[dict[str, str]]:
    """Fetch a small news list for a ticker through yfinance."""

    try:
        raw_news = yf.Ticker(ticker).news or []
    except Exception:
        return []
    items: list[dict[str, str]] = []
    for raw in raw_news:
        item = _news_item_from_yfinance(raw)
        if item:
            items.append(item)
        if len(items) >= limit:
            break
    return items


def build_digest_body(digest: dict[str, Any]) -> str:
    lines = [
        "Zen Stock Prophet Pro 朝の投資ニュース",
        "",
        f"配信時刻: {digest['generatedAt']}",
        "種別: ローカル投資シミュレーターの判断材料メール",
        "",
        "市況サマリー",
        f"- {digest['market']['summary']}",
    ]
    for item in digest["market"].get("items", []):
        change = item.get("changePct")
        change_text = "N/A" if change is None else f"{change:+.2f}%"
        price = item.get("price")
        price_text = "N/A" if price is None else f"{price:,.2f}"
        lines.append(f"- {item['label']}: {price_text} ({change_text})")

    lines.extend(["", "Watchlist 指値状況"])
    if digest["alerts"]:
        for item in digest["alerts"]:
            lines.extend(
                [
                    f"- {item['ticker']} {item['name']}: {item['severity']} / {item['timing']}",
                    f"  現在 ¥{item['price']:,.0f} / 指値 ¥{item['buyLimit']:,.0f} / 損切り ¥{item['stopLoss']:,.0f} / 利確 ¥{item['sellLimit']:,.0f}",
                ]
            )
    else:
        lines.append("- 今朝の時点で急ぎの指値接近アラートはありません。")

    lines.extend(["", "注目候補トップ"])
    for item in digest["candidates"][:6]:
        lines.append(
            f"- {item['ticker']} {item['name']}: {item['severity']} / 現在 ¥{item['price']:,.0f} / 指値 ¥{item['buyLimit']:,.0f} / AI確度 {item['confidence']}%"
        )

    lines.extend(["", "関連ニュース"])
    if digest["news"]:
        for group in digest["news"]:
            lines.append(f"- {group['ticker']} {group['name']}")
            if group["items"]:
                for news in group["items"]:
                    publisher = f" ({news['publisher']})" if news.get("publisher") else ""
                    url = f" {news['url']}" if news.get("url") else ""
                    lines.append(f"  - {news['title']}{publisher}{url}")
            else:
                lines.append("  - 新着ニュースは取得できませんでした。")
    else:
        lines.append("- ニュース取得対象がありませんでした。")

    lines.extend(
        [
            "",
            "注意: このメールは投資助言ではありません。売買判断と注文は必ず本人が行ってください。ライブ注文は無効です。",
        ]
    )
    return "\n".join(lines)


def build_daily_digest(
    stocks: dict[str, dict[str, Any]],
    get_stock_data: Callable[..., Any],
    analyzer: Any,
) -> dict[str, Any]:
    """Build an email-ready morning digest."""

    alert_report = build_watchlist_alert_report(stocks, get_stock_data, analyzer)
    top_for_news = alert_report["alerts"] or alert_report["candidates"][:5]
    news_groups = []
    for item in top_for_news[:5]:
        news_groups.append(
            {
                "ticker": item["ticker"],
                "name": item["name"],
                "items": fetch_symbol_news(item["ticker"], limit=3),
            }
        )

    generated_at = dt.datetime.now(JST).replace(microsecond=0).isoformat()
    subject_prefix = "指値接近あり" if alert_report["alerts"] else "通常監視"
    digest = {
        "schemaVersion": DIGEST_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "status": alert_report["status"],
        "market": alert_report["market"],
        "alerts": alert_report["alerts"],
        "candidates": alert_report["candidates"],
        "news": news_groups,
        "email": {
            "subject": f"[Zen Stock Prophet 朝刊] {subject_prefix} / 本日の投資ニュース",
            "body": "",
        },
        "liveBrokerOrdersEnabled": False,
    }
    digest["email"]["body"] = build_digest_body(digest)
    return digest
