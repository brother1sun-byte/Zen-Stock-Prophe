from __future__ import annotations

import datetime as dt
from typing import Any, Callable

from fastapi import HTTPException


def build_portfolio_response(
    *,
    init_db: Callable[[], None],
    get_db: Callable[[], Any],
    get_stock_data: Callable[..., Any],
    candidate_data_quality: Callable[..., dict[str, Any]],
    data_source_flags: Callable[..., dict[str, Any]],
    portfolio_market_context: Callable[[], dict[str, Any]],
    build_exit_plan: Callable[..., dict[str, Any]],
    finite: Callable[[Any], float],
    stocks: dict[str, dict[str, Any]],
    fallback_candidate_pool: dict[str, dict[str, Any]],
    portfolio_active: str,
    portfolio_closed_statuses: tuple[str, ...],
    initial_cash: float,
) -> dict[str, Any]:
    init_db()
    conn = get_db()
    row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    holdings = conn.execute("SELECT * FROM holdings WHERE shares > 0 AND status = ? ORDER BY updated_at DESC", (portfolio_active,)).fetchall()
    archived_holdings = conn.execute(
        """
        SELECT * FROM holdings
        WHERE status IN (?, ?, ?)
        ORDER BY COALESCE(closed_at, updated_at) DESC, ticker ASC
        LIMIT 20
        """,
        portfolio_closed_statuses,
    ).fetchall()
    conn.close()

    cash = float(row["cash"]) if row else initial_cash
    holding_items = []
    total_value = 0.0
    total_cost = 0.0
    market_context = portfolio_market_context()
    for holding in holdings:
        ticker = holding["ticker"]
        info = stocks.get(ticker) or fallback_candidate_pool.get(ticker) or {"name": ticker}
        hist = get_stock_data(ticker, period="6mo", interval="1d")
        if hist is not None and not hist.empty:
            price = finite(hist["Close"].iloc[-1])
            data_quality = candidate_data_quality(hist, hist["Close"].tolist(), hist["Volume"].tolist())
        else:
            price = finite(holding["avg_cost"])
            data_quality = candidate_data_quality(None)
        source_flags = data_source_flags(hist.attrs.get("source", "unknown") if hist is not None else "unknown", data_quality)
        shares = int(holding["shares"])
        avg_cost = finite(holding["avg_cost"])
        value = price * holding["shares"]
        entry_notional = avg_cost * shares
        pnl = value - entry_notional
        pnl_pct = (pnl / entry_notional * 100) if entry_notional else 0
        total_value += value
        total_cost += entry_notional
        name = holding["manual_name"] or info.get("name", ticker)
        holding_items.append({
            "ticker": ticker,
            "name": name,
            "emoji": info.get("emoji", "JP"),
            "shares": shares,
            "status": holding["status"],
            "avgCost": round(avg_cost, 1),
            "entryNotional": round(entry_notional, 1),
            "price": round(price, 1),
            "currentPrice": round(price, 1),
            "dataQuality": data_quality,
            **source_flags,
            "value": round(value, 1),
            "pnl": round(pnl, 1),
            "pnlPct": round(pnl_pct, 2),
            "updatedAt": holding["updated_at"],
            "closedAt": holding["closed_at"],
            "lifecycleReason": holding["lifecycle_reason"],
            "exitPlan": build_exit_plan(
                ticker=ticker,
                shares=shares,
                avg_cost=avg_cost,
                hist=hist,
                market_context=market_context,
            ),
        })

    archived_items = []
    for holding in archived_holdings:
        ticker = holding["ticker"]
        info = stocks.get(ticker) or fallback_candidate_pool.get(ticker) or {"name": ticker}
        archived_items.append({
            "ticker": ticker,
            "name": holding["manual_name"] or info.get("name", ticker),
            "emoji": info.get("emoji", "JP"),
            "shares": int(holding["shares"] or 0),
            "avgCost": round(finite(holding["avg_cost"]), 1),
            "status": holding["status"],
            "updatedAt": holding["updated_at"],
            "closedAt": holding["closed_at"],
            "lifecycleReason": holding["lifecycle_reason"],
        })

    history = [{"date": str((dt.date.today() - dt.timedelta(days=idx)).isoformat()), "value": initial_cash + idx * 1500} for idx in range(30, 0, -1)]
    total_assets = cash + total_value
    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else 0
    return {
        "cash": round(cash, 1),
        "holdings": holding_items,
        "archivedHoldings": archived_items,
        "totalAssets": round(total_assets, 1),
        "totalPnl": round(total_pnl, 1),
        "totalPnlPct": round(total_pnl_pct, 2),
        "initialCash": initial_cash,
        "marketContext": market_context,
        "history": history,
    }


