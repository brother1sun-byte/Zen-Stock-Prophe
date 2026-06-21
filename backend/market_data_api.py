from __future__ import annotations

from typing import Any, Callable


def build_market_universe_response(
    *,
    load_market_universe: Callable[[], dict[str, dict[str, Any]]],
    load_market_snapshot: Callable[[], dict[str, Any] | None],
    market_snapshot_items: Callable[[dict[str, Any] | None], list[dict[str, Any]]],
    market_search_item: Callable[[str, dict[str, Any], dict[str, Any] | None], dict[str, Any]],
    universe_source: str,
) -> dict[str, Any]:
    universe = load_market_universe()
    market_counts: dict[str, int] = {}
    sector_counts: dict[str, int] = {}
    for info in universe.values():
        market = info.get("market_section") or "Unknown"
        sector = info.get("sector") or "Unknown"
        market_counts[market] = market_counts.get(market, 0) + 1
        sector_counts[sector] = sector_counts.get(sector, 0) + 1

    snapshot = load_market_snapshot()
    snapshot_items = market_snapshot_items(snapshot)
    sample = [
        market_search_item(
            item["ticker"],
            universe.get(
                item["ticker"],
                {
                    "name": item.get("name", item["ticker"]),
                    "market_section": item.get("marketSection", ""),
                    "sector": item.get("sector", ""),
                },
            ),
            item,
        )
        for item in snapshot_items[:12]
        if item.get("ticker")
    ]
    if not sample:
        sample = [market_search_item(ticker, info, None) for ticker, info in list(universe.items())[:12]]

    return {
        "count": len(universe),
        "source": universe_source,
        "provider": "JPX listed issue master",
        "markets": sorted(market_counts.items(), key=lambda item: item[1], reverse=True)[:12],
        "sectors": sorted(sector_counts.items(), key=lambda item: item[1], reverse=True)[:24],
        "sample": sample,
        "snapshot": {
            "generatedAt": snapshot.get("generatedAt") if snapshot else None,
            "analyzedCount": snapshot.get("analyzedCount") if snapshot else 0,
            "provider": snapshot.get("provider") if snapshot else None,
        },
    }


def build_market_search_response(
    *,
    query: str,
    market: str,
    sector: str,
    limit: int,
    load_market_universe: Callable[[], dict[str, dict[str, Any]]],
    load_market_snapshot: Callable[[], dict[str, Any] | None],
    market_snapshot_items: Callable[[dict[str, Any] | None], list[dict[str, Any]]],
    hydrate_market_search_prices: Callable[[list[tuple[str, dict[str, Any]]], dict[str, dict[str, Any]]], list[dict[str, Any]]],
) -> dict[str, Any]:
    universe = load_market_universe()
    query_lower = query.strip().lower()
    market_filter = market.strip().lower()
    sector_filter = sector.strip().lower()
    snapshot = load_market_snapshot() or {}
    snapshot_list = market_snapshot_items(snapshot)
    snapshot_items = {item["ticker"]: item for item in snapshot_list if item.get("ticker")}
    ordered_tickers = [item["ticker"] for item in snapshot_list if item.get("ticker")]

    if not query_lower and not market_filter and not sector_filter and ordered_tickers:
        seen = set(ordered_tickers)
        universe_entries = [
            (ticker, universe[ticker])
            for ticker in ordered_tickers
            if ticker in universe
        ] + [
            (ticker, info)
            for ticker, info in universe.items()
            if ticker not in seen
        ]
    else:
        universe_entries = list(universe.items())

    matched_entries = []
    for ticker, info in universe_entries:
        haystack = " ".join([
            ticker,
            ticker.replace(".T", ""),
            str(info.get("name", "")),
            str(info.get("market_section", "")),
            str(info.get("sector", "")),
        ]).lower()
        if query_lower and query_lower not in haystack:
            continue
        if market_filter and market_filter not in str(info.get("market_section", "")).lower():
            continue
        if sector_filter and sector_filter not in str(info.get("sector", "")).lower():
            continue
        matched_entries.append((ticker, info))
        if len(matched_entries) >= limit:
            break

    results = hydrate_market_search_prices(matched_entries, snapshot_items)
    return {"query": query, "count": len(results), "items": results}
