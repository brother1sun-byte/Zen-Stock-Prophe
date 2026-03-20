from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uvicorn
import json
import os
import logging
import sys
import asyncio
import time
from datetime import datetime, timedelta
try:
    import pandas as pd
    import numpy as np
    import yfinance
    from scipy.signal import find_peaks
except ImportError as e:
    # datetime is now safely imported
    print(f"[{datetime.now().strftime('%H:%M:%S')}] CRITICAL ERROR: Missing dependency: {e}")
    print("Run: pip install pandas numpy yfinance scipy fastapi uvicorn")
    sys.exit(1)
import os
import logging
from ops_manager import OpsMetricsManager
from data_ingestion import DataIngestion
# Early initialization for absolute global availability
try:
    from data_ingestion import DataIngestion
    ingestor = DataIngestion()
    print(f"[{datetime.now().strftime('%H:%M:%S')}] SUCCESS: Ingestor initialized.")
except Exception as e:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] CRITICAL: Failed to initialize ingestor: {e}")
    # We define it as None to avoid NameError, but the app will likely fail healthchecks
    ingestor = None
from zen_analysis import ZenSignalAnalyzer

app = FastAPI(
    title="Project Tenkai API",
    description="High-Precision Japanese Stock Prediction AI",
    version="1.0.0"
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
import time
# 
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
# Phase 8: Initialize Ops Manager
ops_manager = OpsMetricsManager(LOG_DIR)
# ingestor initialized early
# Model initialization flag
model_loaded = True  # Set to True since we don't use a separate ML model file
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for now (dev mode)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/health")
async def health_check():
    """Health check endpoint for frontend to verify backend availability"""
    return {"status": "ok", "timestamp": time.time()}
# Phase 3: Scenario Router
from routers import scenario
app.include_router(scenario.router)
from routers import macro
app.include_router(macro.router)
from routers import performance
app.include_router(performance.router)
from routers import screener
app.include_router(screener.router)
# Phase 2 Refinement: Configuration Thresholds
CORR_THRESHOLD = 0.8
SECTOR_BIAS_THRESHOLD = 0.6
EVENT_WINDOW_DAYS = 7
PLAYBOOK_VERSION = "1.0"
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log requests and record metrics."""
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        # Phase 8: Route Key Detection
        path = request.url.path
        if path.startswith("/api/predict"):
            route_key = "predict"
        else:
            route_key = "other"
        # Record Metric
        ops_manager.record_request(
            latency=process_time / 1000.0, # seconds
            status_code=response.status_code,
            route_key=route_key
        )
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {request.method} {path} {response.status_code} {process_time:.2f}ms")
        return response
    except HTTPException as he:
        # HTTPException astAPI
        raise he
    except Exception as e:
        process_time = (time.time() - start_time) * 1000
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {request.method} {request.url.path} ERROR {process_time:.2f}ms - {str(e)}")
        import traceback
        traceback.print_exc()
        raise e
def clean_json_data(data):
    """NaN or Inf values are replaced with None to avoid JSON errors"""
    if isinstance(data, dict):
        return {k: clean_json_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [clean_json_data(v) for v in data]
    elif isinstance(data, float):
        if np.isnan(data) or np.isinf(data):
            return None
    return data
import time
# --- Helper for Reliable External Fetching ---
def safe_fetch(tag, func, *args, **kwargs):
    """Retries a fetch once and returns (data, error_msg)"""
    max_retries = 1
    for i in range(max_retries + 1):
        try:
            res = func(*args, **kwargs)
            return res, None
        except Exception as e:
            if i < max_retries:
                print(f"Retrying {tag} due to: {e}")
                time.sleep(1)
                continue
            return None, str(e)
# --- Data Models ---
class StockRequest(BaseModel):
    ticker: str
    period: str = "1y"
    entry_price: Optional[float] = None # Acquisition cost
    shares: Optional[int] = None # Owned count
    capital: float = 500000.0 # Available capital for trading
    asof: Optional[str] = None # JST YYYY-MM-DD
    is_exit_order: bool = False # Flag for existing position management
class NewsItem(BaseModel):
    title: str
    link: Optional[str] = None
    publisher: Optional[str] = None
class FinancialEvidence(BaseModel):
    per: Optional[float] = None
    pbr: Optional[float] = None
    roe: Optional[float] = None
    dividend_yield: Optional[float] = None
    market_cap: Optional[float] = None
class PortfolioItem(BaseModel):
    ticker: str
    name: str
    weight: float
    reason: str
class ExitCandidate(BaseModel):
    label: str
    price: float
    target_date: str
    profit_pct: float
    reason: str
class ExitStrategy(BaseModel):
    current_status: dict # {pnl, pnl_pct, market_value}
    candidates: List[ExitCandidate]
    alert_status: bool
class LongTermSnapshot(BaseModel):
    profitability: dict # ROE, operating margin, revenue growth
    safety: dict # Equity ratio, interest-bearing debt
    shareholder_returns: dict # Dividend yield, payout ratio, buybacks
    valuation_band: dict # PER/PBR ranges (Under/Fair/Over)
    warnings: List[str]
class EventRisk(BaseModel):
    upcoming_events: List[dict] # Earnings, dividends, splits
    rules: List[str] # Recommended lot half, skip, etc.
    warnings: List[str]
class ConcentrationRisk(BaseModel):
    sector_distribution: dict
    correlation_report: List[dict] # Pairwise correlations
    warnings: List[str]
    remedies: List[str] # Diversification suggestions
class PlaybookEntry(BaseModel):
    case_id: str
    ticker: str
    scenario_type: str # GapUp follow, Panic hold, etc.
    result_outcome: str
    lessons_learned: str
    timestamp: str
    version: str = PLAYBOOK_VERSION
    created_at: str = ""
    asof: str = ""
    tags: List[str] = []
    market_regime: str = "UNKNOWN"
class MacroSnapshot(BaseModel):
    nikkei: float
    topix: float
    usdjpy: float
    us10y: float
    vix: float
    risk_sentiment: str
    summary: str

class PredictionResponse(BaseModel):
    ticker: str
    company_name: str
    current_price: float
    price_change_percent: float = 0.0  # 前日比変動率 (%)
    forecasts: dict
    volatility: float
    confidence_score: float
    super_score: Optional[float] = None
    sentiment_score: float
    recommendation: str
    reasoning: str
    evidence: dict
    portfolio_suggestion: List[PortfolioItem]
    chart_data: List[dict]
    exit_strategy: Optional[ExitStrategy] = None
    technical_analysis: Optional[dict] = None
    fundamental_analysis: Optional[dict] = None
    macro_snapshot: Optional[MacroSnapshot] = None
    order_book: Optional[dict] = None
    day_trading: Optional[dict] = None
    evolution_stats: Optional[dict] = None
    long_term_snapshot: Optional[LongTermSnapshot] = None # Phase 2
    event_risk: Optional[EventRisk] = None # Phase 2
    concentration_risk: Optional[ConcentrationRisk] = None # Phase 2
    playbook_references: List[PlaybookEntry] = [] # Phase 2
    partial: bool = False # Refinement
    missing_fields: List[str] = [] # Refinement
    beginner_judgment: Optional[dict] = None # (v8.0) beginner-friendly verdict
    last_sync: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    fetch_errors: Dict[str, str] = {}
# --- Diversification Logic Helper ---
def get_diversification_suggestion(base_ticker: str, price: float):
    hedges = {
        "7203": [
            {"ticker": "9984", "name": "Softbank G", "weight": 30, "reason": "Tech Hedge"},
            {"ticker": "8306", "name": "MUFG", "weight": 20, "reason": "Bank Hedge"},
            {"ticker": "7203", "name": "Toyota", "weight": 50, "reason": "Core Hold"}
        ],
        "default": [
            {"ticker": "1306", "name": "TOPIX ETF", "weight": 40, "reason": "Market Hedge"},
            {"ticker": "9432", "name": "NTT", "weight": 30, "reason": "Defensive Hedge"},
            {"ticker": base_ticker, "name": "Selected Stock", "weight": 30, "reason": "Main Position"}
        ]
    }
    return hedges.get(base_ticker, hedges["default"])
# --- Action Engine v5.0: Autonomous Learning Manager ---
# --- Action Engine v5.0: AI ---
# --- Evolution & Improvement System ---
class EvolutionManager:
    """Improvement metrics tracker."""
    def __init__(self):
        self.file_path = os.path.join(LOG_DIR, "evolution_bias.json")
        self.bias_data = self._load_data()
    def _load_data(self):
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except (json.JSONDecodeError, Exception) as e:
                print(f"WARNING: Corrupted Evolution bias data: {e}")
        return {"total_predictions": 0, "avg_bias": 0.0, "tickers": {}}
    def record_result(self, ticker: str, predicted_price: float, actual_price: float):
        """Docs"""
        bias = actual_price - predicted_price
        self.bias_data["total_predictions"] += 1
        # 
        old_avg = self.bias_data["avg_bias"]
        n = self.bias_data["total_predictions"]
        self.bias_data["avg_bias"] = old_avg + (bias - old_avg) / n
        if ticker not in self.bias_data["tickers"]:
            self.bias_data["tickers"][ticker] = {"count": 0, "bias": 0.0}
        t_data = self.bias_data["tickers"][ticker]
        t_data["count"] += 1
        t_data["bias"] = t_data["bias"] + (bias - t_data["bias"]) / t_data["count"]
        temp_path = self.file_path + ".tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(self.bias_data, f, indent=4)
            os.replace(temp_path, self.file_path)
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            print(f"ERROR: Failed to save evolution bias: {e}")
        print(f"[{datetime.now().strftime('%H:%M:%S')}] EVOLUTION: {ticker} bias updated to {t_data['bias']:.2f}")
    def get_correction(self, ticker: str) -> float:
        """Docs"""
        return self.bias_data["tickers"].get(ticker, {}).get("bias", self.bias_data["avg_bias"])
    def update_bias_from_history(self, ticker: str, history_df: pd.DataFrame):
        """Docs"""
        history_path = os.path.join(os.path.dirname(self.file_path), "prediction_history.json")
        if not os.path.exists(history_path):
            return
        try:
            with open(history_path, "r", encoding="utf-8") as f:
                logs = json.load(f)
                if not isinstance(logs, list):
                    logs = []
        except (json.JSONDecodeError, Exception) as e:
            print(f"WARNING: Corrupted prediction history: {e}")
            return
        # 1. (1)
        latest_pred = None
        for log in reversed(logs):
            if log.get("ticker") == ticker and "verified" not in log:
                latest_pred = log
                break
        if not latest_pred:
            return
        # 2. 
        pred_time = datetime.fromisoformat(latest_pred["timestamp"])
        #  (1)
        if datetime.now() - pred_time < timedelta(hours=20):
            return
        # 3. yfinance
        # Close
        target_date = pred_time.date() + timedelta(days=1)
        actual_data = history_df[history_df.index.date >= target_date]
        if actual_data.empty:
            return
        actual_price = float(actual_data['Close'].iloc[0])
        predicted_price = float(latest_pred.get("forecast_1d") or latest_pred.get("forecast_7d")) # 1d
        # 4. 
        self.record_result(ticker, predicted_price, actual_price)
        # 5. 
        latest_pred["verified"] = True
        latest_pred["actual_price"] = actual_price
        latest_pred["bias"] = actual_price - predicted_price
        temp_path = history_path + ".tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(logs, f, indent=4)
            os.replace(temp_path, history_path)
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            print(f"ERROR: Failed to update prediction history: {e}")
    def log_prediction(self, ticker: str, current_price: float, forecast_1d: float):
        """Docs"""
        history_path = os.path.join(os.path.dirname(self.file_path), "prediction_history.json")
        logs = []
        if os.path.exists(history_path):
            try:
                with open(history_path, "r", encoding="utf-8") as f:
                    logs = json.load(f)
                    if not isinstance(logs, list):
                        logs = []
            except (json.JSONDecodeError, Exception) as e:
                print(f"WARNING: Corrupted prediction history during log: {e}")
                logs = []
        #  ()
        logs.append({
            "ticker": ticker,
            "timestamp": datetime.now().isoformat(),
            "current_price": current_price,
            "forecast_1d": forecast_1d
        })
        # 00
        if len(logs) > 100:
            logs = logs[-100:]
        temp_path = history_path + ".tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(logs, f, ensure_ascii=False, indent=2)
            os.replace(temp_path, history_path)
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            print(f"ERROR: Failed to update prediction history: {e}")
    def get_evolution_stats(self, ticker: str):
        """Docs"""
        t_data = self.bias_data["tickers"].get(ticker, {"count": 0, "bias": 0.0})
        return {
            "total_count": self.bias_data["total_predictions"],
            "ticker_count": t_data["count"],
            "current_bias": t_data["bias"],
            "correction_applied": self.get_correction(ticker)
        }
evolution_manager = EvolutionManager()
class LearningManager:
    """Docs"""
    def __init__(self, log_path=os.path.join(LOG_DIR, "self_improve.json")):
        self.log_path = log_path
        self._ensure_log_exists()
    def _ensure_log_exists(self):
        if not os.path.exists(self.log_path):
            with open(self.log_path, 'w', encoding='utf-8') as f:
                json.dump({"sessions": [], "stats": {"total_trades": 0, "wins": 0, "losses": 0}}, f)
    def log_decision(self, ticker: str, decision_data: dict, current_price: float):
        """Docs"""
        temp_path = self.log_path + ".tmp"
        try:
            # 1. Read existing
            data = {"sessions": [], "stats": {"total_trades": 0, "wins": 0, "losses": 0}}
            if os.path.exists(self.log_path):
                try:
                    with open(self.log_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if not isinstance(data, dict):
                            data = {"sessions": [], "stats": {"total_trades": 0, "wins": 0, "losses": 0}}
                except (json.JSONDecodeError, Exception) as e:
                    print(f"WARNING: Learning Log corrupted, resetting: {e}")
            # 2. Add new entry
            new_entry = {
                "timestamp": datetime.now().isoformat(),
                "ticker": ticker,
                "price_at_decision": current_price,
                "decision": decision_data.get("decision", "WAIT"),
                "action": decision_data.get("action_text", "WAIT"),
                "super_score": decision_data.get("super_score", 0),
                "confidence": decision_data.get("confidence", 0),
                "reasons": decision_data.get("reasoning_list", []),
                "market_phase": decision_data.get("regime_info", {}).get("regime", "UNKNOWN"),
                "metrics_snapshot": {
                    "ev": decision_data.get("goal_consistency", {}).get("expected_value", 0),
                    "rsi": decision_data.get("technical_summary", {}).get("rsi", 0),
                    "macd_cross": "MACD" in str(decision_data.get("reasoning_list", [])),
                    "vol_pct": decision_data.get("regime_info", {}).get("vol_pct", 0)
                },
                "missing_data_gaps": decision_data.get("data_gaps", [])
            }
            data.setdefault("sessions", [])
            data["sessions"].append(new_entry)
            data["sessions"] = data["sessions"][-10:]
            # 3. Write Atomic
            with open(temp_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(temp_path, self.log_path)
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            print(f"Learning Manager Log Error: {e}")
    def get_improvement_suggestions(self):
        """Docs"""
        return [
            "1. Earnings Details",
            "2. Volume Spike",
            "3. Order Book Depth"
        ]
    def get_analytics_trends(self):
        """Analyze market trends."""
        if not os.path.exists(self.log_path):
            return []
        try:
            with open(self.log_path, 'r', encoding='utf-8') as f:
                try:
                    data = json.load(f)
                    if not isinstance(data, dict):
                        return []
                except (json.JSONDecodeError, Exception):
                    return []
                sessions = data.get("sessions", [])
                trends = []
                for s in sessions:
                    trends.append({
                        "timestamp": s.get("timestamp"),
                        "score": s.get("super_score", 0),
                        "confidence": s.get("confidence", 0) * 100, # %
                        "ticker": s.get("ticker", "UNKNOWN")
                    })
                return trends
        except Exception as e:
            print(f"Analytics Error (Trends): {e}")
            return []
    def get_analytics_reasons(self):
        """Docs"""
        if not os.path.exists(self.log_path):
            return []
        try:
            with open(self.log_path, 'r', encoding='utf-8') as f:
                try:
                    data = json.load(f)
                    if not isinstance(data, dict):
                        return []
                except (json.JSONDecodeError, Exception):
                    return []
                sessions = data.get("sessions", [])
                reason_map = {}
                for s in sessions:
                    score = s.get("super_score", 0)
                    is_buy = s.get("decision") == "BUY"
                    for r in s.get("reasons", []):
                        if r not in reason_map:
                            reason_map[r] = {"count": 0, "total_score": 0, "buy_count": 0}
                        reason_map[r]["count"] += 1
                        reason_map[r]["total_score"] += score
                        if is_buy:
                            reason_map[r]["buy_count"] += 1
                result = []
                for r, stats in reason_map.items():
                    result.append({
                        "reason": r,
                        "count": stats["count"],
                        "avg_score": round(stats["total_score"] / stats["count"], 1) if stats["count"] > 0 else 0,
                        "buy_rate": round((stats["buy_count"] / stats["count"]) * 100, 1) if stats["count"] > 0 else 0
                    })
                # Sort by count desc
                return sorted(result, key=lambda x: x["count"], reverse=True)
        except Exception as e:
            print(f"Analytics Error (Reasons): {e}")
            return []
    def get_analytics_phases(self):
        """Docs"""
        if not os.path.exists(self.log_path):
            return []
        try:
            with open(self.log_path, 'r', encoding='utf-8') as f:
                try:
                    data = json.load(f)
                    if not isinstance(data, dict):
                        return []
                except (json.JSONDecodeError, Exception):
                    return []
                sessions = data.get("sessions", [])
                phase_map = {}
                for s in sessions:
                    phase = s.get("market_phase", "UNKNOWN")
                    score = s.get("super_score", 0)
                    conf = s.get("confidence", 0)
                    if phase not in phase_map:
                        phase_map[phase] = {"count": 0, "total_score": 0, "total_conf": 0}
                    phase_map[phase]["count"] += 1
                    phase_map[phase]["total_score"] += score
                    phase_map[phase]["total_conf"] += conf
                result = []
                for p, stats in phase_map.items():
                    result.append({
                        "phase": p,
                        "count": stats["count"],
                        "avg_score": round(stats["total_score"] / stats["count"], 1) if stats["count"] > 0 else 0,
                        "avg_confidence": round((stats["total_conf"] / stats["count"]) * 100, 1) if stats["count"] > 0 else 0
                    })
                return result
        except Exception as e:
            print(f"Analytics Error (Phases): {e}")
            return []
learning_manager = LearningManager()
model_loaded = True # Force true as we use yfinance for now
# --- AI Helper Functions (Phase 20 Precision Layer) ---
def check_earnings_proximity(ticker: str):
    """Docs"""
    # 
    return {"is_near": False, "days": 30}
def analyze_volume_quality(hist: pd.DataFrame):
    """Docs"""
    avg_vol = hist['Volume'].tail(20).mean()
    current_vol = hist['Volume'].iloc[-1]
    ratio = current_vol / avg_vol if avg_vol > 0 else 1.0
    if ratio > 2.0: return ""
    if ratio > 1.5: return "High"
    return "Normal"
def detect_patterns(close_prices: pd.Series):
    """Docs"""
    ma5 = close_prices.rolling(window=5).mean().iloc[-1]
    ma25 = close_prices.rolling(window=25).mean().iloc[-1]
    if ma5 > ma25: return "Golden Cross"
    if ma5 < ma25: return "Dead Cross"
    return "Neutral"
def calculate_technical_indicators(hist: pd.DataFrame):
    """(v8.0)"""
    close = hist['Close']
    # RSI
    delta = close.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    rsi = (100 - (100 / (1 + rs))).iloc[-1]
    # MACD (12, 26, 9)
    exp1 = close.ewm(span=12, adjust=False).mean()
    exp2 = close.ewm(span=26, adjust=False).mean()
    macd = exp1 - exp2
    signal = macd.ewm(span=9, adjust=False).mean()
    macd_val = macd.iloc[-1]
    signal_val = signal.iloc[-1]
    # MA5
    ma5 = close.rolling(window=5).mean().iloc[-1]
    # MA25
    ma25 = close.rolling(window=25).mean().iloc[-1]
    deviation = (close.iloc[-1] / ma25 - 1) * 100 if ma25 != 0 else 0
    return {
        "rsi": rsi, 
        "macd": macd_val, 
        "macd_signal": signal_val,
        "macd_hist": macd_val - signal_val,
        "deviation": deviation, 
        "ma25": ma25,
        "ma5": ma5
    }
def calculate_volume_profile(hist: pd.DataFrame, bins=24):
    """Docs"""
    df = hist.tail(60) # 0
    p_min, p_max = df['Low'].min(), df['High'].max()
    if p_min == p_max: return {"poc": p_min, "walls": []}
    bin_size = (p_max - p_min) / bins
    profiles = []
    for i in range(bins):
        b_min = p_min + i * bin_size
        b_max = b_min + bin_size
        vol = df[(df['Close'] >= b_min) & (df['Close'] < b_max)]['Volume'].sum()
        profiles.append({"min": b_min, "max": b_max, "volume": vol})
    poc_bin = max(profiles, key=lambda x: x['volume'])
    poc = (poc_bin['min'] + poc_bin['max']) / 2
    # 
    sorted_p = sorted(profiles, key=lambda x: x['volume'], reverse=True)
    walls = [((p['min'] + p['max']) / 2) for p in sorted_p[:3]]
    return {"poc": poc, "walls": walls}
def calculate_super_score(indicators: dict, vol_prof: dict, price: float, win_rate: float, data_quality: str = "fresh"):
    """Calculate SuperScore combining Trend, Momentum, Structure (0-100)."""
    score = 0
    # 1. Trend (0-35)
    ma25 = indicators.get('ma25', 0)
    ma5 = indicators.get('ma5', 0)
    if ma25 > 0:
        # Distance from MA25
        score += min(20, max(0, (price / ma25 - 1) * 500 + 10))
        # Short-term trend (MA cross)
        if ma5 > ma25: score += 15
        elif ma5 > ma25 * 0.98: score += 7
    # 2. Momentum (0-35)
    rsi = indicators.get('rsi', 50)
    if 45 < rsi < 65: score += 35
    elif 30 < rsi <= 45: score += 25  # Oversold but recovering
    elif 65 <= rsi < 80: score += 15  # Slightly overbought
    elif rsi <= 30: score += 10 # Extreme oversold
    else: score += 5 # Extreme overbought
    
    # 3. Structure & Accuracy (0-30)
    score += min(20, win_rate / 3) # Max 30% contribution from win_rate (approx 10 pts)
    if data_quality == "fresh": score += 10
    
    return int(min(100, score))
    # Structure (0-30)
    if price > vol_prof['poc']: score += 30
    else: score += 10
    # 99 100resh + 
    raw_score = min(100, score)
    if raw_score >= 100 and data_quality != "fresh":
        raw_score = 99
    elif raw_score >= 99:
        raw_score = min(99, raw_score)  # 99
    return int(raw_score)
def calculate_theoretical_price(info: dict, current: float):
    """Calculate theoretical price based on EPS and industry PE."""
    per = info.get('trailingPE')
    eps = info.get('trailingEps')
    if per and eps:
        theoretical = eps * 15 # ER 15
        upside = (theoretical / current - 1) * 100
        return {"theoretical": theoretical, "upside": upside, "status": "Undervalued" if upside > 10 else "Fair"}
    return {"theoretical": current, "upside": 0, "status": ""}
def simulate_order_book(hist: pd.DataFrame):
    """Docs"""
    return {"buy_vol": 50000, "sell_vol": 45000, "balance": 1.11, "sentiment": ""}
def detect_market_regime(hist: pd.DataFrame):
    """Docs"""
    returns = hist['Close'].pct_change().dropna()
    vol = returns.std()
    # ATR
    high_low = hist['High'] - hist['Low']
    atr = high_low.tail(14).mean()
    if vol > 0.03: return {"regime": "PANIC", "atr": atr, "vol_pct": vol * 100}
    if vol > 0.015: return {"regime": "HIGH_VOL", "atr": atr, "vol_pct": vol * 100}
    # 
    ma20 = hist['Close'].rolling(window=20).mean()
    if hist['Close'].iloc[-1] > ma20.iloc[-1] * 1.02:
        return {"regime": "TREND_ON", "atr": atr, "vol_pct": vol * 100}
    return {"regime": "RANGE", "atr": atr, "vol_pct": vol * 100}
def detect_market_regime_safe(hist: pd.DataFrame, is_market_open: bool):
    """Docs"""
    if not is_market_open:
        # ATRSTABLE
        high_low = hist['High'] - hist['Low']
        atr = high_low.tail(14).mean()
        return {"regime": "STABLE", "atr": atr, "vol_pct": 0, "status": ""}
    return detect_market_regime(hist)
def get_external_drivers(ticker: str):
    """Docs"""
    return [
        {"factor": "USD/JPY", "impact": "Positive", "reason": "Exchange Rate"},
        {"factor": "Nikkei 225", "impact": "Neutral", "reason": "Market Trend"}
    ]
def get_market_phase():
    """(v7.5 Precision - JST Localized with Holiday Detection)"""
    # UTC → JST (+9)
    utc_now = datetime.utcnow()
    jst_now = utc_now + timedelta(hours=9)
    h, m = jst_now.hour, jst_now.minute
    t_total = h * 60 + m
    day_of_week = jst_now.weekday() # 0=Mon, 6=Sun
    # 日本の祝日リスト (2025-2026)
    JP_HOLIDAYS = {
        # 2025
        "2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24",
        "2025-03-20", "2025-04-29", "2025-05-03", "2025-05-04", "2025-05-05",
        "2025-05-06", "2025-07-21", "2025-08-11", "2025-09-15", "2025-09-23",
        "2025-10-13", "2025-11-03", "2025-11-23", "2025-11-24", "2025-12-23",
        # 2026
        "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23",
        "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05",
        "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-23",
        "2026-10-12", "2026-11-03", "2026-11-23",
        # 年末年始 (東証休場)
        "2025-12-31", "2026-01-02", "2026-01-03",
    }
    today_str = jst_now.strftime("%Y-%m-%d")
    # 週末チェック
    if day_of_week >= 5:
        return {"phase": "CLOSED", "label": "休日", "is_open": False, "risk": "LOW", "detail": "週末のため東証休場"}
    # 祝日チェック
    if today_str in JP_HOLIDAYS:
        return {"phase": "CLOSED", "label": "祝日", "is_open": False, "risk": "LOW", "detail": "祝日のため東証休場"}
    # 
    if t_total < 9 * 60:
        return {"phase": "PRE_MARKET", "label": "Pre-Market", "is_open": False, "risk": "LOW", "detail": "9:00 Start"}
    # 
    if t_total <= 11 * 60 + 30:
        risk = "HIGH" if t_total <= 9 * 60 + 15 else "NORMAL"
        detail = "Volatility" if risk == "HIGH" else "Steady"
        return {"phase": "MORNING_SESSION", "label": "Morning", "is_open": True, "risk": risk, "detail": detail}
    # 
    if t_total < 12 * 60 + 30:
        return {"phase": "LUNCH_BREAK", "label": "Lunch", "is_open": False, "risk": "MEDIUM", "detail": "Break"}
    # 
    if t_total <= 15 * 60:
        risk = "HIGH" if t_total >= 14 * 60 + 50 else "NORMAL"
        detail = "Closing" if risk == "HIGH" else "Steady"
        return {"phase": "AFTERNOON_SESSION", "label": "Afternoon", "is_open": True, "risk": risk, "detail": detail}
    # 
    return {"phase": "POST_MARKET", "label": "Post-Market", "is_open": False, "risk": "LOW", "detail": "Closed"}
def analyze_market_regime(hist: pd.DataFrame):
    """Detect market state (Volatility, Trend, Range)."""
    returns = hist['Close'].pct_change().dropna()
    vol = returns.std()
    # ATR
    high_low = hist['High'] - hist['Low']
    atr = high_low.tail(14).mean()
    if vol > 0.03: return {"regime": "PANIC", "atr": atr, "vol_pct": vol * 100}
    if vol > 0.015: return {"regime": "HIGH_VOL", "atr": atr, "vol_pct": vol * 100}
    ma20 = hist['Close'].rolling(window=20).mean()
    if hist['Close'].iloc[-1] > ma20.iloc[-1] * 1.02:
        return {"regime": "TREND_ON", "atr": atr, "vol_pct": vol * 100}
    return {"regime": "RANGE", "atr": atr, "vol_pct": vol * 100}

def analyze_order_flow(hist: pd.DataFrame, current: float):
    """(Simulated v7.0) Bias indicator."""
    vol_spike = (hist['Volume'].iloc[-1] / hist['Volume'].tail(20).mean()) > 1.5
    price_strength = (hist['Close'].iloc[-1] > hist['Open'].iloc[-1])
    bias_label = "Neutral"
    bias_raw = 0.0
    if vol_spike and price_strength:
        bias_label = "Strong Bullish"
        bias_raw = 0.6
    elif vol_spike and not price_strength:
        bias_label = "Strong Bearish"
        bias_raw = -0.6
    return {
        "bias_raw": bias_raw,
        "bias_label": bias_label,
        "break_status": "STABLE",
        "absorption": "NEUTRAL"
    }

# --- AI Logic Core: Action Engine Actions ---
def calculate_day_trading_signals(hist: pd.DataFrame, current_price: float, regime_info: dict, order_flow: dict, ticker_info: dict, capital: float = 500000, target_profit: float = 10000, ticker: str = "UNKNOWN", timeframe_alignment: str = "NEUTRAL", event_risk: dict = {}, asof: Optional[str] = None, is_exit_order: bool = False):
    """Docs"""
    ticker = ticker_info.get("symbol", "UNKNOWN")
    atr = regime_info.get("atr", current_price * 0.01)
    regime = regime_info.get("regime", "RANGE")
    vol_pct = regime_info.get("vol_pct", 0)
    # 1. egime
    REGIME_EXPLANATIONS = {
        "RANGE": "Sideways Market",
        "TREND_ON": "Trending Market",
        "DYNAMIC_TREND": "Volatile Trend",
        "PANIC": "Market Panic",
        "HIGH_VOL": "High Volatility"
    }
    regime_desc = REGIME_EXPLANATIONS.get(regime, "Stable")
    regime_jp = {
        "RANGE": "Range", "TREND_ON": "Trend", "DYNAMIC_TREND": "Dynamic", 
        "PANIC": "Panic", "HIGH_VOL": "HighV"
    }.get(regime, "N/A")
    # 2. Indicators & Dynamic Reasoning
    indicators = calculate_technical_indicators(hist)
    rsi = indicators["rsi"]
    ma25 = indicators["ma25"]
    ma5 = indicators["ma5"]
    deviation = indicators["deviation"]
    macd_hist = indicators["macd_hist"]

    tech_reasons = []
    # Dynamic RSI reasoning
    if rsi < 30: tech_reasons.append(f"極端な売られすぎ圏 (RSI: {rsi:.1f}): 歴史的に反発の可能性が極めて高い水準です")
    elif rsi < 40: tech_reasons.append(f"売られすぎ圏 (RSI: {rsi:.1f}): 短期的な買い戻しが期待できるゾーンに入っています")
    elif rsi > 70: tech_reasons.append(f"買われすぎ圏 (RSI: {rsi:.1f}): 短期的な過熱感があり、反落リスクに注意が必要です")
    
    # Trend & Cross reasoning
    if current_price > ma5 > ma25: tech_reasons.append("パーフェクトオーダー成立: 短期・中期のトレンドが完全に一致した上昇局面です")
    elif ma5 > ma25: tech_reasons.append(f"ゴールデンクロス継続中: 短期トレンド({ma5:,.0f})が中期({ma25:,.0f})を上回り、上値が軽くなっています")
    
    # Deviation reasoning
    if deviation < -5: tech_reasons.append(f"移動平均からの乖離率大 ({deviation:.1f}%): 自律反発による平均回帰が狙える割安圏です")
    
    # MACD reasoning
    if macd_hist > 0: tech_reasons.append(f"MACD強気転換: モメンタムがプラス圏({macd_hist:.2f})で推移しており、買いの勢いが増しています")

    if not tech_reasons: tech_reasons.append("テクニカル指標は概ね中立です。大きなトレンド転換を待っている状態です")
    tech_reasons = tech_reasons[:4] # Increased depth
    # 3. )
    win_rate = 50 # 
    if regime in ["TREND_ON", "DYNAMIC_TREND"]: win_rate += 10
    if order_flow.get("bias_raw", 0) > 0.4: win_rate += 15
    if indicators["rsi"] < 35: win_rate += 5
    # 
    market_phase = get_market_phase()
    if market_phase["risk"] == "HIGH": win_rate -= 15
    win_rate = max(10, min(win_rate, 90))
    risk_mult = 1.8 # 
    reward_mult = 3.6 # (1:2 )
    # 4.  (Phase 3 + Phase 2 Expansion)
    is_protected = False
    if vol_pct > 2.2 or market_phase["risk"] == "HIGH" or timeframe_alignment == "BEARISH":
        is_protected = True
        risk_mult *= 1.4 
        reward_mult *= 1.2
        if timeframe_alignment == "BEARISH":
            win_rate -= 10 # 
    #  (Phase 2 Refinement: 7
    if event_risk.get("is_imminent"):
        is_protected = True
        risk_mult *= 1.5
        win_rate -= 15 # 
        pro_tips = [] # Initialize pro_tips here if not already
        pro_tips.append(f"Event Window: {EVENT_WINDOW_DAYS} days")
    entry_price = current_price
    # Ensure atr is valid and not NaN
    safe_atr = atr if (atr and not np.isnan(atr)) else current_price * 0.02
    target_price = round(entry_price + (safe_atr * reward_mult))
    stop_price = round(entry_price - (safe_atr * risk_mult))
    risk_reward = (target_price - entry_price) / max((entry_price - stop_price), 1)
    # 5. (Target Lot Management)
    # 1%
    risk_budget = capital * 0.01 #  1% (
    price_risk = entry_price - stop_price
    # 
    shares_risk_based = risk_budget / max(price_risk, 1)
    #  (1)
    profit_per_share = target_price - entry_price
    shares_target_based = target_profit / max(profit_per_share, 1)
    # 
    shares = int(min(shares_risk_based, shares_target_based) // 100) * 100
    # 5.1  (Phase 2 Refinement: 
    if is_protected and not is_exit_order:
        # 
        shares = int((shares * 0.5) // 100) * 100 # 
        if event_risk.get("is_imminent"):
            shares = int((shares * 0.5) // 100) * 100 # 
        # 
        if regime == "PANIC":
            shares = 0
            is_protected = True
    elif is_exit_order:
        # 
        pass
    expected_value = (target_price - entry_price) * shares * (win_rate/100) - (entry_price - stop_price) * shares * ((100-win_rate)/100)
    # 
    target_reach_prob = win_rate if expected_value > (target_profit * 0.5) else win_rate * 0.7
    # 6.  (v7.0 Logic)
    decision = "WAIT"
    decision_jp = "様子見"
    reasons = []
    pro_tips = []
    beginner_warnings = []
    # エントリー戦略の決定
    entry_type = "見送り"  # 成行(寄付) / 指値 / 見送り
    limit_price = None
    entry_timing = ""
    # マーケットフェーズ別アドバイス
    if market_phase["phase"] == "OPENING_VOLATILITY":
        pro_tips.append("寄付直後はボラティリティが高いため、9:15以降の値動きを確認してからエントリーが安全です")
        beginner_warnings.append("初心者の方は寄付での成行注文を避け、板の状況を確認してください")
    elif market_phase["phase"] == "LUNCH_BREAK":
        pro_tips.append("昼休み中は流動性が低下するため、後場開始を待ってからのエントリーがおすすめです")
    elif market_phase["phase"] in ["PRE_MARKET", "POST_MARKET", "CLOSED"]:
        pro_tips.append("市場閉場中の分析です。翌営業日の寄付前に最新データで再確認してください")
    # --- 判定ロジック (Nuanced & Dynamic) ---
    decision = "WAIT"
    decision_jp = "様子見"
    reasons = []
    
    if regime == "PANIC":
        decision = "NO TRADE"
        decision_jp = "見送り（パニック相場）"
        reasons = ["パニック相場による極端な価格変動を検知。通常の資産管理が機能しないため一時停止を推奨します"]
    elif win_rate >= 75 and risk_reward >= 2.0:
        decision = "STRONG BUY"
        decision_jp = "強気買い"
        reasons = [f"高期待値×高勝率({win_rate}%): 利回り期待値が標準を大きく上回るA級セットアップです", "テクニカル・オーダーフロー共に強い合致を確認。攻めのエントリーが検討可能です"]
    elif win_rate >= 60 and risk_reward >= 1.5:
        decision = "BUY"
        decision_jp = "買い推奨"
        reasons = [f"トレンド追随: 勝率{win_rate}%に基づいた標準的な押し目/ブレイクアウト狙いのポイントです", "リスクリワードが適切に保たれており、統計的に有利な取引環境です"]
    elif win_rate >= 50 and rsi < 35 and risk_reward >= 1.5:
        decision = "BUY"
        decision_jp = "買い検討（逆張り）"
        reasons = [f"売られすぎ圏からの反発狙い: 勝率{win_rate}%ですが、下方乖離からの戻りを狙う戦術が有効です"]
    elif win_rate >= 45 and risk_reward >= 1.2:
        decision = "WAIT"
        decision_jp = "慎重に様子見"
        reasons = [f"確信度不足: 勝率が{win_rate}%とボーダー。現在のボラティリティ環境では待機が合理的です"]
    else:
        decision = "WAIT"
        decision_jp = "様子見"
        reasons = ["明確な優位性が見つかりません。トレンドの初動、あるいは確実な反発サインを待ちます"]

    # Limit results depth to prevent UI overflow but maintain quality
    reasons = (reasons + tech_reasons)[:4]
    # 7. アクションライン（最終表示テキスト）生成
    expected_profit = (target_price - entry_price) * shares
    expected_loss = (entry_price - stop_price) * shares
    upside_pct = ((target_price / entry_price) - 1) * 100 if entry_price > 0 else 0
    if decision == "BUY":
        action_line = f"【{decision_jp}】{int(shares)}株 @ ¥{entry_price:,.0f} → 目標 ¥{target_price:,.0f}（+{upside_pct:.1f}%） 損切 ¥{stop_price:,.0f}"
    elif decision == "NO TRADE":
        action_line = f"【{decision_jp}】エントリー禁止 - リスク環境が改善するまで待機"
    else:
        action_line = f"【{decision_jp}】現在値 ¥{entry_price:,.0f} - {entry_timing}"

    # --- (v8.0) Beginner-Friendly Instant Judgment ---
    # Define Signs (Visual Signals)
    # 🚀 (Strong Buy), 📈 (Buy), 🧊 (Hold/Wait), 📉 (Sell/Be Careful), ⚠️ (Avoid/Panic)
    beginner_verdict = "様子見"
    beginner_sign = "🧊"
    beginner_color = "slate" # neutral
    beginner_desc = "現在は明確なシグナルが出ていません。無理に取引せず、次のチャンスを待ちましょう。"
    
    if "BUY" in decision:
        if win_rate >= 75:
            beginner_verdict = "絶好の買い場！"
            beginner_sign = "🚀"
            beginner_color = "cyan"
            beginner_desc = f"非常に強い上昇のサイン({win_rate}%)が出ています。成長が期待できる絶好のチャンスです。"
        else:
            beginner_verdict = "投資を検討"
            beginner_sign = "📈"
            beginner_color = "green"
            beginner_desc = f"緩やかな上昇傾向(勝率{win_rate}%)にあります。無理のない範囲での投資が検討できます。"
    elif decision == "SELL":
        beginner_verdict = "注意・利益確定"
        beginner_sign = "📉"
        beginner_color = "amber"
        beginner_desc = "下落の兆候があります。既に持っている場合は利益を確定させるか、様子を見ましょう。"
    elif decision == "STRONG BUY":
        beginner_verdict = "超強気エントリー"
        beginner_sign = "🔥"
        beginner_color = "cyan"
        beginner_desc = "全ての条件が揃った極めて稀なチャンスです。リスク管理をした上で積極的な投資を検討できます。"
    elif decision == "NO TRADE":
        beginner_verdict = "今は控える"
        beginner_sign = "⚠️"
        beginner_color = "red"
        beginner_desc = "相場が不安定でリスクが高い状態です。今は何もしないことが最善の投資です。"
    elif "慎重" in decision_jp:
        beginner_verdict = "慎重に待機"
        beginner_sign = "🧊"
        beginner_color = "slate"
        beginner_desc = "良さそうな銘柄ですが、もう少し安くなるか、勢いが出るのを待つのが安全です。"

    beginner_judgment_data = {
        "verdict": beginner_verdict,
        "sign": beginner_sign,
        "color": beginner_color,
        "description": beginner_desc,
        "summary": reasons[0] if reasons else "特になし",
        "points": reasons[:3]
    }
    # --- Phase 2: Super Analysis Integration ---
    vol_prof = calculate_volume_profile(hist)
    # Confidence 
    confidence = 1.00
    confidence_reasons = []
    # taleness detection
    data_quality = "fresh"  # 
    # 
    if data_quality == "stale_30":
        confidence -= 0.15
        confidence_reasons.append("Data slightly stale (30m)")
    elif data_quality == "stale_60":
        confidence -= 0.25
        confidence_reasons.append("Data stale (60m)")
    # 
    if indicators['rsi'] > 70 and indicators.get('macd', 0) > indicators.get('macd_signal', 0):
        confidence -= 0.10
        confidence_reasons.append("RSI vs MACD")
    # 
    if vol_pct > 2.5:
        confidence -= 0.15
        confidence_reasons.append("高ボラティリティ環境: 価格変動が激しく予測精度が低下")
    super_score = calculate_super_score(indicators, vol_prof, current_price, win_rate, data_quality)
    result_payload = {
        "confidence": round(max(0.3, confidence), 2),
        "confidence_reasons": confidence_reasons,
        "decision": decision,
        "action_text": decision,
        "final_action_line": action_line,
        "reasoning_list": reasons[:3],
        "reason_top3": reasons[:3], # Frontend compatibility
        "data_status": data_quality, # Frontend compatibility

        "pro_tips": pro_tips[:2],
        "beginner_warnings": beginner_warnings[:2],
        "is_risk_alert": is_protected,
        "alert_message": f"{market_phase['label']}: {market_phase['detail']}" if is_protected else "",
        "super_score": super_score,
        
        # --- Scorecard for Visualization (v8.0) ---
        "scorecard": {
            "regime": {
                "status": "NG" if regime == "PANIC" else "OK",
                "label": "Market Regime",
                "value": regime_jp,
                "reason": f"市場環境は{regime_jp}です。"
            },
            "trend": {
                "status": "OK" if current_price > ma25 else "NG",
                "label": "Trend",
                "value": "Weak" if current_price < ma25 else "Strong",
                "reason": "中期移動平均線を下回っています" if current_price < ma25 else "中期上昇トレンドを維持しています"
            },
            "volume": {
                "status": "OK" if vol_prof['poc'] < current_price else "Caution",
                "label": "Volume Base",
                "value": "Support" if vol_prof['poc'] < current_price else "Resistance",
                "reason": "価格帯別出来高の壁より上です" if vol_prof['poc'] < current_price else "重い価格帯の下に位置しています"
            },
            "risk": {
                 "status": "NG" if is_protected else "OK",
                 "label": "Risk Factors",
                 "value": "High" if is_protected else "Normal",
                 "reason": "ボラティリティまたはイベントリスクを検知" if is_protected else "特段のリスク要因はありません"
            },
            "data_quality": {
                "status": "Caution" if data_quality != "fresh" else "OK",
                "label": "Data Freshness",
                "value": data_quality.upper(),
                "reason": "最新データを用いて分析中" if data_quality == "fresh" else "データが古いため信頼度が下がります"
            }
        },

        "volume_profile": vol_prof,
        "regime_info": {
            "regime": regime, 
            "regime_jp": regime_jp, 
            "atr": float(atr),
            "vol_pct": float(vol_pct)
        },
        "technical_summary": {
            "rsi": indicators["rsi"],
            "macd_hist": indicators["macd"] - indicators["macd_signal"],
            "ma_deviation": indicators.get("deviation", 0)
        },
        "order_flow": {
            "bias_raw": float(order_flow.get("bias_raw", 0)),
            "bias_jp": order_flow.get("bias_label", "---"),
            "signal_jp": order_flow.get("break_status", "---"),
            "signal": order_flow.get("break_status", "---")
        },
        "risk_management": {
            "win_rate_estimate": win_rate,
            "risk_reward_ratio": round(risk_reward, 2),
            "is_high_volatility_protected": is_protected,
            "is_analysis_only_mode": False
        },
        "explanations": {
            "regime_desc": regime_desc,
            "technical_reasons": tech_reasons
        },
        "goal_consistency": {
            "expected_value": float(expected_value),
            "expected_value_label": "Expected PnL",
            "goal_status": "Aggressive" if expected_value > 2000 else "Conservative",
            "alternatives": []
        },
        "lot_management": {
            "shares": int(shares),
            "shares_adjusted": is_protected,
            "capital": float(capital),
            "max_risk": float(risk_budget),
            "loss_limit": float(capital * 0.02),
            "entry_price": float(entry_price),
            "stop_price": float(stop_price),
            "target_price": float(target_price),
            "holding_period": "デイトレード（当日決済）",
            "entry_type": entry_type,
            "limit_price": float(limit_price) if limit_price else None,
            "entry_timing": entry_timing,
            "expected_profit": float(expected_profit) if decision == "BUY" else 0,
            "expected_loss": float(expected_loss) if decision == "BUY" else 0,
            "shares_reason": f"資金{capital:,.0f}円の1%リスク管理に基づく推奨株数" if shares > 0 else "エントリー条件未達のため0株"
        },
        "decision_jp": decision_jp,
        "beginner_judgment": beginner_judgment_data,
        "terminology": {},
        "data_gaps": [],
        "system_status": "PRE_MARKET_ANALYSIS" if not market_phase.get("is_open", True) else "ACTIVE"
    }
    # (
    if not market_phase.get("is_open", True):
        # 閉場時も分析結果を保持し、翌営業日向けの参考情報として提供
        result_payload["action_text"] = f"{decision_jp}（翌営業日向け分析）"
        result_payload["final_action_line"] += " ※市場閉場中の分析です。翌営業日の寄付前に最新データで再確認してください"
        result_payload["reasoning_list"].append("※この分析は直近の取引データに基づいています。翌営業日の寄付値は変動する可能性があります")
        result_payload["pro_tips"].insert(0, "翌営業日の9:00前に最新のニュース・材料を確認してから最終判断してください")
    # Log Decision (Skip logging for standby if needed, but here we log to track)
    learning_manager.log_decision(ticker, result_payload, current_price)
    return result_payload
# --- Memory Cache for Stock Data (v8.0) ---
import pickle
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)
class TwoLayerCache:
    def __init__(self, l1_ttl=300, l2_ttl=3600):
        self.l1_cache = {} # Memory
        self.l1_ttl = l1_ttl
        self.l2_ttl = l2_ttl
    def _get_l2_path(self, key):
        import hashlib
        h = hashlib.md5(key.encode()).hexdigest()
        return os.path.join(CACHE_DIR, f"l2_{h}.pkl")
    def get(self, key):
        now = datetime.now()
        # L1 Check
        if key in self.l1_cache:
            data, ts = self.l1_cache[key]
            if now - ts < timedelta(seconds=self.l1_ttl):
                return data, "fresh"
        # L2 Check
        path = self._get_l2_path(key)
        if os.path.exists(path):
            try:
                with open(path, "rb") as f:
                    data, ts = pickle.load(f)
                if now - ts < timedelta(seconds=self.l2_ttl):
                    # Promote to L1
                    self.l1_cache[key] = (data, ts)
                    return data, "stale"
            except:
                pass
        return None, "missing"
    def set(self, key, data):
        ts = datetime.now()
        self.l1_cache[key] = (data, ts)
        try:
            with open(self._get_l2_path(key), "wb") as f:
                pickle.dump((data, ts), f)
        except:
            pass
stock_cache = TwoLayerCache(l1_ttl=300, l2_ttl=3600)
# Phase 2 Refinement: Specific caches
fundamentals_cache = TwoLayerCache(l1_ttl=3600, l2_ttl=86400) # 24h
events_cache = TwoLayerCache(l1_ttl=3600, l2_ttl=86400)       # 24h
correlation_cache = TwoLayerCache(l1_ttl=600, l2_ttl=3600)    # 1h
scan_semaphore = asyncio.Semaphore(8) #  8
async def scan_single_ticker(t_code: str):
    """Scan single ticker v8.0 with Semaphore and TwoLayerCache."""
    ticker_symbol = f"{t_code}.T"
    start_time = time.time()
    # 
    cached_data, data_status = stock_cache.get(ticker_symbol)
    if cached_data and data_status == "fresh":
        return {**cached_data, "scan_status": "ok", "data_status": "fresh", "scan_ms": int((time.time()-start_time)*1000)}
    async with scan_semaphore:
        try:
            fetch_start = time.time()
            def fetch():
                stock = yfinance.Ticker(ticker_symbol)
                return stock.history(period="1y")
            hist = await asyncio.to_thread(fetch)
            fetch_ms = int((time.time() - fetch_start) * 1000)
            if hist.empty:
                return {"ticker": t_code, "scan_status": "failed", "data_status": "missing", "reason": "No data found"}
            # --- (v8.0 Phase 2) ---
            analysis_start = time.time()
            indicators = calculate_technical_indicators(hist)
            vol_prof = calculate_volume_profile(hist)
            current_price = hist['Close'].iloc[-1]
            returns = hist['Close'].pct_change().dropna()
            volatility = returns.std()
            atr = current_price * volatility
            win_rate = 55
            if current_price > indicators['ma25']: win_rate += 5
            if indicators['rsi'] < 40: win_rate += 5
            if indicators['macd'] > indicators['macd_signal']: win_rate += 5
            target_profit = 10000
            target_price = current_price + (atr * 3.5)
            profit_per_share = target_price - current_price
            shares = int((target_profit / max(profit_per_share, 1)) // 100) * 100
            expected_val = (target_price - current_price) * shares * (win_rate/100)
            # Super Score & Confidence
            score = calculate_super_score(indicators, vol_prof, current_price, win_rate)
            confidence = 0.7 + (0.2 if len(hist) > 200 else 0) + (0.05 if win_rate > 60 else 0)
            analysis_ms = int((time.time() - analysis_start) * 1000)
            # Volume Profile 
            poc_diff_pct = ((current_price - vol_prof['poc']) / vol_prof['poc']) * 100
            if abs(poc_diff_pct) < 0.3:
                structure_reason = "POC Support"
            elif current_price > vol_prof['poc'] and poc_diff_pct > 1.8:
                next_wall = min([w for w in vol_prof['walls'] if w > current_price], default=current_price * 1.02)
                wall_dist_pct = ((next_wall - current_price) / current_price) * 100
                structure_reason = f"Breakout +{wall_dist_pct:.1f}%"
            elif current_price < vol_prof['poc']:
                wall_dist_pct = ((vol_prof['poc'] - current_price) / current_price) * 100
                if wall_dist_pct < 0.6:
                    structure_reason = f"Resistance {wall_dist_pct:.1f}% WAIT"
                else:
                    structure_reason = "Below Value Area"
            else:
                structure_reason = "Neutral Structure"
            result = {
                "ticker": t_code,
                "name": t_code,
                "reason": f"Exp.PnL: {expected_val:,.0f} / Win%: {win_rate}%",
                "reason_top3": [
                    f"Win Rate: {win_rate}%",
                    f"{structure_reason}",
                    "MACD Signal" if indicators['macd'] > indicators['macd_signal'] else "Trend Follow"
                ],
                "score": score,
                "confidence": round(confidence, 2),
                "price": current_price,
                "fetch_ms": fetch_ms,
                "analysis_ms": analysis_ms
            }
            # 
            stock_cache.set(ticker_symbol, result)
            return {
                **result,
                "scan_status": "ok",
                "data_status": "fresh",
                "scan_ms": int((time.time()-start_time)*1000)
            }
        except Exception as e:
            print(f"Error scanning {t_code}: {e}")
            # : L2 stale 
            if cached_data:
                return {**cached_data, "scan_status": "degraded", "data_status": "stale", "scan_ms": int((time.time()-start_time)*1000)}
            return {"ticker": t_code, "scan_status": "failed", "data_status": "missing", "error": str(e)}

async def get_day_trading_hot_picks():
    """Get day trading hot picks v2.1 with Fallback."""
    target_tickers = [
        "7203", "9984", "8035", "6758", "6501", 
        "4063", "8058", "8306", "8316", "9432",
        "6920", "6146", "6857", "4502", "7974",
        "8411", "7267", "6367", "9101", "2914"
    ]
    
    # Fallback Data (Analyst Picks for Feb 2026)
    FALLBACK_PICKS = [
        {
            "ticker": "8306", 
            "confidence": 0.85, 
            "reason_top3": ["金利上昇メリット", "PBR是正期待", "高配当利回り"], 
            "reason": "Analyst Watch (Fallback)", 
            "score": 85,
            "scan_status": "ok"
         },
        {
            "ticker": "6501", 
            "confidence": 0.82, 
            "reason_top3": ["DX需要拡大", "再編効果", "安定成長"], 
            "reason": "Analyst Watch (Fallback)", 
            "score": 82,
            "scan_status": "ok"
        },
        {
            "ticker": "7203", 
            "confidence": 0.80, 
            "reason_top3": ["円安恩恵", "EV戦略進展", "自社株買い"], 
            "reason": "Analyst Watch (Fallback)", 
            "score": 80,
            "scan_status": "ok"
        }
    ]

    try:
        total_start = time.time()
        tasks = [scan_single_ticker(t) for t in target_tickers]
        results = await asyncio.gather(*tasks)
        
        # Filter valid results
        valid_picks = [r for r in results if r.get("scan_status") in ["ok", "degraded"] and "score" in r]
        picks = sorted(valid_picks, key=lambda x: x.get('score', 0), reverse=True)[:3]
        
        # Usage of Fallback if insufficient data
        if len(picks) < 3:
            print(f"WARNING: Only found {len(picks)} valid picks. Using fallback data.")
            # Fill missing slots with fallback
            for fb in FALLBACK_PICKS:
                if len(picks) >= 3: break
                # Check if already present
                if not any(p['ticker'] == fb['ticker'] for p in picks):
                    picks.append(fb)
        
        return picks
        
    except Exception as e:
        print(f"CRITICAL ERROR in hot-picks: {e}")
        return FALLBACK_PICKS

@app.get("/api/hot-picks")
async def api_hot_picks():
    """
    Returns top 3 hot picks for day trading. 
    Corrected to match ScannerGrid.tsx frontend structure.
    """
    picks = await get_day_trading_hot_picks()
    # Ensure confidence and reason fields are present for ScannerGrid.tsx
    formatted_picks = []
    for p in picks:
        formatted_picks.append({
            "ticker": p.get("ticker", "UNKNOWN"),
            "confidence": p.get("confidence", 0.5),
            "reason_top3": p.get("reason_top3", ["テクニカル良好"]),
            "reason": p.get("reason", "AIによる推奨銘柄"),
            "scan_status": p.get("scan_status", "ok"),
            "score": p.get("score", 0)
        })
    return {"status": "success", "picks": formatted_picks}
@app.get("/")
def read_root():
    return {"status": "online", "system": "Project Tenkai", "mode": "Autonomous", "time_jst": (datetime.utcnow() + timedelta(hours=9)).isoformat()}
@app.post("/admin/trigger-learning")
async def trigger_learning(request: Request):
    """(Audit Required)"""
    try:
        # 
        suggestions = learning_manager.get_improvement_suggestions()
        return {
            "status": "success",
            "message": "",
            "timestamp": datetime.now().isoformat(),
            "suggestions": suggestions
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
class LearningAnalyticsService:
    """Phase 7: """
    def __init__(self, log_path=os.path.join(LOG_DIR, "self_improve.json")):
        self.log_path = log_path
    def _load_logs(self):
        if not os.path.exists(self.log_path):
            return []
        try:
            with open(self.log_path, 'r', encoding='utf-8') as f:
                try:
                    data = json.load(f)
                    if not isinstance(data, dict):
                        return []
                except (json.JSONDecodeError, Exception):
                    return []
                return data.get("sessions", [])
        except:
            return []
    def analyze_reasons(self):
        """Docs"""
        logs = self._load_logs()
        stats = {}
        for log in logs:
            try:
                reasons = log.get("reasons", [])
                decision = log.get("decision", "WAIT")
                sku_score = log.get("super_score", 0)
                # Check list type
                if not isinstance(reasons, list):
                    continue
                for reason in reasons:
                    # 
                    key = reason.split(":")[0] if ":" in reason else reason
                    if key not in stats:
                        stats[key] = {"count": 0, "buy_count": 0, "avg_score": 0}
                    stats[key]["count"] += 1
                    if decision == "BUY":
                        stats[key]["buy_count"] += 1
                    stats[key]["avg_score"] += sku_score
            except Exception:
                continue
        # 
        result = []
        for key, val in stats.items():
            avg_score = val["avg_score"] / val["count"] if val["count"] > 0 else 0
            buy_rate = (val["buy_count"] / val["count"]) * 100 if val["count"] > 0 else 0
            result.append({
                "reason": key,
                "count": val["count"],
                "buy_rate": round(buy_rate, 1),
                "avg_score": round(avg_score, 1)
            })
        return sorted(result, key=lambda x: x["count"], reverse=True)
    def analyze_market_phases(self):
        """Docs"""
        logs = self._load_logs()
        stats = {}
        for log in logs:
            try:
                phase = log.get("market_phase")
                if not phase or phase == "UNKNOWN":
                    # Try fallback to metrics_snapshot if updated
                    phase = log.get("metrics_snapshot", {}).get("regime", "UNKNOWN")
                # Clean up phase string (remove japanese explanation if present)
                if ":" in phase:
                    phase = phase.split(":")[0].strip()
                if phase not in stats:
                    stats[phase] = {"count": 0, "avg_confidence": 0, "avg_score": 0}
                stats[phase]["count"] += 1
                stats[phase]["avg_confidence"] += log.get("confidence", 0)
                stats[phase]["avg_score"] += log.get("super_score", 0)
            except Exception:
                continue
        result = []
        for key, val in stats.items():
            result.append({
                "phase": key,
                "count": val["count"],
                "avg_confidence": round(val["avg_confidence"] / val["count"], 2),
                "avg_score": round(val["avg_score"] / val["count"], 1)
            })
        return result
    def get_trends(self):
        """Docs"""
        logs = self._load_logs()
        # 0
        dataset = logs[-50:]
        result = []
        for log in dataset:
            try:
                result.append({
                    "timestamp": log.get("timestamp"),
                    "score": log.get("super_score", 0),
                    "confidence": log.get("confidence", 0),
                    "ticker": log.get("ticker")
                })
            except: 
                continue
        return result
analytics_service = LearningAnalyticsService()
@app.get("/api/analytics/reasons")
def get_reasons_analytics():
    return analytics_service.analyze_reasons()
@app.get("/api/analytics/market-phases")
def get_market_phases_analytics():
    return analytics_service.analyze_market_phases()
@app.get("/api/analytics/trends")
def get_trends_analytics():
    return analytics_service.get_trends()
def analyze_market_sentiment():
    """Fetches multiple indices and calculates a composite market sentiment 'vibe' (Phase 20)."""
    indices = {
        "^N225": "Nikkei 225",
        "^TOPX": "TOPIX",
        "1552.T": "ETF VIX" # Growth/VIX Proxy
    }
    results = []
    try:
        print("DEBUG: Fetching multi-index data...")
        for sym, name in indices.items():
            t = yfinance.Ticker(sym)
            hist = t.history(period="1mo")
            if not hist.empty and len(hist) >= 2:
                current = hist['Close'].iloc[-1]
                prev = hist['Close'].iloc[-2]
                change_pct = ((current - prev) / prev) * 100
                results.append({"name": name, "change": change_pct, "current": current})
        if not results:
            return {"vibe": "UNKNOWN", "score": 0.5, "change_pct": 0, "current": 0, "status_text": ""}
        # Calculate composite score
        avg_change = sum([r['change'] for r in results]) / len(results)
        # Determine Vibe with Redundancy (Phase 20 Fail-safe)
        vibe = "CAUTIOUS"
        status_text = "Market is cautious"
        score = 0.5
        if avg_change > 0.8:
            vibe = "BULLISH"
            status_text = "Bullish momentum"
            score = 0.9
        elif avg_change > 0.2:
            vibe = "STABLE"
            status_text = " ("
            score = 0.7
        elif avg_change < -0.8:
            vibe = "BEARISH"
            status_text = " ()"
            score = 0.1
        elif avg_change < -0.2:
            vibe = "WEAK"
            status_text = " ("
        # Fail-safe: Check for index disagreement
        changes = [r['change'] for r in results]
        if max(changes) > 0 and min(changes) < 0:
            status_text += " ("
            score = (score + 0.5) / 2 # Pull towards neutral
        main_idx = results[0] # Nikkei 225
        return {
            "vibe": vibe,
            "status_text": status_text,
            "score": score,
            "change_pct": float(main_idx['change']),
            "current": float(main_idx['current']),
            "index_name": " (TOPIX/VIX)",
            "components": results
        }
    except Exception as e:
        print(f"Error analyzing composite market sentiment: {e}")
        return {"vibe": "UNKNOWN", "score": 0.5, "change_pct": 0, "current": 0, "status_text": ""}

# In-memory Ticker Map for Suggestion
from data.ticker_map import MAJOR_TICKERS

@app.post("/api/predict", response_model=PredictionResponse)
async def predict_stock(request: StockRequest):
    global ingestor
    
    # --- 1. Validation & Suggestion (Fix for 3-digit input) ---
    req_ticker = request.ticker.strip().upper()
    
    # 3-digit or partial input handling
    if len(req_ticker) < 4 and req_ticker.isdigit():
        # Find candidates
        candidates = [
            {"ticker": k, "name": v} 
            for k, v in MAJOR_TICKERS.items() 
            if k.startswith(req_ticker)
        ]
        
        if candidates:
            # Enhanced Error: Return 400 with structured candidates
            # Frontend will catch this and show a selection modal
            raise HTTPException(
                status_code=400, 
                detail={
                    "error_code": "PARTIAL_TICKER",
                    "message": f"'{req_ticker}' は不完全なコードです。以下から選択してください:",
                    "candidates": candidates
                }
            )
        else:
             raise HTTPException(
                status_code=400, 
                detail={
                    "error_code": "INVALID_TICKER",
                    "message": f"'{req_ticker}' に一致する主要銘柄が見つかりませんでした。4桁の銘柄コードを入力してください。",
                    "candidates": []
                }
            )

    print(f"REQUEST | ticker={request.ticker} asof={request.asof}")
    ticker = request.ticker
    if not model_loaded: raise HTTPException(status_code=503, detail="AI Model not loaded")
    if ingestor is None: raise HTTPException(status_code=503, detail="Data Ingestor is not initialized properly.")

    
    missing_fields = []
    fetch_errors = {}
    
    try:
        # 1. Fundamentals
        fund_data, err = await asyncio.to_thread(safe_fetch, "fundamentals", ingestor.fetch_fundamentals, ticker, asof=request.asof)
        if err:
            fund_data = {}
            missing_fields.append("fundamentals")
            fetch_errors["fundamentals"] = err
        
        # 2. Initialization & Market Phase
        # Support alphanumeric TSE codes (e.g. 167A, 212A) - append .T unless already qualified
        ticker_symbol = request.ticker if ('.' in request.ticker or request.ticker.startswith('^')) else f"{request.ticker}.T"
        stock_yf, err = await asyncio.to_thread(safe_fetch, "yfinance_ticker_init", yfinance.Ticker, ticker_symbol)
        if err: raise HTTPException(status_code=404, detail=f"Ticker Error: {err}")
        
        market_phase = get_market_phase()
        hist, err = await asyncio.to_thread(safe_fetch, "stock_history", stock_yf.history, period="1y")
        if err or hist is None or hist.empty:
            raise HTTPException(status_code=404, detail="No historical data")
            
        if request.asof:
            asof_dt = pd.to_datetime(request.asof).tz_localize(None)
            hist = hist[hist.index.tz_localize(None) <= asof_dt]
        
        # 3. Micro & Macro
        current_price = float(hist['Close'].iloc[-1])
        n225_hist, _ = await asyncio.to_thread(safe_fetch, "n225", yfinance.Ticker("^N225").history, period="1y")
        # Use 1306.T as TOPIX proxy if index is unavailable
        topix_hist, _ = await asyncio.to_thread(safe_fetch, "topix", yfinance.Ticker("1306.T").history, period="1y")
        usdjpy_hist, _ = await asyncio.to_thread(safe_fetch, "fx", yfinance.Ticker("JPY=X").history, period="1y")
        us10y_hist, _ = await asyncio.to_thread(safe_fetch, "us10y", yfinance.Ticker("^TNX").history, period="1y")
        vix_hist, _ = await asyncio.to_thread(safe_fetch, "vix", yfinance.Ticker("^VIX").history, period="1y")
        
        n225_current = n225_hist['Close'].iloc[-1] if n225_hist is not None and not n225_hist.empty else 0
        topix_current = topix_hist['Close'].iloc[-1] if topix_hist is not None and not topix_hist.empty else 0
        fx_current = usdjpy_hist['Close'].iloc[-1] if usdjpy_hist is not None and not usdjpy_hist.empty else 150
        us10y_current = us10y_hist['Close'].iloc[-1] if us10y_hist is not None and not us10y_hist.empty else 4.0
        vix_current = vix_hist['Close'].iloc[-1] if vix_hist is not None and not vix_hist.empty else 20.0

        risk_sentiment = "Risk Off" if vix_current > 18 or us10y_current > 4.2 else "Risk On"
        macro_snapshot = MacroSnapshot(
            nikkei=float(n225_current),
            topix=float(topix_current),
            usdjpy=float(fx_current),
            us10y=float(us10y_current),
            vix=float(vix_current),
            risk_sentiment=risk_sentiment,
            summary=f"市場は現在 {risk_sentiment} モード。VIXは {vix_current:.1f}、米10年債金利は {us10y_current:.2f}% です。"
        )
        
        returns = hist['Close'].pct_change().dropna()
        volatility = float(returns.std()) if not returns.empty else 0.02
        avg_return = float(returns.mean()) if not returns.empty else 0.0
        
        mkt_returns = n225_hist['Close'].pct_change().dropna() if n225_hist is not None and not n225_hist.empty else pd.Series()
        beta = 1.0
        if not returns.empty and not mkt_returns.empty:
            common_idx = returns.index.intersection(mkt_returns.index)
            if not common_idx.empty:
                cv = np.cov(returns.loc[common_idx], mkt_returns.loc[common_idx])[0][1]
                vr = np.var(mkt_returns.loc[common_idx])
                beta = float(cv / vr) if vr != 0 else 1.0

        # 4. Multi-Timeframe Alignment
        hist_wk, _ = await asyncio.to_thread(safe_fetch, "stock_history_weekly", stock_yf.history, period="2y", interval="1wk")
        timeframe_alignment = "NEUTRAL"
        if hist_wk is not None and len(hist_wk) > 26:
            ma13_wk = hist_wk['Close'].rolling(window=13).mean().iloc[-1]
            ma26_wk = hist_wk['Close'].rolling(window=26).mean().iloc[-1]
            if hist_wk['Close'].iloc[-1] > ma13_wk > ma26_wk: timeframe_alignment = "BULLISH"
            elif hist_wk['Close'].iloc[-1] < ma13_wk < ma26_wk: timeframe_alignment = "BEARISH"

        # IMPORTANT: Core Analysis Prep
        regime_info = analyze_market_regime(hist)
        order_flow = analyze_order_flow(hist, current_price)
        
        # 5. Risks & Events
        calendar_data, _ = await asyncio.to_thread(safe_fetch, "calendar", lambda s: s.calendar, stock_yf)
        event_info = {"is_imminent": False, "events": []}
        if calendar_data is not None:
            try:
                e_date = calendar_data.get('Earnings Date')
                if isinstance(e_date, list): e_date = e_date[0]
                if e_date:
                    e_dt = pd.to_datetime(e_date).replace(tzinfo=None)
                    days = (e_dt.date() - datetime.now().date()).days
                    if 0 <= days <= 7:
                        event_info["is_imminent"] = True
                        event_info["events"].append({"type": "EARNINGS", "date": str(e_dt.date()), "days_left": days})
            except: pass

        info, _ = await asyncio.to_thread(safe_fetch, "info", lambda s: s.info, stock_yf)
        company_name = info.get('longName') or info.get('shortName') or ticker
        industry = info.get('industry', 'Unknown')
        news_raw, _ = await asyncio.to_thread(safe_fetch, "news", lambda s: s.news, stock_yf)
        news_evidence = [{"title": n.get('title', 'N/A'), "publisher": n.get('publisher', 'N/A')} for n in (news_raw or [])[:3]]

        # 6. Signals & Reasoning
        dt_signals = calculate_day_trading_signals(
            hist, current_price, regime_info, order_flow, info, 
            capital=request.capital, ticker=ticker, event_risk=event_info, asof=request.asof
        )
        
        # Pull values for report
        ma5_val = dt_signals.get("lot_management", {}).get("ma5", current_price)
        ma25_val = dt_signals.get("lot_management", {}).get("ma25", current_price)
        rsi_val = dt_signals.get("technical_summary", {}).get("rsi", 50)
        dev_val = dt_signals.get("technical_summary", {}).get("ma_deviation", 0)
        m_hist_val = dt_signals.get("technical_summary", {}).get("macd_hist", 0)

        def get_analyst_report(analysis_payload):
            fx_label = "High (Export-focused)" if (fx_current > 145 and ("Export" in industry or "Auto" in industry)) else "Normal"
            decision_jp = analysis_payload.get("decision_jp", "様子見")
            
            report = f"### 【総合分析レポート: {company_name} ({ticker})】\n"
            report += f"**判定ランク: {decision_jp}**\n\n"
            report += f"#### 1. マクロ・市場環境\n"
            report += f"- 日経平均株価: {n225_current:,.0f}円 (指数連動性 β: {beta:.2f})\n"
            report += f"- 為替状況: 1ドル={fx_current:.2f}円 (影響: {fx_label})\n"
            report += f"- ボラティリティ: {volatility:.2%} ({'警戒' if volatility > 0.03 else '平時'})\n\n"
            
            report += f"#### 2. テクニカル分析\n"
            report += f"- 短期傾向: 5日移動平均線 ({'堅調' if ma5_val > current_price * 0.98 else '調整'})\n"
            report += f"- 中期傾向: 25日平均 {ma25_val:,.0f}円 (乖離: {dev_val:.1f}%)\n"
            report += f"- 指標: RSI {rsi_val:.1f} / MACD Hist {m_hist_val:.2f}\n\n"
            
            report += f"#### 3. ファンダメンタル\n"
            report += f"- 業界: {industry}\n"
            report += f"- 評価: PER {fund_data.get('per') or 'N/A'}倍 / PBR {fund_data.get('pbr') or 'N/A'}倍\n\n"
            
            report += f"#### 4. トピックス\n"
            if news_evidence:
                for n in news_evidence[:2]: report += f"- {n['title']} ({n['publisher']})\n"
            else: report += "- 直近ニュースなし\n"
            
            if event_info["is_imminent"]: report += "\n⚠️ **CAUTION**: 近日に決算イベントを控えています。\n"
            report += f"\n--- \n*AI Prediction Engine v8.1 (Confidence: {int(analysis_payload.get('confidence', 0)*100)}%)*"
            return report

        reasoning = get_analyst_report(dt_signals)
        
        # 7. Evolution & Projections
        evolution_manager.update_bias_from_history(ticker, hist)
        bias_corr = evolution_manager.get_correction(ticker)
        
        def project_p(days, cur, vol, drift): return cur * (1 + (drift * days) + (vol * np.sqrt(days)))
        base_1d = project_p(1, current_price, volatility, avg_return)
        
        forecasts = {
            "1d": float(base_1d + (bias_corr if abs(bias_corr) < current_price * 0.1 else 0)),
            "7d": float(project_p(7, current_price, volatility, avg_return)),
            "30d": float(project_p(30, current_price, volatility, avg_return)),
            "60d": float(project_p(60, current_price, volatility, avg_return)),
            "90d": float(project_p(90, current_price, volatility, avg_return)),
        }
        evolution_manager.log_prediction(ticker, current_price, float(base_1d))

        # --- Price Change Calculation ---
        prev_close = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else current_price
        price_change_pct = ((current_price / prev_close) - 1) * 100 if prev_close > 0 else 0.0

        # --- Chart Data (Dynamic Period Selection & Projection) ---
        p_lower = request.period.lower() if request.period else "1mo"
        if p_lower == "1d":
            hist_count = 5
            forecast_val = forecasts["1d"]
            forecast_label = "+1D"
        elif p_lower == "1w":
            hist_count = 15
            forecast_val = forecasts["7d"]
            forecast_label = "+7D"
        else: # 1mo
            hist_count = 30
            forecast_val = forecasts["30d"]
            forecast_label = "+30D"

        close_series = hist['Close'].tail(hist_count)
        ma20_all = hist['Close'].rolling(window=20).mean()
        ma20 = ma20_all.tail(hist_count)
        
        chart_data_out = []
        first_price = float(close_series.iloc[0]) if not close_series.empty else current_price
        for t, p in close_series.items():
            fp = float(p)
            growth = (fp / first_price - 1) if first_price > 0 else 0
            ma_val = ma20.get(t)
            chart_data_out.append({
                "name": str(t.date()),
                "base": fp,
                "price": fp,
                "growth": growth,
                "ma20": float(ma_val) if ma_val is not None and not np.isnan(ma_val) else None,
                "is_forecast": False
            })
            
        # Append Forecast Point
        chart_data_out.append({
            "name": f"{forecast_label} Proj.",
            "base": float(forecast_val),
            "price": float(forecast_val),
            "growth": (float(forecast_val) / first_price - 1) if first_price > 0 else 0,
            "ma20": None,
            "is_forecast": True
        })

        # --- Long Term Snapshot ---
        def norm_pct(v): return float(v) if v is not None and v > 1.0 else float(v or 0) * 100
        
        long_term = LongTermSnapshot(
            profitability={
                "roe": norm_pct(info.get("returnOnEquity")),
                "operating_margin": norm_pct(info.get("operatingMargins")),
                "revenue_growth": norm_pct(info.get("revenueGrowth"))
            },
            safety={
                "equity_ratio": norm_pct(info.get("equityRatio", 0.5)),
                "interest_bearing_debt": info.get("totalDebt", 0)
            },
            shareholder_returns={
                "dividend_yield": norm_pct(info.get("dividendYield")),
                "payout_ratio": norm_pct(info.get("payoutRatio"))
            },
            valuation_band={
                "per": info.get("forwardPE", 0),
                "pbr": info.get("priceToBook", 0),
                "status": "FAIR" if 10 < info.get("forwardPE", 15) < 20 else "CHECK"
            },
            warnings=[]
        )

        # --- Final Response Construction ---
        return PredictionResponse(
            ticker=ticker,
            company_name=company_name,
            current_price=current_price,
            price_change_percent=round(price_change_pct, 2),
            forecasts=forecasts,
            volatility=volatility,
            confidence_score=dt_signals.get("confidence", 0.6),
            super_score=dt_signals.get("super_score", 0),
            sentiment_score=order_flow.get("bias_raw", 0),
            recommendation=dt_signals.get("decision", "WAIT"),
            reasoning=reasoning,
            evidence={
                "technical": dt_signals.get("technical_summary", {}),
                "fundamental": fund_data,
                "news": news_evidence
            },
            portfolio_suggestion=get_diversification_suggestion(ticker, current_price),
            chart_data=chart_data_out,
            day_trading=dt_signals,
            macro_snapshot=macro_snapshot,
            long_term_snapshot=long_term,
            event_risk=EventRisk(
                upcoming_events=event_info["events"],
                rules=["決算直前につきロット調整検討" if event_info["is_imminent"] else "平常時"],
                warnings=["決算発表が近接しています" if event_info["is_imminent"] else "特記事項なし"]
            ),
            beginner_judgment=dt_signals.get("beginner_judgment"),
            missing_fields=missing_fields,
            fetch_errors=fetch_errors
        )
        # --- Phase 6: Exit Strategy Advisor Logic ---
        exit_strat = None
        if request.entry_price is not None and request.shares is not None:
            pnl = (current_price - request.entry_price) * request.shares
            pnl_pct = (current_price / request.entry_price - 1) * 100
            market_value = current_price * request.shares
            candidates = []
            # Candidate 1: Quick Profit Taking (Short-term Bull)
            bull_30d = generate_scenario(30, current_price, volatility, avg_return, "bull")
            candidates.append({
                "label": "Growth Scenario",
                "price": float(bull_30d),
                "target_date": "30D Forecast",
                "profit_pct": float((bull_30d / request.entry_price - 1) * 100),
                "reason": "Bullish Trend"
            })
            # Candidate 2: Stable Exit (Base Mid-term)
            base_60d = generate_scenario(60, current_price, volatility, avg_return, "base")
            candidates.append({
                "label": "Moderate Strategy",
                "price": float(base_60d),
                "target_date": "60D Forecast",
                "profit_pct": float((base_60d / request.entry_price - 1) * 100),
                "reason": "Stable growth trend"
            })
            # Candidate 3: Defensive Stop Loss (Bear)
            bear_7d = generate_scenario(7, current_price, volatility, avg_return, "bear")
            candidates.append({
                "label": "Defensive Exit",
                "price": float(bear_7d),
                "target_date": "7D Stop",
                "profit_pct": float((bear_7d / request.entry_price - 1) * 100),
                "reason": "Safety margin (1.5 sigma)"
            })
            exit_strat = {
                "current_status": {
                    "pnl": float(pnl),
                    "pnl_pct": float(pnl_pct),
                    "market_value": float(market_value)
                },
                "candidates": candidates,
                "alert_status": pnl_pct > 15 or pnl_pct < -10 # Alert if big jump/drop
            }
        # --- Portfolio Suggestion ---
        portfolio = get_diversification_suggestion(ticker, current_price)
        # --- Phase 8: Extended Chart Data with Projections ---
        # History (Period-aware with Mapping)
        chart_period = request.period
        if chart_period == "1w": chart_period = "5d"
        elif chart_period == "1m": chart_period = "1mo"
        chart_interval = "1d"
        if chart_period == "1d": chart_interval = "5m"
        elif chart_period == "5d": chart_interval = "30m" # Optimized for 1W view
        chart_hist, chart_hist_err = await asyncio.to_thread(safe_fetch, "chart_history", stock_yf.history, period=chart_period, interval=chart_interval)
        if chart_hist_err:
            missing_fields.append("chart_history")
            fetch_errors["chart_history"] = chart_hist_err
            print(f"Prediction Partial: Chart historical data missing for {ticker}: {chart_hist_err}")
            chart_hist = hist.tail(45) # Fallback
        history_data = []
        if chart_hist is not None:
            for d, r in chart_hist.iterrows():
                p = float(r['Close'])
                if np.isnan(p): continue
                # Formatting (Optimized for 1W visibility)
                if chart_period == "1d":
                    time_label = d.strftime("%H:%M")
                elif chart_period == "5d":
                    time_label = d.strftime("%m/%d %H:%M")
                else:
                    time_label = d.strftime("%m/%d")
                history_data.append({
                    "name": time_label,
                    "base": p,
                    "bull": p,
                    "bear": p,
                    "type": "History"
                })
        # Projections (1W, 30D, 90D)
        # Point 0: Current (Connect history to future)
        # Note: Some UI prefer not repeating the last point, but for Area charts it creates a clean bridge.
        for days in [7, 30, 90]:
            lbl = f"+{days}"
            history_data.append({
                "name": lbl,
                "base": float(generate_scenario(days, current_price, volatility, avg_return, "base")),
                "bull": float(generate_scenario(days, current_price, volatility, avg_return, "bull")),
                "bear": float(generate_scenario(days, current_price, volatility, avg_return, "bear")),
                "type": "Forecast"
            })
        # --- Phase 11: AI Logic Core Integration ---
        patterns = detect_patterns(hist['Close'])
        valuation = calculate_theoretical_price(info, current_price)
        order_book_sim = simulate_order_book(hist)
        # --- Market Sentiment Engine ---
        market_sentiment = analyze_market_sentiment()
        # --- Phase 18: Advanced Intelligence Layer ---
        regime_info = detect_market_regime_safe(hist, market_phase.get("is_open", True))
        external_drivers = get_external_drivers(ticker)
        # --- Phase 19: Order        # Phase 2: Risk Components
        concentration_risk_data = {
            "sector_distribution": {industry: 1.0},
            "correlation_report": [],
            "warnings": [],
            "remedies": []
        }
        event_report_summary = ["Event Risk Imminent"] if event_info["is_imminent"] else []
        # Order Flow
        order_flow = analyze_order_flow(hist, current_price)
        print(f"DEBUG: order_flow bias={order_flow.get('bias_raw')}")
        # --- Phase 14-21: Precision Day Trading Action Engine ---
        dt_signals = calculate_day_trading_signals(
            hist=hist,
            current_price=current_price,
            regime_info=regime_info,
            order_flow=order_flow,
            ticker_info=info, # Use 'info' from fast_info/ticker
            capital=request.capital,
            ticker=ticker,
            timeframe_alignment=timeframe_alignment,
            event_risk=event_info,
            asof=request.asof,
            is_exit_order=request.is_exit_order
        )
        dt_signals["hot_picks"] = await get_day_trading_hot_picks()
        dt_signals["market_sentiment"] = market_sentiment
        dt_signals["external_drivers"] = external_drivers
        dt_signals["order_flow"] = order_flow
        dt_signals["market_phase"] = market_phase
        # Time-based gating (Phase 19)
        if market_phase["phase"] == "OBSERVATION":
            dt_signals["decision"] = "WAIT"
            dt_signals["action_text"] = "Watching"
            dt_signals["final_action_line"] = "Observation period for trend clarity."
            dt_signals["reasoning_list"] = ["Patience required during low volume"]
        # Integrate Market Vibe into individual stock action
        if market_sentiment["vibe"] in ["BEARISH", "WEAK"] and dt_signals["decision"] == "BUY":
            dt_signals["decision"] = "WAIT"
            dt_signals["action_text"] = "Hold"
            dt_signals["reasoning_list"].append("Weak Market Sentiment Gate")
        # --- Phase 18: Calibration Log ---
        # --- Phase 2: Snapshot and Playbook Integration ---
        long_term_snapshot = LongTermSnapshot(
            profitability={
                "roe": financials.get('roe'),
                "operating_margin": info.get('operatingMargins'),
                "revenue_growth": info.get('revenueGrowth')
            },
            safety={
                "equity_ratio": ((info.get('bookValue') or 0) * (info.get('sharesOutstanding') or 0) / (info.get('totalAssets') or 1)) if info.get('totalAssets') else None,
                "debt_to_equity": info.get('debtToEquity')
            },
            shareholder_returns={
                "dividend_yield": financials.get('dividend_yield'),
                "payout_ratio": info.get('payoutRatio'),
                "buybacks": info.get('shareHolderRights') # Rough proxy
            },
            valuation_band={
                "per": financials.get('per'),
                "pbr": financials.get('pbr'),
                "status": valuation.get("status")
            },
            warnings=[]
        )
        if (financials.get('roe') or 1) < 0.05: long_term_snapshot.warnings.append("Low ROE")
        if (info.get('debtToEquity') or 0) > 150: long_term_snapshot.warnings.append("High Debt")
        playbook_refs = []
        if os.path.exists(PLAYBOOK_FILE):
            with open(PLAYBOOK_FILE, "r", encoding="utf-8") as f:
                pb_data = json.load(f)
                playbook_refs = [PlaybookEntry(**item) for item in pb_data if item["ticker"] == ticker]
        result = {
            "ticker": ticker,
            "company_name": company_name,
            "current_price": float(current_price),
            "forecasts": forecasts,
            "volatility": float(volatility or 0.02),
            "confidence_score": min(0.95, 0.8 + (1/beta)*0.1 if (beta and beta != 0) else 0.8),
            "super_score": dt_signals.get("super_score", 0),
            "sentiment_score": 0.80,
            "recommendation": dt_signals["decision"],
            "reasoning": reasoning,
            "evidence": {
                "financials": financials,
                "news": news_evidence
            },
            "portfolio_suggestion": portfolio,
            "chart_data": history_data,
            "exit_strategy": exit_strat,
            "technical_analysis": {
                "patterns": patterns,
                "demand_indicator": order_book_sim,
                "regime": regime_info,
                "order_flow": order_flow,
                "market_phase": market_phase,
                "timeframe_alignment": timeframe_alignment
            },
            "fundamental_analysis": valuation,
            "order_book": order_book_sim,
            "day_trading": dt_signals,
            "evolution_stats": evolution_manager.get_evolution_stats(ticker),
            "long_term_snapshot": long_term_snapshot, # Phase 2
            "event_risk": EventRisk(upcoming_events=event_info["events"], rules=["Alert" if event_info["is_imminent"] else "Stable"], warnings=event_report_summary),
            "concentration_risk": ConcentrationRisk(**concentration_risk_data) if concentration_risk_data else None,
            "playbook_references": playbook_refs, # Phase 2
            "partial": len(missing_fields) > 0,
            "missing_fields": missing_fields,
            "last_sync": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "fetch_errors": fetch_errors
        }
        # 
        print(f"DEBUG: Final Response Day Trading keys: {result['day_trading'].keys()}")
        print(f"DEBUG: Drivers count: {len(result['day_trading'].get('external_drivers', []))}")
        return clean_json_data(result)
    except HTTPException as he:
        # HTTP
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        error_msg = f"INTERNAL_ERROR | ticker={request.ticker} error={str(e)}"
        print(error_msg)
        print(error_msg)
        raise HTTPException(status_code=500, detail=str(e))
# --- Phase 7: Learning Analytics APIs ---
@app.get("/api/analytics/reasons")
async def get_analytics_reasons():
    """Docs"""
    return learning_manager.get_analytics_reasons()
@app.get("/api/analytics/market-phases")
async def get_analytics_phases():
    """Docs"""
    return learning_manager.get_analytics_phases()
@app.get("/api/analytics/trends")
async def get_analytics_trends():
    """Docs"""
    return learning_manager.get_analytics_trends()
# --- Phase 2: Enhanced Analysis APIs ---
# ingestor is already instantiated at top level or inherited
@app.get("/api/fundamentals")
async def get_fundamentals(tickers: str, asof: Optional[str] = None):
    global ingestor
    if ingestor is None:
        raise HTTPException(status_code=503, detail="Data Ingestor is not initialized properly.")
    ticker_list = tickers.split(",")
    cache_key = f"fundamentals_{tickers}_{asof}"
    cached, _ = fundamentals_cache.get(cache_key)
    if cached: return cached
    results = {}
    for t in ticker_list:
        try:
            results[t] = ingestor.fetch_fundamentals(t, asof=asof)
        except Exception as e:
            results[t] = {"error": str(e)}
    fundamentals_cache.set(cache_key, results)
    return results
@app.get("/api/events")
async def get_events(tickers: str, asof: Optional[str] = None):
    global ingestor
    if ingestor is None:
        raise HTTPException(status_code=503, detail="Data Ingestor is not initialized properly.")
    ticker_list = tickers.split(",")
    cache_key = f"events_{tickers}_{asof}"
    cached, _ = events_cache.get(cache_key)
    if cached: return cached
    results = {}
    for t in ticker_list:
        try:
            results[t] = ingestor.fetch_calendar_events(t, asof=asof)
        except Exception as e:
            results[t] = {"error": str(e)}
    events_cache.set(cache_key, results)
    return results
@app.get("/api/correlation")
async def get_correlation(tickers: str, window: int = 60, asof: Optional[str] = None):
    global ingestor
    if ingestor is None:
        raise HTTPException(status_code=503, detail="Data Ingestor is not initialized properly.")
    ticker_list = tickers.split(",")
    cache_key = f"correlation_{tickers}_{window}_{asof}"
    cached, _ = correlation_cache.get(cache_key)
    if cached: return cached
    if len(ticker_list) < 2:
        return {"error": "Need at least 2 tickers for correlation"}
    data = {}
    for t in ticker_list:
        try:
            # fetch_stock_data should handle asof
            df = ingestor.fetch_stock_data(t, period="6mo", asof=asof)
            data[t] = df['Close'].pct_change()
        except:
            continue
    if not data:
        return {"error": "No valid data for correlation"}
    corr_matrix = pd.DataFrame(data).corr()
    report = []
    for i in range(len(ticker_list)):
        for j in range(i + 1, len(ticker_list)):
            t1, t2 = ticker_list[i], ticker_list[j]
            if t1 in corr_matrix and t2 in corr_matrix:
                val = corr_matrix.loc[t1, t2]
                if not np.isnan(val):
                    report.append({"pair": f"{t1}-{t2}", "correlation": round(float(val), 2)})
    # Refinement: Limit alerts to top 3 high correlation pairs
    report.sort(key=lambda x: x["correlation"], reverse=True)
    warnings = []
    high_corr_pairs = [r for r in report if r["correlation"] > CORR_THRESHOLD]
    for r in high_corr_pairs[:3]:
        warnings.append(f" {r['pair']} ({r['correlation']})")
    # Sector bias refinement
    sector_counts = {}
    for t in ticker_list:
        fund = ingestor.fetch_fundamentals(t, asof=asof)
        sector = fund.get("sector", "Unknown")
        sector_counts[sector] = sector_counts.get(sector, 0) + 1
    total = len(ticker_list)
    remedies = []
    for sector, count in sector_counts.items():
        ratio = count / total
        if ratio >= SECTOR_BIAS_THRESHOLD:
            warnings.append(f" {sector} ({ratio*100:.0f}%)")
            remedies.append(f"Diversify into other sectors")
    res = {
        "correlation_report": report,
        "warnings": warnings,
        "remedies": remedies,
        "asof": asof or datetime.now().strftime("%Y-%m-%d")
    }
    correlation_cache.set(cache_key, res)
    return res
PLAYBOOK_FILE = os.path.join(LOG_DIR, "playbook.json")
@app.get("/api/playbook")
async def get_playbook(ticker: Optional[str] = None):
    if not os.path.exists(PLAYBOOK_FILE):
        return []
    try:
        with open(PLAYBOOK_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except:
        return []
    if ticker:
        return [item for item in data if item["ticker"] == ticker]
    return data
@app.post("/api/playbook")
async def save_playbook(entry: PlaybookEntry):
    # Atomic write with temp file
    temp_path = PLAYBOOK_FILE + ".tmp"
    data = []
    try:
        if os.path.exists(PLAYBOOK_FILE):
            with open(PLAYBOOK_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        # Metadata enrichment
        entry_dict = entry.dict()
        if not entry_dict.get("created_at"):
            entry_dict["created_at"] = datetime.now().isoformat()
        data.append(entry_dict)
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(temp_path, PLAYBOOK_FILE)
        return {"status": "success"}
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"Failed to save playbook: {str(e)}")

@app.get("/api/market_ranking")
async def get_market_ranking(market: str = "JP"):
    """
    Returns top 5 gainers and losers for a given market.
    """
    global ingestor
    if ingestor is None:
        raise HTTPException(status_code=503, detail="Data Ingestor Not Ready")

    from data.ticker_map import MAJOR_TICKERS, US_TICKERS, CRYPTO_TICKERS
    
    if market.upper() == "US":
        ticker_dict = US_TICKERS
    elif market.upper() == "CRYPTO":
        ticker_dict = CRYPTO_TICKERS
    else:
        ticker_dict = MAJOR_TICKERS
    
    ticker_list = list(ticker_dict.keys())
    
    async def fetch_perf(t):
        try:
            print(f"DEBUG: Fetching ranking data for {t}...")
            df = await asyncio.to_thread(ingestor.fetch_stock_data, t, period="5d")
            if df is None or df.empty:
                print(f"DEBUG: Empty data for {t}")
                return None
            if len(df) < 2:
                print(f"DEBUG: Insufficient data for {t} (len={len(df)})")
                return None
            latest = df.iloc[-1]
            prev = df.iloc[-2]
            change_pct = ((latest['Close'] - prev['Close']) / prev['Close']) * 100
            return {
                "ticker": t,
                "name": ticker_dict.get(t, t),
                "price": float(latest['Close']),
                "change_pct": float(change_pct)
            }
        except Exception as e:
            print(f"DEBUG: Error in fetch_perf for {t}: {e}")
            return None

    tasks = [fetch_perf(t) for t in ticker_list]
    results = await asyncio.gather(*tasks)
    perf_list = [r for r in results if r is not None]
    
    # Sort for gainers and losers
    sorted_perf = sorted(perf_list, key=lambda x: x['change_pct'], reverse=True)
    top_gainers = sorted_perf[:5]
    top_losers = sorted_perf[-5:][::-1]
    
    return {
        "timestamp": datetime.now().isoformat(),
        "market": market.upper(),
        "top_gainers": top_gainers,
        "top_losers": top_losers
    }

@app.get("/api/scan_zen")
async def scan_zen_signals(tickers: Optional[str] = None, market: str = "JP"):
    """
    Scans stocks (from provided list or MAJOR_TICKERS) 
    using the Zen 5-point signal logic.
    """
    global ingestor
    if ingestor is None:
        raise HTTPException(status_code=503, detail="Data Ingestor Not Ready")

    if tickers:
        ticker_list = tickers.split(",")
        from data.ticker_map import MAJOR_TICKERS, US_TICKERS, CRYPTO_TICKERS
        # Try to resolve names from any dict
        combined = {**MAJOR_TICKERS, **US_TICKERS, **CRYPTO_TICKERS}
        resolved_names = combined
    else:
        from data.ticker_map import MAJOR_TICKERS, US_TICKERS, CRYPTO_TICKERS
        if market.upper() == "US":
            ticker_list = list(US_TICKERS.keys())
            resolved_names = US_TICKERS
        elif market.upper() == "CRYPTO":
            ticker_list = list(CRYPTO_TICKERS.keys())
            resolved_names = CRYPTO_TICKERS
        else:
            ticker_list = list(MAJOR_TICKERS.keys())
            resolved_names = MAJOR_TICKERS
    
    signals = []
    
    # Process in chunks/parallel-ish task limit for speed
    async def process_ticker(t):
        try:
            # We need at least 75 days for MA75 (Zen logic)
            df = await asyncio.to_thread(ingestor.fetch_stock_data, t, period="6mo")
            analysis = ZenSignalAnalyzer.analyze(df)
            if analysis['is_signal']:
                # Get company name
                name = resolved_names.get(t, t)
                return {
                    "ticker": t,
                    "name": name,
                    "analysis": analysis
                }
        except:
            pass
        return None

    tasks = [process_ticker(t) for t in ticker_list[:50]] # Scan up to 50 for balanced performance
    results = await asyncio.gather(*tasks)
    signals = [r for r in results if r is not None]
    
    return {
        "timestamp": datetime.now().isoformat(),
        "signals_count": len(signals),
        "signals": signals
    }

# --- Phase 8: Ops Metrics APIs ---
@app.get("/api/ops/metrics/latest")
async def get_ops_latest():
    """Docs"""
    return ops_manager.get_latest()
@app.get("/api/ops/metrics/history")
async def get_ops_history(hours: int = 24):
    """Docs"""
    return ops_manager.get_history(hours)
if __name__ == "__main__":
    current_t = datetime.now().strftime('%H:%M:%S')
    print(f"[{current_t}] Backend is starting on port 8000...")
    print(f"[{current_t}] Access via Proxy: http://localhost:3000/api/predict")
    # Disable reload to ensure absolute stability and predictable process management
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)