def record_manual_position(
    request: Any,
    *,
    normalize_portfolio_ticker: Callable[[Any], str],
    finite: Callable[[Any], float],
    init_db: Callable[[], None],
    get_db: Callable[[], Any],
    initial_cash: float,
) -> dict[str, Any]:
    ticker = normalize_portfolio_ticker(request.ticker)
    shares = int(request.shares or 0)
    entry_price = finite(request.entryPrice)
    if not ticker:
      raise HTTPException(status_code=400, detail="ticker is required")
    if shares <= 0:
      raise HTTPException(status_code=400, detail="shares must be positive")
    if entry_price <= 0:
      raise HTTPException(status_code=400, detail="entryPrice must be positive")

    init_db()
    conn = get_db()
    existing = conn.execute("SELECT shares, avg_cost FROM holdings WHERE ticker = ?", (ticker,)).fetchone()
    current_shares = int(existing["shares"]) if existing else 0
    current_avg = finite(existing["avg_cost"]) if existing else 0
    next_shares = current_shares + shares
    next_avg = ((current_shares * current_avg) + (shares * entry_price)) / next_shares
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO holdings (ticker, shares, avg_cost, manual_name, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
            shares = excluded.shares,
            avg_cost = excluded.avg_cost,
            manual_name = COALESCE(excluded.manual_name, holdings.manual_name),
            status = 'ACTIVE',
            lifecycle_reason = NULL,
            closed_at = NULL,
            updated_at = excluded.updated_at
        """,
        (ticker, next_shares, next_avg, request.name, now),
    )
    row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
    cash = float(row["cash"]) if row else initial_cash
    total = shares * entry_price
    conn.execute("UPDATE portfolio SET cash = ?", (max(cash - total, 0),))
    conn.execute(
        "INSERT INTO transactions (ticker, action, shares, price, total, reason) VALUES (?, ?, ?, ?, ?, ?)",
        (ticker, "MANUAL_BUY", shares, entry_price, total, request.note or "manual portfolio entry"),
    )
    conn.execute(
        "INSERT INTO agent_logs (message) VALUES (?)",
        (f"手入力の保有記録を保存しました: {ticker} {shares}株、取得価格 {entry_price:.1f}円。シミュレーション専用であり、証券会社へ注文は送信されません。",),
    )
    conn.commit()
    conn.close()
    return {
        "success": True,
        "mode": "SIMULATOR_ONLY",
        "message": f"{ticker} を {shares}株、{entry_price:.1f}円で練習台帳に記録しました。証券会社への注文送信は行っていません。",
        "ticker": ticker,
        "shares": next_shares,
        "avgCost": round(next_avg, 1),
    }


def close_portfolio_position(
    ticker: str,
    request: Any,
    *,
    normalize_portfolio_ticker: Callable[[Any], str],
    finite: Callable[[Any], float],
    init_db: Callable[[], None],
    get_db: Callable[[], Any],
    portfolio_closed_statuses: set[str],
    portfolio_active: str,
    portfolio_sold: str,
    portfolio_voided: str,
    portfolio_archived: str,
    initial_cash: float,
) -> dict[str, Any]:
    normalized = normalize_portfolio_ticker(ticker)
    action = (request.action or "").strip().upper()
    if action not in portfolio_closed_statuses:
        raise HTTPException(status_code=400, detail="action must be SOLD, VOIDED, or ARCHIVED")

    init_db()
    conn = get_db()
    holding = conn.execute("SELECT * FROM holdings WHERE ticker = ?", (normalized,)).fetchone()
    if not holding or int(holding["shares"] or 0) <= 0:
        conn.close()
        raise HTTPException(status_code=404, detail="active holding not found")
    if holding["status"] != portfolio_active:
        conn.close()
        raise HTTPException(status_code=409, detail="holding is already closed")

    shares = int(holding["shares"])
    avg_cost = finite(holding["avg_cost"])
    close_price = finite(request.price) if request.price is not None else avg_cost
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    reason = (request.reason or "").strip()
    if not reason:
        reason = {
            portfolio_sold: "sold outside simulator; retained as ledger history",
            portfolio_voided: "mistaken manual entry; retained as correction history",
            portfolio_archived: "no longer needed in active portfolio; retained as ledger history",
        }[action]

    if action == portfolio_sold:
        sale_total = max(close_price, 0) * shares
        row = conn.execute("SELECT cash FROM portfolio ORDER BY id DESC LIMIT 1").fetchone()
        cash = float(row["cash"]) if row else initial_cash
        conn.execute("UPDATE portfolio SET cash = ?", (cash + sale_total,))
        tx_action = "MANUAL_SELL"
        tx_price = close_price
        tx_total = sale_total
    elif action == portfolio_voided:
        tx_action = "MANUAL_VOID"
        tx_price = avg_cost
        tx_total = avg_cost * shares
    else:
        tx_action = "MANUAL_ARCHIVE"
        tx_price = avg_cost
        tx_total = avg_cost * shares

    conn.execute(
        """
        UPDATE holdings
        SET status = ?, shares = 0, lifecycle_reason = ?, closed_at = ?, updated_at = ?
        WHERE ticker = ?
        """,
        (action, reason, now, now, normalized),
    )
    conn.execute(
        "INSERT INTO transactions (ticker, action, shares, price, total, reason) VALUES (?, ?, ?, ?, ?, ?)",
        (normalized, tx_action, shares, tx_price, tx_total, reason),
    )
    conn.execute(
        "INSERT INTO agent_logs (message) VALUES (?)",
        (f"保有銘柄 {normalized} を {action} として練習台帳に記録しました。証券会社への注文送信は行っていません。",),
    )
    conn.commit()
    conn.close()
    return {
        "success": True,
        "mode": "SIMULATOR_ONLY",
        "message": f"{normalized} position closed in local simulator only.",
        "ticker": normalized,
        "status": action,
    }
