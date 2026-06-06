"""Commute-friendly daytrade routine planning.

This module converts a simulator-only intraday analysis report into a practical
evening, commute, and workday monitoring checklist. It never places orders.
"""

from __future__ import annotations

from typing import Any


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number
    except Exception:
        return default


def _round(value: Any, digits: int = 2) -> float:
    return round(_num(value), digits)


def _ok(label: str, ok: bool, detail: str) -> dict[str, Any]:
    return {"label": label, "ok": bool(ok), "detail": detail}


def _routine_verdict(analysis: dict[str, Any]) -> tuple[str, str]:
    score = _num(analysis.get("score"))
    rr = _num((analysis.get("levels") or {}).get("riskReward"))
    fakeouts = analysis.get("fakeoutFilters") or []
    event_verdict = ((analysis.get("indicators") or {}).get("eventRisk") or {}).get("verdict")
    walk_verdict = (analysis.get("walkForward") or {}).get("verdict")

    if event_verdict == "BLOCK":
        return "SKIP", "決算・重要材料リスクが強いため、翌朝の手動注文候補から外します。"
    if score >= 68 and rr >= 1.4 and len(fakeouts) <= 1 and walk_verdict != "UNSTABLE_OR_WEAK":
        return "PRIMARY_REVIEW", "帰宅後に候補へ残し、翌朝の気配とスプレッドが崩れていなければ手動注文を検討します。"
    if score >= 58 and rr >= 1.25 and len(fakeouts) <= 1:
        return "SECONDARY_REVIEW", "条件は一部満たしますが、翌朝の寄り付き直後に再確認してから判断します。"
    if score >= 45:
        return "WATCH_ONLY", "候補監視には残しますが、翌朝の手動注文は条件改善がない限り見送り寄りです。"
    return "SKIP", "短期強弱が弱く、翌朝の手動注文候補から外します。"


def build_commute_daytrade_routine(analysis: dict[str, Any]) -> dict[str, Any]:
    """Build a manual trading routine from a daytrade analysis payload."""

    if not analysis:
        raise ValueError("analysis is required")
    levels = analysis.get("levels") or {}
    indicators = analysis.get("indicators") or {}
    micro = indicators.get("microstructure") or {}
    event_risk = indicators.get("eventRisk") or {}
    backtest = analysis.get("backtest") or {}
    walk_forward = analysis.get("walkForward") or {}
    fakeouts = analysis.get("fakeoutFilters") or []

    ticker = str(analysis.get("ticker") or "")
    score = _num(analysis.get("score"))
    entry = _num(levels.get("entryCandidate"))
    target = _num(levels.get("takeProfitCandidate"))
    stop = _num(levels.get("stopLossCandidate"))
    rr = _num(levels.get("riskReward"))
    spread_pct = _num(micro.get("spreadPct"), 999)
    atr_pct = _num(indicators.get("atrPct"))
    win_rate = _num(backtest.get("winRatePct"))
    max_dd = _num(backtest.get("maxDrawdownPct"))
    stability = _num(walk_forward.get("stabilityPct"))
    warning_price = entry + max(target - entry, 0) * 0.75 if target > entry else target
    invalidation_price = max(stop, entry * 0.985) if entry > 0 else stop
    verdict, summary = _routine_verdict(analysis)
    manual_order_ok = verdict in {"PRIMARY_REVIEW", "SECONDARY_REVIEW"}

    evening_checks = [
        _ok("候補に残す条件", verdict != "SKIP", summary),
        _ok("翌朝の上限価格を決める", entry > 0, f"手動注文の上限目安: {entry:.0f}円以下。"),
        _ok("利確と撤退を先に決める", target > entry > stop > 0, f"利確 {target:.0f}円 / 撤退 {stop:.0f}円 / RR {rr:.2f}。"),
        _ok("材料リスクを確認する", event_risk.get("verdict") != "BLOCK", event_risk.get("latestTitle") or "重要材料は未確認。翌朝も確認。"),
        _ok("翌朝見る指標を絞る", True, "スコア、VWAP、スプレッド、出来高、寄り付き後の値持ちだけ確認します。"),
    ]
    commute_checks = [
        _ok("手動注文候補", manual_order_ok, "アプリは注文しません。証券アプリで本人が最終確認します。"),
        _ok("価格が上限以内", entry > 0, f"成行ではなく、目安は {entry:.0f}円以下。大きく上なら見送り。"),
        _ok("スプレッド許容", spread_pct <= 0.15, f"現在/推定スプレッド {spread_pct:.3f}%。広い場合は見送り。"),
        _ok("騙し条件が少ない", len(fakeouts) <= 1, f"騙しフィルター {len(fakeouts)}件。"),
        _ok("バックテスト確認", win_rate > 0, f"勝率 {win_rate:.1f}% / 最大DD {max_dd:.2f}% / 安定 {stability:.1f}%。"),
    ]
    work_checks = [
        _ok("利確通知ライン", target > 0, f"{target:.0f}円付近なら手動売却を確認。"),
        _ok("利確接近ライン", warning_price > 0, f"{warning_price:.0f}円を超えたら仕事の合間に確認頻度を上げる。"),
        _ok("撤退ライン", stop > 0, f"{stop:.0f}円を下回るなら損失拡大を避ける判断を優先。"),
        _ok("無効化ライン", invalidation_price > 0, f"{invalidation_price:.0f}円割れ、VWAP割れ、出来高失速は見送り/撤退寄り。"),
        _ok("確認頻度", True, "高ボラなら30分ごと、通常は昼休み・14時台・大引け前を重点確認。"),
    ]

    priority = "HIGH" if verdict == "PRIMARY_REVIEW" else "MEDIUM" if verdict == "SECONDARY_REVIEW" else "LOW"
    if atr_pct >= 2.5 or spread_pct > 0.3:
        priority = "LOW" if priority == "MEDIUM" else priority

    return {
        "ticker": ticker,
        "sourceInterval": analysis.get("interval"),
        "routineMode": "MANUAL_COMMUTE_DAYTRADE",
        "simulatorOnly": True,
        "liveBrokerOrdersEnabled": False,
        "verdict": verdict,
        "priority": priority,
        "summary": summary,
        "mobileSummary": {
            "orderUpperLimit": _round(entry),
            "takeProfit": _round(target),
            "stopLoss": _round(stop),
            "warningPrice": _round(warning_price),
            "score": _round(score, 1),
            "riskReward": _round(rr, 2),
        },
        "phases": [
            {
                "id": "evening",
                "label": "帰宅後",
                "purpose": "翌朝見る候補を絞り、手動注文の上限・利確・撤退を先に決める。",
                "checks": evening_checks,
            },
            {
                "id": "commute",
                "label": "翌朝の電車",
                "purpose": "スマホで最終確認し、条件が崩れていなければ本人が証券アプリで手動注文を検討する。",
                "checks": commute_checks,
            },
            {
                "id": "work_monitor",
                "label": "仕事中",
                "purpose": "頻繁に見続けなくても、利確接近・撤退・無効化ラインだけを短時間で確認する。",
                "checks": work_checks,
            },
        ],
        "manualOnlyNotice": "この画面は手動判断用のチェックリストです。証券口座への注文送信や自動売却は行いません。",
    }
