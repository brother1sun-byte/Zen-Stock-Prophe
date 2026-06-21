from __future__ import annotations

from typing import Any, Callable


def _has_rows(frame: Any) -> bool:
    return frame is not None and not getattr(frame, "empty", True)


def fetch_price_history(
    *,
    ticker: str,
    period: str,
    interval: str,
    yfinance_history: Callable[[str, str, str], Any],
    yahoo_chart_history: Callable[[str], Any],
    stooq_history: Callable[[str], Any],
    synthetic_history: Callable[[str], Any],
    clean_price_history: Callable[[Any], Any],
) -> Any:
    try:
        hist = clean_price_history(yfinance_history(ticker, period, interval))
        if _has_rows(hist):
            hist.attrs["source"] = "yfinance"
            hist.attrs["synthetic"] = False
            return hist
    except Exception:
        pass

    hist = yahoo_chart_history(ticker)
    if _has_rows(hist):
        hist.attrs["source"] = hist.attrs.get("source") or "yahoo_chart"
        hist.attrs["synthetic"] = False
        return hist

    hist = stooq_history(ticker)
    if _has_rows(hist):
        hist.attrs["source"] = hist.attrs.get("source") or "stooq_free_api"
        hist.attrs["synthetic"] = False
        return hist

    hist = synthetic_history(ticker)
    hist.attrs["source"] = "synthetic"
    hist.attrs["synthetic"] = True
    return hist
