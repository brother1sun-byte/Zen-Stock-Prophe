"""
Local autopilot for opening-gap daytrade signal generation.

The loop is fully automatic for local paper signal generation and audit state.
It never connects to a broker, RPA, Rakuten, MarketSpeed, or live orders.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from daytrade_engine import sample_signals


class DaytradeAutopilot:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.running = False
        self.mode = "PAPER_AUTO"
        self.interval_sec = 60
        self.started_at: str | None = None
        self.last_scan_at: str | None = None
        self.last_source = "NOT_STARTED"
        self.last_ready = 0
        self.last_rejected = 0
        self.last_error: str | None = None
        self.cycles = 0
        self.order_intents_path: str | None = None

    def start(self, mode: str = "PAPER_AUTO", interval_sec: int = 60) -> dict[str, Any]:
        with self._lock:
            if self.running:
                return self.status()
            self.mode = mode
            self.interval_sec = max(5, int(interval_sec))
            self.started_at = dt.datetime.now().isoformat(timespec="seconds")
            self.last_error = None
            self._stop.clear()
            self.running = True
            self._thread = threading.Thread(target=self._run, name="DaytradeAutopilot", daemon=True)
            self._thread.start()
            return self.status()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._stop.set()
            self.running = False
            return self.status()

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "mode": self.mode,
            "intervalSec": self.interval_sec,
            "startedAt": self.started_at,
            "lastScanAt": self.last_scan_at,
            "lastSource": self.last_source,
            "lastReady": self.last_ready,
            "lastRejected": self.last_rejected,
            "lastError": self.last_error,
            "cycles": self.cycles,
            "orderIntentsPath": self.order_intents_path,
            "liveOrdersEnabled": False,
            "verdict": "自動運用はローカルの練習ログだけです。証券会社連携は無効です。",
        }

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.scan_once()
            except Exception as exc:  # pragma: no cover - defensive loop guard
                self.last_error = str(exc)
            self._stop.wait(self.interval_sec)
        self.running = False

    def scan_once(self) -> dict[str, Any]:
        source = "LOCAL_PAPER_SIMULATION"
        signals = sample_signals()
        self._persist_signals(signals, source)

        ready = sum(1 for signal in signals if signal.get("state") == "READY")
        rejected = sum(1 for signal in signals if signal.get("state") == "REJECTED")

        with self._lock:
            self.last_scan_at = dt.datetime.now().isoformat(timespec="seconds")
            self.last_source = source
            self.last_ready = ready
            self.last_rejected = rejected
            self.last_error = None
            self.cycles += 1
            self.order_intents_path = None

        return {
            "source": source,
            "signals": signals,
            "orderIntentsPath": None,
            "ready": ready,
            "rejected": rejected,
        }

    def _persist_signals(self, signals: list[dict[str, Any]], source: str) -> None:
        conn = sqlite3.connect(self.db_path)
        for signal in signals:
            conn.execute(
                """
                INSERT INTO daytrade_signals (
                    state, mode, ticker, name, side, strategy, limit_price, shares,
                    risk_jpy, take_profit, stop_loss, expires_at, book_ratio,
                    spread_pct, vwap_deviation_pct, ml_probability, gap_pct,
                    atr_pct, volume_rank, has_news, reject_reasons, reason, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    signal["state"],
                    signal["mode"],
                    signal["ticker"],
                    signal["name"],
                    signal["side"],
                    signal["strategy"],
                    signal["limitPrice"],
                    signal["shares"],
                    signal["riskJpy"],
                    signal["takeProfit"],
                    signal["stopLoss"],
                    signal["expiresAt"],
                    signal["bookRatio"],
                    signal["spreadPct"],
                    signal["vwapDeviationPct"],
                    signal["mlProbability"],
                    signal["gapPct"],
                    signal["atrPct"],
                    signal["volumeRank"],
                    1 if signal["hasNews"] else 0,
                    json.dumps(signal["rejectReasons"], ensure_ascii=False),
                    signal["reason"],
                    source,
                ),
            )
        conn.commit()
        conn.close()


AUTOPILOT: DaytradeAutopilot | None = None


def get_autopilot(db_path: str) -> DaytradeAutopilot:
    global AUTOPILOT
    if AUTOPILOT is None:
        AUTOPILOT = DaytradeAutopilot(db_path)
    return AUTOPILOT
