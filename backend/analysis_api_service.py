from __future__ import annotations

from typing import Any, Callable

from fastapi import HTTPException


def build_preopen_analysis_response(
    *,
    ticker: str,
    info: dict[str, Any],
    material_events_for_ticker: Callable[..., dict[str, Any]],
    preopen_for_ticker: Callable[..., dict[str, Any] | None],
) -> dict[str, Any]:
    material = material_events_for_ticker(ticker, info.get("name", ticker), include_jquants=True)
    report = preopen_for_ticker(
        ticker,
        info,
        optional_feeds={
            "materialAvailable": material.get("materialAvailable"),
            "materialScore": material.get("materialScore"),
        },
    )
    if report is None:
        raise HTTPException(status_code=503, detail="Pre-open scoring engine unavailable")
    return {**report, "material": material}


def build_advanced_analysis_response(
    *,
    ticker: str,
    get_stock_data: Callable[..., Any],
    build_advanced_report: Callable[..., dict[str, Any]] | None,
    initial_cash: float,
) -> dict[str, Any]:
    if build_advanced_report is None:
        raise HTTPException(status_code=503, detail="Advanced analysis engine unavailable")

    hist = get_stock_data(ticker, period="1y", interval="1d")
    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail="No stock data")

    try:
        return build_advanced_report(ticker, hist, capital_jpy=initial_cash, risk_pct=1.0)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
