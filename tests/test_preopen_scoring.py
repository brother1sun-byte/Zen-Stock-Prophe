from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from preopen_scoring import build_preopen_report


def _history(rows: int = 80, *, volume: int = 600_000, hot: bool = False) -> pd.DataFrame:
    dates = pd.date_range("2026-01-01", periods=rows, freq="B")
    data = []
    price = 1000.0
    for idx, date in enumerate(dates):
        drift = 2.0 if hot else 0.8
        price += drift + math.sin(idx / 4) * 1.5
        open_price = price * 0.995
        high = price * (1.045 if hot and idx > rows - 12 else 1.012)
        low = price * 0.988
        close = price * (1.035 if hot and idx > rows - 8 else 1.0)
        data.append({"Date": date, "Open": open_price, "High": high, "Low": low, "Close": close, "Volume": volume + idx * 2500})
    frame = pd.DataFrame(data).set_index("Date")
    frame.attrs["source"] = "unit_test"
    return frame


def test_preopen_report_excludes_missing_pts_and_news_boosts():
    report = build_preopen_report("6503.T", _history(), company_name="テスト銘柄")

    assert report["dataLeakGuard"]["usesOnlyPreopenSafeInputs"] is True
    assert "current_session_high" in report["dataLeakGuard"]["forbiddenInputsExcluded"]
    assert "pts_or_preopen_board" in report["dataLeakGuard"]["unavailableInputs"]
    assert "news_disclosure" in report["dataLeakGuard"]["unavailableInputs"]
    assert report["scoreBreakdown"]["material"] == 0
    assert report["scoreBreakdown"]["indicationPts"] == 0
    assert report["decisionLabel"] in {"高騰候補", "監視候補", "リスク確認"}


def test_preopen_report_does_not_promote_hot_chart_when_material_feeds_missing():
    report = build_preopen_report("6503.T", _history(hot=True), company_name="テスト銘柄")

    assert report["decision"] != "SURGE_CANDIDATE"
    assert report["decisionLabel"] in {"監視候補", "リスク確認"}
    assert "news_disclosure" in report["dataLeakGuard"]["unavailableInputs"]
    assert "pts_or_preopen_board" in report["dataLeakGuard"]["unavailableInputs"]
    assert any("寄り付き後" in item for item in report["watchPoints"])
    assert "投資助言ではなく" in report["disclaimer"]


def test_preopen_report_adds_explicit_risk_deduction():
    low_liquidity = _history(volume=5_000)
    low_liquidity["Volume"] = 5_000
    report = build_preopen_report("9999.T", low_liquidity)

    labels = {flag["label"] for flag in report["riskFlags"]}
    assert "流動性注意" in labels
    assert report["riskDeduction"] > 0
    assert report["scoreBreakdown"]["riskDeduction"] == report["riskDeduction"]


def test_preopen_report_flags_synthetic_history():
    synthetic = _history()
    synthetic.attrs["source"] = "synthetic"
    synthetic.attrs["synthetic"] = True

    report = build_preopen_report("4980.T", synthetic)

    assert report["dataLeakGuard"]["usesSyntheticHistory"] is True
    assert any(flag["id"] == "synthetic_history" for flag in report["riskFlags"])
    assert report["decision"] != "SURGE_CANDIDATE"


class PreopenScoringUnittest(unittest.TestCase):
    def test_missing_pts_and_news_boosts_are_excluded(self):
        test_preopen_report_excludes_missing_pts_and_news_boosts()

    def test_hot_chart_without_material_feeds_is_not_promoted(self):
        test_preopen_report_does_not_promote_hot_chart_when_material_feeds_missing()

    def test_explicit_risk_deduction_is_reported(self):
        test_preopen_report_adds_explicit_risk_deduction()

    def test_synthetic_history_is_reference_only(self):
        test_preopen_report_flags_synthetic_history()
