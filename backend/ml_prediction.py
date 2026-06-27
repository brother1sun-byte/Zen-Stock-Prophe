"""Local ML verification support for Zen Stock Prophet Pro.

This module is intentionally conservative. It uses historical OHLCV data to
produce a verification aid for an already-selected candidate. It does not place
orders, connect to brokers, or promote a ticker based on probability alone.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

try:  # scikit-learn is optional at runtime; the app must fail safe without it.
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.inspection import permutation_importance
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
except Exception:  # pragma: no cover - exercised only on environments without sklearn
    LogisticRegression = None
    RandomForestClassifier = None
    StandardScaler = None
    make_pipeline = None
    permutation_importance = None


ML_HORIZON_DAYS = 5
MIN_TRAINING_SAMPLES = 70
MIN_VALIDATION_SAMPLES = 18
MARKET_SOURCES = {"yfinance", "yahoo chart", "yahoo_chart", "stooq", "j-quants delayed", "jquants delayed"}


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except Exception:
        return default


def _round(value: Any, digits: int = 2) -> float:
    return round(_finite(value), digits)


def _safe_status(label: str, warnings: list[str] | None = None, *, source: str = "unknown") -> dict[str, Any]:
    return {
        "roleLabel": "AI検証補助",
        "status": "insufficient",
        "label": label,
        "horizonDays": ML_HORIZON_DAYS,
        "probabilityUpPct": 0,
        "confidenceGrade": "insufficient",
        "confidenceLabel": "参考不足",
        "sampleCount": 0,
        "trainingSampleCount": 0,
        "walkForwardHitRatePct": 0,
        "baselineHitRatePct": 0,
        "edgePct": 0,
        "modelName": "local_sklearn",
        "sourcePolicy": {"source": source, "usableForMl": False},
        "topFeatures": [],
        "guardrails": [],
        "warnings": warnings or ["AI検証に必要な履歴が不足しています。"],
        "disclaimer": "AI検証補助は投資助言ではありません。候補を疑うための参考材料として扱ってください。",
    }


def _source_policy(hist: pd.DataFrame) -> dict[str, Any]:
    source = str(hist.attrs.get("source") or "unknown").strip() or "unknown"
    source_lower = source.lower()
    synthetic = bool(hist.attrs.get("synthetic") or source_lower == "synthetic")
    cached = bool(hist.attrs.get("cache") or hist.attrs.get("cached") or hist.attrs.get("is_cached") or source_lower == "cache")
    unknown = source_lower in {"", "unknown", "none"}
    delayed = "j-quants" in source_lower or "jquants" in source_lower
    usable = bool(not synthetic and not cached and not unknown and source_lower in MARKET_SOURCES)

    warnings: list[str] = []
    if synthetic:
        warnings.append("補完データのため、AI検証は参考表示に抑制しています。")
    if cached:
        warnings.append("一時保存データのため、最新価格と異なる可能性があります。")
    if delayed:
        warnings.append("J-Quants遅延データです。リアルタイム価格ではありません。")
    if unknown:
        warnings.append("データ出所を確認できないため、AI検証は参考扱いです。")

    return {
        "source": source,
        "synthetic": synthetic,
        "cached": cached,
        "delayed": delayed,
        "unknown": unknown,
        "usableForMl": usable,
        "warnings": warnings,
    }


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean().replace(0, np.nan)
    rs = gain / loss
    return (100 - (100 / (1 + rs))).fillna(50)


def _feature_frame(hist: pd.DataFrame, horizon_days: int) -> pd.DataFrame:
    frame = hist.copy()
    for column in ["Open", "High", "Low", "Close", "Volume"]:
        if column not in frame:
            frame[column] = frame["Close"] if "Close" in frame else 0
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    close = frame["Close"].replace(0, np.nan)
    volume = frame["Volume"].replace(0, np.nan)
    high = frame["High"].replace(0, np.nan)
    low = frame["Low"].replace(0, np.nan)
    prev_close = close.shift(1)
    true_range = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    sma5 = close.rolling(5).mean()
    sma20 = close.rolling(20).mean()
    sma60 = close.rolling(60).mean()
    volume20 = volume.rolling(20).mean()
    bollinger_mid = sma20
    bollinger_std = close.rolling(20).std()

    features = pd.DataFrame(index=frame.index)
    features["ret_1d"] = close.pct_change(1) * 100
    features["ret_5d"] = close.pct_change(5) * 100
    features["ret_20d"] = close.pct_change(20) * 100
    features["gap_pct"] = (frame["Open"] / prev_close - 1) * 100
    features["sma5_gap_pct"] = (close / sma5 - 1) * 100
    features["sma20_gap_pct"] = (close / sma20 - 1) * 100
    features["sma60_gap_pct"] = (close / sma60 - 1) * 100
    features["rsi14"] = _rsi(close)
    features["atr_pct"] = (true_range.rolling(14).mean() / close) * 100
    features["volume_ratio20"] = volume / volume20
    features["range_pct"] = (high / low - 1) * 100
    features["bollinger_width_pct"] = ((bollinger_std * 4) / bollinger_mid) * 100
    features["breakout_20d"] = (close / high.shift(1).rolling(20).max() - 1) * 100
    features["overheat_rsi"] = (features["rsi14"] > 76).astype(float)
    features["target_up"] = (close.shift(-horizon_days) > close).astype(int)
    return features.replace([np.inf, -np.inf], np.nan).dropna()


def _classifier():
    if LogisticRegression is None or make_pipeline is None or StandardScaler is None:
        return None
    return make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1200, class_weight="balanced", random_state=42),
    )


def _fit_predict_probability(model: Any, x_train: pd.DataFrame, y_train: pd.Series, x_latest: pd.DataFrame) -> float:
    model.fit(x_train, y_train)
    if hasattr(model, "predict_proba"):
        return float(model.predict_proba(x_latest)[0][1])
    decision = _finite(model.decision_function(x_latest)[0])
    return 1 / (1 + math.exp(-decision))


def _feature_importance(model: Any, x_train: pd.DataFrame, y_train: pd.Series) -> list[dict[str, Any]]:
    if permutation_importance is None or len(x_train) < 30:
        return []
    try:
        result = permutation_importance(model, x_train, y_train, n_repeats=4, random_state=42, scoring="accuracy")
    except Exception:
        return []
    pairs = sorted(
        zip(x_train.columns, result.importances_mean, strict=False),
        key=lambda item: abs(float(item[1])),
        reverse=True,
    )
    labels = {
        "ret_5d": "直近5日リターン",
        "ret_20d": "直近20日リターン",
        "volume_ratio20": "出来高倍率",
        "sma20_gap_pct": "20日線との距離",
        "rsi14": "RSI",
        "atr_pct": "ATR変動率",
        "breakout_20d": "20日高値更新度",
        "bollinger_width_pct": "ボリンジャー幅",
    }
    return [
        {"feature": name, "label": labels.get(name, name), "importance": _round(importance, 4)}
        for name, importance in pairs[:5]
        if abs(float(importance)) > 0
    ]


def build_ml_prediction(ticker: str, hist: pd.DataFrame, *, horizon_days: int = ML_HORIZON_DAYS) -> dict[str, Any]:
    """Build a leakage-aware local ML verification report."""
    policy = _source_policy(hist)
    source_warnings = list(policy["warnings"])
    if not policy["usableForMl"]:
        payload = _safe_status("参考表示", source_warnings, source=policy["source"])
        payload["status"] = "reference_only"
        payload["sourcePolicy"] = policy
        return payload

    if LogisticRegression is None:
        return _safe_status("参考不足", ["scikit-learn が利用できないため、AI検証を停止しました。"], source=policy["source"])

    if hist is None or hist.empty or "Close" not in hist:
        return _safe_status("データ不足", ["終値履歴が不足しているため、AI検証を実行できません。"], source=policy["source"])

    features = _feature_frame(hist, horizon_days)
    feature_columns = [column for column in features.columns if column != "target_up"]
    if len(features) < MIN_TRAINING_SAMPLES + MIN_VALIDATION_SAMPLES + 1:
        payload = _safe_status("データ不足", ["AI検証に必要な学習・検証期間が不足しています。"], source=policy["source"])
        payload["sampleCount"] = int(len(features))
        payload["sourcePolicy"] = policy
        return payload

    latest_row = features.iloc[[-1]][feature_columns]
    trainable = features.iloc[:-horizon_days].copy()
    if len(trainable) < MIN_TRAINING_SAMPLES + MIN_VALIDATION_SAMPLES:
        payload = _safe_status("データ不足", ["未来リターンを確定できる履歴が不足しています。"], source=policy["source"])
        payload["sampleCount"] = int(len(trainable))
        payload["sourcePolicy"] = policy
        return payload

    y = trainable["target_up"].astype(int)
    x = trainable[feature_columns]
    if y.nunique() < 2:
        payload = _safe_status("参考不足", ["上昇・下落の学習例が片側に偏っているため、AI検証を参考扱いにします。"], source=policy["source"])
        payload["sampleCount"] = int(len(trainable))
        payload["sourcePolicy"] = policy
        return payload

    validation_start = max(MIN_TRAINING_SAMPLES, len(trainable) - 60)
    predictions: list[int] = []
    actuals: list[int] = []
    probabilities: list[float] = []
    for index in range(validation_start, len(trainable)):
        x_train = x.iloc[:index]
        y_train = y.iloc[:index]
        if y_train.nunique() < 2:
            continue
        model = _classifier()
        if model is None:
            break
        probability = _fit_predict_probability(model, x_train, y_train, x.iloc[[index]])
        probabilities.append(probability)
        predictions.append(1 if probability >= 0.5 else 0)
        actuals.append(int(y.iloc[index]))

    if len(actuals) < MIN_VALIDATION_SAMPLES:
        payload = _safe_status("参考不足", ["ウォークフォワード検証の標本数が不足しています。"], source=policy["source"])
        payload["sampleCount"] = int(len(actuals))
        payload["trainingSampleCount"] = int(len(trainable))
        payload["sourcePolicy"] = policy
        return payload

    hit_rate = sum(1 for pred, actual in zip(predictions, actuals, strict=False) if pred == actual) / len(actuals) * 100
    baseline_up_rate = sum(actuals) / len(actuals) * 100
    baseline_hit_rate = max(baseline_up_rate, 100 - baseline_up_rate)
    edge = hit_rate - baseline_hit_rate

    final_model = _classifier()
    probability_up = _fit_predict_probability(final_model, x, y, latest_row) * 100
    top_features = _feature_importance(final_model, x.tail(120), y.tail(120))

    guardrails = [
        {"label": "検証標本が18件以上", "ok": len(actuals) >= MIN_VALIDATION_SAMPLES},
        {"label": "AI検証が単純基準を上回る", "ok": edge > 0},
        {"label": "補完・一時保存データではない", "ok": policy["usableForMl"]},
        {"label": "確率だけで買い判断にしない", "ok": True},
    ]

    warnings = source_warnings[:]
    if edge <= 0:
        warnings.append("ウォークフォワード検証で単純基準を上回っていません。候補の反証材料として扱ってください。")
    if len(actuals) < 30:
        warnings.append("検証標本が少ないため、確率の見え方を過信しないでください。")
    if probability_up >= 70:
        warnings.append("高い確率表示でも、寄り付き後の出来高・VWAP・撤退条件を必ず確認してください。")

    if edge <= 0:
        status = "contradiction"
        label = "反証あり"
        confidence = "weak"
        confidence_label = "参考注意"
    elif len(actuals) >= 30 and edge >= 4:
        status = "usable"
        label = "参考可"
        confidence = "moderate"
        confidence_label = "参考可"
    else:
        status = "review"
        label = "参考不足"
        confidence = "weak"
        confidence_label = "参考不足"

    return {
        "roleLabel": "AI検証補助",
        "ticker": ticker,
        "status": status,
        "label": label,
        "horizonDays": horizon_days,
        "probabilityUpPct": _round(probability_up, 1),
        "confidenceGrade": confidence,
        "confidenceLabel": confidence_label,
        "sampleCount": int(len(actuals)),
        "trainingSampleCount": int(len(trainable)),
        "walkForwardHitRatePct": _round(hit_rate, 1),
        "baselineHitRatePct": _round(baseline_hit_rate, 1),
        "edgePct": _round(edge, 1),
        "modelName": "local_logistic_regression",
        "sourcePolicy": policy,
        "topFeatures": top_features,
        "guardrails": guardrails,
        "warnings": warnings,
        "disclaimer": "AI検証補助は投資助言ではありません。候補を疑うための参考材料として扱ってください。",
    }
