"""Watchlist alert scoring for Zen Stock Prophet Pro.

This module turns the existing technical analysis output into a notification
packet. It never places orders; it only says whether a watched stock is close
enough to its planned limit price to deserve human review.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any, Callable


JST = dt.timezone(dt.timedelta(hours=9))
APP_NAME = "Zen Stock Prophet Pro"
ALERT_SCHEMA_VERSION = 1
DISPLAY_NAMES = {
    "4980.T": "デクセリアルズ",
    "4911.T": "資生堂",
    "1417.T": "ミライト・ワン",
    "8316.T": "三井住友フィナンシャルグループ",
    "8411.T": "みずほフィナンシャルグループ",
    "6861.T": "キーエンス",
    "1721.T": "コムシスホールディングス",
    "1801.T": "大成建設",
    "1893.T": "五洋建設",
    "7012.T": "川崎重工業",
    "1803.T": "清水建設",
    "8035.T": "東京エレクトロン",
    "7203.T": "トヨタ自動車",
    "6758.T": "ソニーグループ",
    "9984.T": "ソフトバンクグループ",
}


@dataclass(frozen=True)
class AlertPolicy:
    """Thresholds for deciding whether a watchlist item deserves an email."""

    near_entry_pct: float = 2.0
    high_confidence: int = 60
    max_alerts: int = 5


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def display_name(ticker: str, fallback: Any = None) -> str:
    return DISPLAY_NAMES.get(ticker, str(fallback or ticker))


def _latest_close(frame: Any) -> float | None:
    if frame is None or getattr(frame, "empty", True):
        return None
    close = frame["Close"]
    if close.empty:
        return None
    return float(close.iloc[-1])


def _daily_change_pct(frame: Any) -> float | None:
    if frame is None or getattr(frame, "empty", True) or len(frame) < 2:
        return None
    close = frame["Close"]
    prev = float(close.iloc[-2])
    latest = float(close.iloc[-1])
    if not prev:
        return None
    return round(((latest / prev) - 1) * 100, 2)


def build_market_context(get_stock_data: Callable[..., Any]) -> dict[str, Any]:
    """Return a small market backdrop from broad Japanese market proxies."""

    proxies = [
        ("^N225", "Nikkei 225"),
        ("^TOPX", "TOPIX"),
        ("JPY=X", "USD/JPY"),
    ]
    items: list[dict[str, Any]] = []
    for ticker, label in proxies:
        try:
            frame = get_stock_data(ticker, period="5d", interval="1d")
            items.append(
                {
                    "ticker": ticker,
                    "label": label,
                    "price": round(_latest_close(frame), 2) if _latest_close(frame) is not None else None,
                    "changePct": _daily_change_pct(frame),
                }
            )
        except Exception as exc:  # pragma: no cover - defensive runtime guard
            items.append({"ticker": ticker, "label": label, "price": None, "changePct": None, "error": str(exc)})

    equity_changes = [
        item["changePct"]
        for item in items
        if item["ticker"] in {"^N225", "^TOPX"} and item.get("changePct") is not None
    ]
    risk_off = bool(equity_changes) and all(change <= -1.5 for change in equity_changes)
    tone = "RISK_OFF" if risk_off else "NORMAL"
    summary = "日本株指数がそろって弱く、買い急ぎを抑える局面です。" if risk_off else "市況は通常監視です。個別銘柄の指値接近を優先します。"

    return {"tone": tone, "riskOff": risk_off, "summary": summary, "items": items}


def evaluate_stock_alert(
    ticker: str,
    stock_info: dict[str, Any],
    analysis: dict[str, Any],
    current_price: float,
    market_context: dict[str, Any],
    policy: AlertPolicy | None = None,
) -> dict[str, Any]:
    """Convert one stock analysis into alert severity and plain language."""

    policy = policy or AlertPolicy()
    execution = analysis.get("execution", {})
    strategy = analysis.get("strategy", {})
    confidence = int(_as_float(analysis.get("confidence")))
    buy_limit = _as_float(strategy.get("buy_limit"))
    stop_loss = _as_float(strategy.get("stop_loss"))
    sell_limit = _as_float(strategy.get("sell_limit"))
    rr_ratio = _as_float(strategy.get("rr_ratio"))
    decision = execution.get("decision") or "WATCH"

    entry_gap_pct = _as_float(execution.get("entryGapPct"))
    distance_to_limit_pct = ((current_price / buy_limit) - 1) * 100 if buy_limit else 999.0

    if decision == "BUY_LIMIT_OK" and confidence >= policy.high_confidence:
        severity = "ACTIONABLE"
        timing = "指値検討レンジ内"
        notify = True
    elif decision == "BUY_ON_PULLBACK":
        severity = "SOON" if 0 < distance_to_limit_pct <= policy.near_entry_pct else "WATCH"
        timing = f"\u8cb7\u3044\u5019\u88dc / \u6307\u5024\u307e\u3067\u7d04{distance_to_limit_pct:.1f}%"
        notify = severity == "SOON"
    elif decision == "WAIT_FOR_PULLBACK" and 0 < distance_to_limit_pct <= policy.near_entry_pct:
        severity = "SOON"
        timing = f"指値まで約{distance_to_limit_pct:.1f}%"
        notify = True
    elif decision == "WAIT_FOR_PULLBACK":
        severity = "WAIT"
        timing = f"指値まで約{distance_to_limit_pct:.1f}%"
        notify = False
    elif decision == "AVOID":
        severity = "AVOID"
        timing = "買い見送り"
        notify = False
    else:
        severity = "WATCH"
        timing = "監視継続"
        notify = False

    if market_context.get("riskOff") and severity in {"ACTIONABLE", "SOON"}:
        severity = "MARKET_CAUTION"
        timing = f"{timing} / 市況悪化のため慎重確認"
        notify = True

    return {
        "ticker": ticker,
        "name": display_name(ticker, stock_info.get("name", ticker)),
        "price": round(float(current_price), 1),
        "candidateScore": stock_info.get("candidate_score"),
        "signal": analysis.get("signal"),
        "confidence": confidence,
        "decision": decision,
        "severity": severity,
        "notify": notify,
        "timing": timing,
        "distanceToLimitPct": round(distance_to_limit_pct, 2),
        "entryGapPct": entry_gap_pct,
        "buyLimit": round(buy_limit, 1) if buy_limit else None,
        "stopLoss": round(stop_loss, 1) if stop_loss else None,
        "sellLimit": round(sell_limit, 1) if sell_limit else None,
        "rrRatio": round(rr_ratio, 2) if rr_ratio else None,
        "reason": analysis.get("reason"),
        "technicalSummary": analysis.get("technicalSummary"),
    }


def build_email_body(report: dict[str, Any]) -> str:
    """Create a concise Japanese email body for Gmail notifications."""

    lines = [
        f"{APP_NAME} Watchlist Alert",
        "",
        f"判定時刻: {report['checkedAt']}",
        f"通知レベル: {report['status']}",
        f"市況: {report['market']['summary']}",
        "",
    ]

    if report["alerts"]:
        lines.append("指値検討が近い銘柄")
        for item in report["alerts"]:
            lines.extend(
                [
                    "",
                    f"- {item['ticker']} {item['name']}",
                    f"  現在値: ¥{item['price']:,.0f} / 指値目安: ¥{item['buyLimit']:,.0f}",
                    f"  状態: {item['severity']} ({item['timing']})",
                    f"  利確目安: ¥{item['sellLimit']:,.0f} / 損切り: ¥{item['stopLoss']:,.0f} / RR: {item['rrRatio']}",
                    f"  AI確度: {item['confidence']}%",
                    f"  理由: {item['reason']}",
                ]
            )
    else:
        lines.append("現時点で、急いで確認すべき指値接近銘柄はありません。")

    lines.extend(
        [
            "",
            "全Watchlist上位",
        ]
    )
    for item in report["candidates"][:8]:
        lines.append(
            f"- {item['ticker']} {item['name']}: {item['severity']} / 現在¥{item['price']:,.0f} / 指値¥{item['buyLimit']:,.0f}"
        )

    lines.extend(
        [
            "",
            "注意: これはローカル投資シミュレーターの通知です。投資助言または自動発注ではありません。最終判断と注文は必ず本人が行ってください。",
        ]
    )
    return "\n".join(lines)


def build_watchlist_alert_report(
    stocks: dict[str, dict[str, Any]],
    get_stock_data: Callable[..., Any],
    analyzer: Any,
    policy: AlertPolicy | None = None,
) -> dict[str, Any]:
    """Analyze the current watchlist and return an email-ready report."""

    policy = policy or AlertPolicy()
    checked_at = dt.datetime.now(JST).replace(microsecond=0).isoformat()
    market_context = build_market_context(get_stock_data)

    candidates: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for ticker, info in stocks.items():
        try:
            frame = get_stock_data(ticker, period="3mo", interval="1d")
            current_price = _latest_close(frame)
            if current_price is None:
                errors.append({"ticker": ticker, "error": "price data unavailable"})
                continue
            prices = [float(price) for price in frame["Close"].tolist()]
            analysis = analyzer.analyze(prices, current_price)
            candidates.append(evaluate_stock_alert(ticker, info, analysis, current_price, market_context, policy))
        except Exception as exc:  # pragma: no cover - defensive runtime guard
            errors.append({"ticker": ticker, "error": str(exc)})

    severity_rank = {"ACTIONABLE": 0, "SOON": 1, "MARKET_CAUTION": 2, "WAIT": 3, "WATCH": 4, "AVOID": 5}
    candidates.sort(
        key=lambda item: (
            severity_rank.get(item["severity"], 9),
            abs(item["distanceToLimitPct"]),
            -(item.get("candidateScore") or 0),
        )
    )
    alerts = [item for item in candidates if item["notify"]][: policy.max_alerts]
    status = "ALERT" if alerts else "NO_ACTION"

    subject = (
        f"[Zen Stock Prophet] 指値接近 {len(alerts)}件"
        if alerts
        else "[Zen Stock Prophet] 指値接近なし"
    )
    report = {
        "schemaVersion": ALERT_SCHEMA_VERSION,
        "status": status,
        "checkedAt": checked_at,
        "policy": {"nearEntryPct": policy.near_entry_pct, "highConfidence": policy.high_confidence},
        "market": market_context,
        "alerts": alerts,
        "candidates": candidates,
        "errors": errors,
        "email": {"subject": subject, "body": ""},
        "liveBrokerOrdersEnabled": False,
    }
    report["email"]["body"] = build_email_body(report)
    return report
