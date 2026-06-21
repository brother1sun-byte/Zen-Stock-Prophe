from __future__ import annotations

import datetime as dt
from typing import Any, Callable

from market_fallbacks import choose_best_opportunities, ensure_market_snapshot


def build_market_rankings_response(
    *,
    kind: str,
    limit: int,
    budget: int,
    market_status: dict[str, Any],
    load_market_snapshot: Callable[[], dict[str, Any] | None],
    load_market_universe: Callable[[], dict[str, dict[str, Any]]],
    market_snapshot_items: Callable[[dict[str, Any] | None], list[dict[str, Any]]],
    market_context_freshness: Callable[[dict[str, Any] | None], dict[str, Any]],
    market_context_items_from_snapshot: Callable[[dict[str, Any] | None, dict[str, Any]], list[dict[str, Any]]],
    market_context_integrity: Callable[..., dict[str, Any]],
    attach_market_master_metadata: Callable[[list[dict[str, Any]]], list[dict[str, Any]]],
    market_quality_overlay: Callable[[dict[str, Any]], dict[str, Any]],
    attach_material_events: Callable[[list[dict[str, Any]]], list[dict[str, Any]]],
    attach_candidate_quality: Callable[[list[dict[str, Any]]], list[dict[str, Any]]],
    attach_market_relative_context: Callable[..., list[dict[str, Any]]],
    rank_with_material_refresh: Callable[..., list[dict[str, Any]]],
    attach_advanced_cross_engine_checks: Callable[..., list[dict[str, Any]]],
    rank_by_audited_opportunity: Callable[..., list[dict[str, Any]]],
    rank_market_items: Callable[[list[dict[str, Any]], str], list[dict[str, Any]]],
    select_best_ranked_opportunity: Callable[..., dict[str, Any] | None],
    select_best_available_opportunity: Callable[[list[dict[str, Any]], dict[str, Any] | None], dict[str, Any] | None],
    yahoo_finance_gainers: Callable[[int], list[dict[str, Any]]],
    data_source_flags: Callable[..., dict[str, Any]],
    json_safe: Callable[[dict[str, Any]], dict[str, Any]],
    fallback_candidate_pool: dict[str, dict[str, Any]],
    stocks: dict[str, dict[str, Any]],
    market_item_from_stock_payload: Callable[[dict[str, Any]], dict[str, Any]],
    stock_payload: Callable[[str, dict[str, Any]], dict[str, Any]],
    snapshot_payload: Callable[[list[dict[str, Any]], int, str], dict[str, Any]],
    yahoo_finance_gainers_url: str,
) -> dict[str, Any]:
    if kind == "gainers":
        try:
            yahoo_items = yahoo_finance_gainers(limit)
        except Exception:
            yahoo_items = []
        if yahoo_items:
            context_snapshot = load_market_snapshot()
            context_freshness = market_context_freshness(context_snapshot)
            context_items = market_context_items_from_snapshot(context_snapshot, context_freshness)
            context_integrity = market_context_integrity(
                context_snapshot,
                context_freshness,
                context_items,
                required=True,
                source_policy="yahoo_order_full_market_regime",
            )
            material_count = min(6, len(yahoo_items))
            yahoo_items = attach_market_master_metadata(yahoo_items)
            visible_items = [market_quality_overlay(item) for item in (attach_material_events(yahoo_items[:material_count]) + yahoo_items[material_count:])]
            visible_items = attach_candidate_quality(visible_items)
            visible_items = attach_market_relative_context(
                visible_items,
                context_items,
                fallback_to_items=False,
                context_integrity=context_integrity,
            )
            candidate_ranked = rank_with_material_refresh(
                visible_items,
                budget,
                preserve_rank=True,
                refresh_limit=min(limit, 12),
            )
            candidate_ranked = attach_advanced_cross_engine_checks(
                candidate_ranked,
                limit=min(limit, 3),
                budget_jpy=budget,
            )
            candidate_ranked = rank_by_audited_opportunity(candidate_ranked, preserve_rank=True)
            best_source, best_available = choose_best_opportunities(
                candidate_ranked,
                select_best_ranked_opportunity=select_best_ranked_opportunity,
                select_best_available_opportunity=select_best_available_opportunity,
            )
            yahoo_ordered_items = sorted(candidate_ranked, key=lambda item: float(item.get("siteRank") or item.get("rank") or 999999))
            return json_safe({
                "kind": kind,
                "budgetJpy": budget,
                "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "source": yahoo_finance_gainers_url,
                "provider": "Yahoo Finance Japan gainers ranking",
                "universeCount": 0,
                "analyzedCount": len(yahoo_items),
                "marketContextProvider": context_snapshot.get("provider") if context_snapshot else None,
                "marketContextCount": len(context_items),
                "marketContextGeneratedAt": context_freshness.get("generatedAt"),
                "marketContextAgeDays": context_freshness.get("ageDays"),
                "marketContextStale": context_freshness.get("stale"),
                "marketContextIntegrity": context_integrity,
                "marketStatus": market_status,
                "bestOpportunity": best_source,
                "bestAvailableOpportunity": best_available,
                "items": yahoo_ordered_items,
            })

    snapshot = ensure_market_snapshot(
        load_market_snapshot(),
        fallback_candidate_pool=fallback_candidate_pool,
        stocks=stocks,
        load_market_universe=load_market_universe,
        market_item_from_stock_payload=market_item_from_stock_payload,
        stock_payload=stock_payload,
        snapshot_payload=snapshot_payload,
    )
    rankings = snapshot.get("rankings") or {}
    items = [market_quality_overlay(item) for item in (rankings.get(kind) or [])]
    if kind in {"surge", "breakout", "popular", "volume", "quality", "overheat"}:
        items = rank_market_items(items, kind)
    context_source = market_snapshot_items(snapshot)
    candidate_pool = items[: min(len(items), max(limit * 3, limit, 30))]
    visible_raw = candidate_pool
    material_count = min(6, len(visible_raw))
    visible_items = attach_material_events(visible_raw[:material_count]) + visible_raw[material_count:]
    visible_items = attach_candidate_quality(visible_items)
    visible_items = attach_market_relative_context(visible_items, context_source)
    ranked_enriched_items = rank_with_material_refresh(
        visible_items,
        budget,
        refresh_limit=min(limit, 12),
    )
    ranked_enriched_items = attach_advanced_cross_engine_checks(
        ranked_enriched_items,
        limit=min(limit, 3),
        budget_jpy=budget,
    )
    ranked_enriched_items = rank_by_audited_opportunity(ranked_enriched_items)
    visible_ranked_items = ranked_enriched_items[:limit]
    best_source, best_available = choose_best_opportunities(
        ranked_enriched_items,
        select_best_ranked_opportunity=select_best_ranked_opportunity,
        select_best_available_opportunity=select_best_available_opportunity,
    )
    return json_safe({
        "kind": kind,
        "budgetJpy": budget,
        "generatedAt": snapshot.get("generatedAt"),
        "source": snapshot.get("source"),
        "provider": snapshot.get("provider"),
        **data_source_flags(snapshot.get("source"), cached=bool(snapshot.get("isCached") or snapshot.get("is_cached") or snapshot.get("cache"))),
        "universeCount": snapshot.get("universeCount", 0),
        "analyzedCount": snapshot.get("analyzedCount", 0),
        "marketStatus": market_status,
        "bestOpportunity": best_source,
        "bestAvailableOpportunity": best_available,
        "items": visible_ranked_items,
    })
