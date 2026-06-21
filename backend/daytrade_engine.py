"""
Opening-gap daytrade planning engine.

This module is intentionally broker-free: it creates local paper-review signal
tickets only. It does not connect to Rakuten, MarketSpeed, RPA, or live orders.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import math
from typing import Any


CAPITAL_JPY = 1_000_000
RISK_PER_TRADE_PCT = 0.02
MAX_POSITION_NOTIONAL_PCT = 0.30
MAX_POSITIONS = 3
MAX_CONSECUTIVE_LOSSES = 3
MIN_GAP_ABS_PCT = 3.0
MIN_BOOK_RATIO = 1.5
MAX_SPREAD_PCT = 0.15
MAX_QUOTE_AGE_SEC = 2.0
ENTRY_WINDOW_MINUTES = 5
TAKE_PROFIT_PCT = 1.0
STOP_LOSS_PCT = 0.5
ORDER_TIMEOUT_SEC = 20
LOT_SIZE = 100


@dataclasses.dataclass(frozen=True)
class BoardSnapshot:
    ticker: str
    best_bid: float
    best_ask: float
    bid_depth_5: int
    ask_depth_5: int
    quote_age_sec: float
    vwap: float
    last_price: float
    special_quote: bool = False

    @property
    def mid(self) -> float:
        return (self.best_bid + self.best_ask) / 2

    @property
    def spread_pct(self) -> float:
        if self.mid <= 0:
            return 999
        return (self.best_ask - self.best_bid) / self.mid * 100

    @property
    def book_ratio(self) -> float:
        return self.bid_depth_5 / max(self.ask_depth_5, 1)

    @property
    def vwap_deviation_pct(self) -> float:
        if self.vwap <= 0:
            return 999
        return (self.last_price - self.vwap) / self.vwap * 100


def round_to_tick(price: float) -> float:
    """Simplified TSE tick rounding for planning. Production should use the full tick table."""
    if price < 1_000:
        tick = 0.1
    elif price < 3_000:
        tick = 0.5
    elif price < 10_000:
        tick = 1
    elif price < 30_000:
        tick = 5
    else:
        tick = 10
    return math.floor(price / tick) * tick


def limit_buy_price(board: BoardSnapshot) -> float:
    # Base rule: best bid -0.05%, never crossing the spread.
    return round_to_tick(board.best_bid * 0.9995)


def position_size(price: float, equity: float = CAPITAL_JPY) -> int:
    max_notional = equity * MAX_POSITION_NOTIONAL_PCT
    raw_shares = int(max_notional // max(price, 1))
    return (raw_shares // LOT_SIZE) * LOT_SIZE


def strategy_direction(gap_pct: float) -> str:
    if gap_pct >= MIN_GAP_ABS_PCT:
        return "GAP_UP_PULLBACK"
    if gap_pct <= -MIN_GAP_ABS_PCT:
        return "GAP_DOWN_REVERSAL"
    return "NO_TRADE"


def validate_entry(
    *,
    gap_pct: float,
    board: BoardSnapshot,
    has_news: bool,
    atr_pct: float,
    volume_rank: int,
    ml_probability: float,
    minutes_after_open: float,
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    direction = strategy_direction(gap_pct)

    if direction == "NO_TRADE":
        reasons.append(f"gap_abs_below_{MIN_GAP_ABS_PCT_pct_label()}")
    if volume_rank > 100:
        reasons.append("volume_rank_over_100")
    if not has_news:
        reasons.append("no_today_news")
    if atr_pct < 1.5:
        reasons.append("atr_below_1.5pct")
    if board.special_quote:
        reasons.append("special_quote")
    if board.quote_age_sec > MAX_QUOTE_AGE_SEC:
        reasons.append("stale_board")
    if board.spread_pct > MAX_SPREAD_PCT:
        reasons.append("spread_too_wide")
    if board.book_ratio < MIN_BOOK_RATIO:
        reasons.append("book_ratio_below_1.5")
    if minutes_after_open > ENTRY_WINDOW_MINUTES:
        reasons.append("entry_window_expired")

    min_probability = 0.58 if direction == "GAP_UP_PULLBACK" else 0.60
    if ml_probability < min_probability:
        reasons.append("ml_probability_low")

    if abs(board.vwap_deviation_pct) > 0.20:
        reasons.append("not_near_vwap")

    return not reasons, reasons


def MIN_GAP_ABS_PCT_pct_label() -> str:
    return f"{MIN_GAP_ABS_PCT:.1f}pct"


def build_signal_ticket(
    *,
    ticker: str,
    name: str,
    gap_pct: float,
    board: BoardSnapshot,
    has_news: bool,
    atr_pct: float,
    volume_rank: int,
    ml_probability: float,
    minutes_after_open: float,
    mode: str = "MANUAL_SIGNAL",
) -> dict[str, Any]:
    valid, reject_reasons = validate_entry(
        gap_pct=gap_pct,
        board=board,
        has_news=has_news,
        atr_pct=atr_pct,
        volume_rank=volume_rank,
        ml_probability=ml_probability,
        minutes_after_open=minutes_after_open,
    )
    strategy = strategy_direction(gap_pct)
    limit_price = limit_buy_price(board)
    shares = position_size(limit_price)
    now = dt.datetime.now()

    return {
        "state": "READY" if valid else "REJECTED",
        "mode": mode,
        "ticker": ticker,
        "name": name,
        "side": "BUY",
        "strategy": strategy,
        "limitPrice": limit_price,
        "shares": shares if valid else 0,
        "riskJpy": round(limit_price * max(shares, 0) * STOP_LOSS_PCT / 100),
        "takeProfit": round_to_tick(limit_price * (1 + TAKE_PROFIT_PCT / 100)),
        "stopLoss": round_to_tick(limit_price * (1 - STOP_LOSS_PCT / 100)),
        "expiresAt": (now + dt.timedelta(seconds=ORDER_TIMEOUT_SEC)).strftime("%H:%M:%S"),
        "bookRatio": round(board.book_ratio, 2),
        "spreadPct": round(board.spread_pct, 3),
        "vwapDeviationPct": round(board.vwap_deviation_pct, 3),
        "mlProbability": round(ml_probability, 3),
        "gapPct": round(gap_pct, 2),
        "atrPct": round(atr_pct, 2),
        "volumeRank": volume_rank,
        "hasNews": has_news,
        "rejectReasons": reject_reasons,
        "reason": (
            f"{strategy}: gap {gap_pct:+.2f}%, volume rank {volume_rank}, "
            f"book {board.book_ratio:.2f}x, spread {board.spread_pct:.3f}%, "
            f"VWAP dev {board.vwap_deviation_pct:+.3f}%, ML {ml_probability:.0%}."
        ),
    }


def plan() -> dict[str, Any]:
    return {
        "premise": "No Rakuten or MarketSpeed integration is used. Short-term checks are local paper simulations only.",
        "modes": [
            {
                "id": "PAPER_REVIEW",
                "label": "Paper review",
                "description": "Python records a local review ticket. It is not sent to an order screen or broker.",
                "externalWrite": False,
            },
        ],
        "rules": {
            "gapAbsPct": MIN_GAP_ABS_PCT,
            "volumeRankTop": 100,
            "requiresTodayNews": True,
            "minAtrPct": 1.5,
            "minBookRatio": MIN_BOOK_RATIO,
            "maxSpreadPct": MAX_SPREAD_PCT,
            "maxQuoteAgeSec": MAX_QUOTE_AGE_SEC,
            "entryWindowMinutes": ENTRY_WINDOW_MINUTES,
            "takeProfitPct": TAKE_PROFIT_PCT,
            "stopLossPct": STOP_LOSS_PCT,
            "orderTimeoutSec": ORDER_TIMEOUT_SEC,
            "riskPerTradePct": RISK_PER_TRADE_PCT * 100,
            "maxPositions": MAX_POSITIONS,
            "maxConsecutiveLosses": MAX_CONSECUTIVE_LOSSES,
        },
        "brokerIntegration": {
            "enabled": False,
            "provider": None,
            "reason": "User scope excludes Rakuten Securities and MarketSpeed integration.",
        },
    }


def sample_signals() -> list[dict[str, Any]]:
    samples = [
        {
            "ticker": "4980.T",
            "name": "デクセリアルズ",
            "gap_pct": 3.8,
            "board": BoardSnapshot("4980.T", 2480, 2482, 92000, 51000, 0.7, 2479, 2481),
            "has_news": True,
            "atr_pct": 2.3,
            "volume_rank": 42,
            "ml_probability": 0.64,
            "minutes_after_open": 3,
        },
        {
            "ticker": "7203.T",
            "name": "トヨタ自動車",
            "gap_pct": -3.4,
            "board": BoardSnapshot("7203.T", 3000, 3002, 210000, 120000, 1.1, 3001, 3001),
            "has_news": True,
            "atr_pct": 1.8,
            "volume_rank": 8,
            "ml_probability": 0.61,
            "minutes_after_open": 4,
        },
        {
            "ticker": "6758.T",
            "name": "ソニーグループ",
            "gap_pct": 2.2,
            "board": BoardSnapshot("6758.T", 3120, 3124, 30000, 42000, 0.9, 3122, 3123),
            "has_news": False,
            "atr_pct": 1.2,
            "volume_rank": 66,
            "ml_probability": 0.55,
            "minutes_after_open": 2,
        },
    ]
    return [build_signal_ticket(**item) for item in samples]


def signals_from_board_rows(rows: list[dict[str, Any]], mode: str = "MANUAL_SIGNAL") -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    for row in rows:
        board = BoardSnapshot(
            ticker=row["ticker"],
            best_bid=row["best_bid"],
            best_ask=row["best_ask"],
            bid_depth_5=row["bid_depth_5"],
            ask_depth_5=row["ask_depth_5"],
            quote_age_sec=row["quote_age_sec"],
            vwap=row["vwap"],
            last_price=row["last_price"],
            special_quote=row["special_quote"],
        )
        signals.append(
            build_signal_ticket(
                ticker=row["ticker"],
                name=row["name"] or row["ticker"],
                gap_pct=row["gap_pct"],
                board=board,
                has_news=row["has_news"],
                atr_pct=row["atr_pct"],
                volume_rank=row["volume_rank"],
                ml_probability=row["ml_probability"],
                minutes_after_open=row["minutes_after_open"],
                mode=mode,
            )
        )
    return signals


def risk_state() -> dict[str, Any]:
    return {
        "capitalJpy": CAPITAL_JPY,
        "riskPerTradeJpy": round(CAPITAL_JPY * RISK_PER_TRADE_PCT),
        "maxPositionNotionalJpy": round(CAPITAL_JPY * MAX_POSITION_NOTIONAL_PCT),
        "maxPositions": MAX_POSITIONS,
        "maxConsecutiveLosses": MAX_CONSECUTIVE_LOSSES,
        "liveOrderMode": "disabled",
        "jobsVerdict": "証券会社連携は無効です。練習用の確認記録としてのみ扱います。",
    }
