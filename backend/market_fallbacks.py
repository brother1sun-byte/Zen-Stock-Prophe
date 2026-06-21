from __future__ import annotations

from typing import Any, Callable


def ensure_market_snapshot(
    snapshot: dict[str, Any] | None,
    *,
    fallback_candidate_pool: dict[str, dict[str, Any]],
    stocks: dict[str, dict[str, Any]],
    load_market_universe: Callable[[], dict[str, dict[str, Any]]],
    market_item_from_stock_payload: Callable[[dict[str, Any]], dict[str, Any]],
    stock_payload: Callable[[str, dict[str, Any]], dict[str, Any]],
    snapshot_payload: Callable[[list[dict[str, Any]], int, str], dict[str, Any]],
) -> dict[str, Any]:
    if snapshot:
        return snapshot
    fallback_universe = {**fallback_candidate_pool, **stocks}
    live_items = [
        market_item_from_stock_payload(stock_payload(ticker, info))
        for ticker, info in fallback_universe.items()
    ]
    universe = load_market_universe()
    return snapshot_payload(live_items, len(universe), "live_watchlist_fallback")


def choose_best_opportunities(
    ranked_items: list[dict[str, Any]],
    *,
    select_best_ranked_opportunity: Callable[..., dict[str, Any] | None],
    select_best_available_opportunity: Callable[[list[dict[str, Any]], dict[str, Any] | None], dict[str, Any] | None],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    require_cross_engine_best = any(
        item.get("advancedCrossEngineCheck") or (item.get("intradayOpportunity") or {}).get("advancedCrossEngineCheck")
        for item in ranked_items
    )
    best_source = select_best_ranked_opportunity(
        ranked_items,
        require_cross_engine_check=require_cross_engine_best,
    )
    best_available = select_best_available_opportunity(ranked_items, best_source)
    return best_source, best_available
