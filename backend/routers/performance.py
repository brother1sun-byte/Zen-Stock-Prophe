from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import os
import json
import uuid
import threading
import shutil
import re

router = APIRouter()

# --- 1. Data Models (Strict) ---

class DiaryEntry(BaseModel):
    version: str = "1"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")  # YYYY-MM-DD
    ticker: str = Field(..., min_length=1, max_length=20)
    scenario_type: str = Field(..., pattern=r"^(gap_up|gap_down|range)$")
    planned_action: str = Field(..., max_length=200)
    actual_action: str = Field(..., max_length=200)
    result: str = Field(..., pattern=r"^(win|loss|flat|skip)$")
    pnl_yen: Optional[float] = None
    notes: Optional[str] = Field(None, max_length=1000)

class PortfolioRequest(BaseModel):
    tickers: List[str] = Field(..., max_items=50)

    @validator('tickers')
    def validate_tickers(cls, v):
        # Remove duplicates while preserving order
        seen = set()
        unique = []
        for ticker in v:
            ticker = ticker.strip()
            if ticker and ticker not in seen:
                # Basic format validation: alphanumeric, dots, hyphens
                if not re.match(r'^[a-zA-Z0-9._-]+$', ticker):
                    raise ValueError(f"Invalid ticker format: {ticker}")
                seen.add(ticker)
                unique.append(ticker)
        return unique

class ScenarioScore(BaseModel):
    version: str = "1"
    ticker: str
    period_start: str
    period_end: str
    total_trades: int
    win_rate: float
    hit_rate: float
    notes: Optional[str] = None
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())

# --- 2. Persistence Layer (Robust) ---

DIARY_BASE_DIR = os.getenv("DIARY_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "diary"))
PORTFOLIO_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "portfolio.json")
write_lock = threading.Lock()

def sanitize_ticker(ticker: str) -> str:
    """Sanitize ticker for filename use."""
    return re.sub(r"[^a-zA-Z0-9._-]", "", ticker)

def get_diary_path(date_str: str, ticker: str) -> str:
    """Get path to monthly ticker-specific diary file. YYYY-MM/TICKER.json"""
    year_month = date_str[:7]  # YYYY-MM
    safe_ticker = sanitize_ticker(ticker)
    month_dir = os.path.join(DIARY_BASE_DIR, year_month)
    os.makedirs(month_dir, exist_ok=True)
    return os.path.join(month_dir, f"{safe_ticker}.json")

def atomic_save_diary(file_path: str, entries: List[dict]):
    """Save entries to file using tmp + rename pattern. Lock must be held by caller."""
    tmp_path = f"{file_path}.tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=4, ensure_ascii=False)
        os.replace(tmp_path, file_path)
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise IOError(f"Atomic write failed: {str(e)}")

# --- 3. Helpers for Scoring (Internal) ---

def get_entries_for_ticker(ticker: str, start_dt: datetime, end_dt: datetime) -> List[dict]:
    """Fetch entries for a ticker within a date range."""
    period_start = start_dt.strftime("%Y-%m-%d")
    period_end = end_dt.strftime("%Y-%m-%d")
    
    months_to_search = []
    curr = start_dt
    while curr <= end_dt:
        ym = curr.strftime("%Y-%m")
        if ym not in months_to_search:
            months_to_search.append(ym)
        curr += timedelta(days=1)

    all_entries = []
    safe_ticker = sanitize_ticker(ticker)
    for ym in months_to_search:
        file_path = os.path.join(DIARY_BASE_DIR, ym, f"{safe_ticker}.json")
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    month_data = json.load(f)
                    for entry in month_data:
                        if period_start <= entry["date"] <= period_end:
                            all_entries.append(entry)
            except Exception:
                continue
    return all_entries

def calculate_metrics(entries: List[dict]) -> dict:
    """Calculate counts and rates from a list of entries."""
    win_count = 0
    loss_count = 0
    flat_count = 0
    skip_count = 0
    
    for e in entries:
        res = e.get("result")
        if res == "win": win_count += 1
        elif res == "loss": loss_count += 1
        elif res == "flat": flat_count += 1
        elif res == "skip": skip_count += 1
    
    total_entries = len(entries)
    total_trades = win_count + loss_count + flat_count
    
    def safe_div(n, d):
        return n / d if d > 0 else 0.0

    return {
        "total_entries": total_entries,
        "total_trades": total_trades,
        "win_count": win_count,
        "loss_count": loss_count,
        "flat_count": flat_count,
        "skip_count": skip_count,
        "win_rate": round(safe_div(win_count, total_trades), 4),
        "execution_rate": round(safe_div(total_trades, total_entries), 4),
        "skip_rate": round(safe_div(skip_count, total_entries), 4)
    }

# --- 4. Endpoints ---

@router.post("/api/diary")
async def save_diary_entry(entry: DiaryEntry):
    """Save a single trade diary entry."""
    try:
        file_path = get_diary_path(entry.date, entry.ticker)
        
        with write_lock:
            existing_entries = []
            if os.path.exists(file_path):
                with open(file_path, "r", encoding="utf-8") as f:
                    existing_entries = json.load(f)
            
            existing_entries.append(entry.dict())
            atomic_save_diary(file_path, existing_entries)
        
        return {"ok": True, "entry": entry}
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail={"ok": False, "error": "INTERNAL_SERVER_ERROR", "message": f"保存に失敗しました: {str(e)}"}
        )

@router.get("/api/diary")
async def get_diary_entries(
    ticker: str = Query(..., min_length=1),
    from_date: Optional[str] = Query(None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to_date: Optional[str] = Query(None, alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    limit: int = Query(50, ge=1, le=200)
):
    """Retrieve diary entries for a ticker with date range filtering."""
    try:
        months_to_search = []
        if from_date and to_date:
            start_m = from_date[:7]
            end_m = to_date[:7]
            current_m = start_m
            while current_m <= end_m:
                months_to_search.append(current_m)
                year, month = map(int, current_m.split('-'))
                month += 1
                if month > 12: month = 1; year += 1
                current_m = f"{year:04d}-{month:02d}"
        elif from_date:
            start_m = from_date[:7]
            end_m = datetime.now().strftime("%Y-%m")
            current_m = start_m
            while current_m <= end_m:
                months_to_search.append(current_m)
                year, month = map(int, current_m.split('-'))
                month += 1
                if month > 12: month = 1; year += 1
                current_m = f"{year:04d}-{month:02d}"
        else:
            now = datetime.now()
            for i in range(3):
                target = (now.year * 12 + now.month - 1 - i)
                y = target // 12
                mo = (target % 12) + 1
                months_to_search.append(f"{y:04d}-{mo:02d}")

        all_results = []
        safe_ticker = sanitize_ticker(ticker)
        
        for ym in months_to_search:
            file_path = os.path.join(DIARY_BASE_DIR, ym, f"{safe_ticker}.json")
            if os.path.exists(file_path):
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        month_entries = json.load(f)
                        for entry_data in month_entries:
                            if from_date and entry_data["date"] < from_date: continue
                            if to_date and entry_data["date"] > to_date: continue
                            all_results.append(entry_data)
                except Exception:
                    continue

        all_results.sort(key=lambda x: (x["date"], x["created_at"]), reverse=True)
        
        return {
            "ok": True, 
            "items": all_results[:limit],
            "total_found": len(all_results)
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": "SEARCH_ERROR", "message": f"検索中にエラーが発生しました: {str(e)}"}
        )

@router.get("/api/scoring")
async def get_scoring(
    ticker: str = Query(..., min_length=1),
    asof: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    period: str = Query("weekly")
):
    """Retrieve performance metrics for a single ticker."""
    try:
        end_date_dt = datetime.strptime(asof, "%Y-%m-%d") if asof else datetime.now()
        start_date_dt = end_date_dt - timedelta(days=6)
        
        entries = get_entries_for_ticker(ticker, start_date_dt, end_date_dt)
        metrics = calculate_metrics(entries)

        return {
            "ok": True,
            "ticker": ticker,
            "period": period,
            "asof": end_date_dt.strftime("%Y-%m-%d"),
            "period_start": start_date_dt.strftime("%Y-%m-%d"),
            "period_end": end_date_dt.strftime("%Y-%m-%d"),
            **metrics,
            "partial": len(entries) == 0,
            "missing_fields": ["entries"] if len(entries) == 0 else [],
            "last_sync": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": "SCORING_ERROR", "message": f"集計エラー: {str(e)}"}
        )

@router.get("/api/scoring/aggregate")
async def get_aggregate_scoring(
    tickers: str = Query(..., min_length=1),
    asof: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    period: str = Query("weekly")
):
    """Aggregate performance metrics for multiple tickers."""
    try:
        ticker_list = [t.strip() for t in tickers.split(",") if t.strip()][:50]
        end_date_dt = datetime.strptime(asof, "%Y-%m-%d") if asof else datetime.now()
        start_date_dt = end_date_dt - timedelta(days=6)
        
        all_entries = []
        per_ticker_metrics = []
        
        for ticker in ticker_list:
            entries = get_entries_for_ticker(ticker, start_date_dt, end_date_dt)
            if not entries: continue
            
            all_entries.extend(entries)
            m = calculate_metrics(entries)
            per_ticker_metrics.append({
                "ticker": ticker,
                "total_trades": m["total_trades"],
                "win_rate": m["win_rate"],
                "execution_rate": m["execution_rate"]
            })
            
        # Overall metrics
        overall = calculate_metrics(all_entries)
        # Sort per_ticker by trades DESC
        per_ticker_metrics.sort(key=lambda x: x["total_trades"], reverse=True)
        
        return {
            "ok": True,
            "period": period,
            "period_start": start_date_dt.strftime("%Y-%m-%d"),
            "period_end": end_date_dt.strftime("%Y-%m-%d"),
            "tickers_count": len(ticker_list),
            **overall,
            "per_ticker": per_ticker_metrics[:10],
            "updated_at": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": "AGGREGATE_ERROR", "message": f"全体集計エラー: {str(e)}"}
        )

@router.get("/api/scoring/by_rule")
async def get_rule_scoring(
    tickers: Optional[str] = Query(None),
    ticker: Optional[str] = Query(None),
    asof: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    period: str = Query("weekly")
):
    """Aggregate performance metrics grouped by rule (scenario_type)."""
    try:
        if tickers:
            ticker_list = [t.strip() for t in tickers.split(",") if t.strip()]
        elif ticker:
            ticker_list = [ticker]
        else:
            raise HTTPException(status_code=400, detail="ticker or tickers required")
        
        ticker_list = ticker_list[:50]
        end_date_dt = datetime.strptime(asof, "%Y-%m-%d") if asof else datetime.now()
        start_date_dt = end_date_dt - timedelta(days=6)
        
        rules_data = {"gap_up": [], "gap_down": [], "range": []}
        
        for t in ticker_list:
            entries = get_entries_for_ticker(t, start_date_dt, end_date_dt)
            for e in entries:
                rtype = e.get("scenario_type")
                if rtype in rules_data:
                    rules_data[rtype].append(e)
        
        res_rules = {}
        for rtype, r_entries in rules_data.items():
            res_rules[rtype] = calculate_metrics(r_entries)
            
        return {
            "ok": True,
            "period": period,
            "period_start": start_date_dt.strftime("%Y-%m-%d"),
            "period_end": end_date_dt.strftime("%Y-%m-%d"),
            "rules": res_rules,
            "updated_at": datetime.now().isoformat()
        }
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": "RULE_ERROR", "message": f"ルール別集計エラー: {str(e)}"}
        )

@router.get("/api/review")
async def get_weekly_review(
    from_date: str = Query(..., alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to_date: str = Query(..., alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    tickers: Optional[str] = Query(None) # Comma separated
):
    """Weekly review aggregation across multiple tickers."""
    try:
        ticker_list = [t.strip() for t in tickers.split(",")] if tickers else []
        
        # Calculate months to search
        start_m = from_date[:7]
        end_m = to_date[:7]
        months_to_search = []
        current_m = start_m
        while current_m <= end_m:
            months_to_search.append(current_m)
            year, month = map(int, current_m.split('-'))
            month += 1
            if month > 12: month = 1; year += 1
            current_m = f"{year:04d}-{month:02d}"

        all_entries = []
        
        # If tickers provided, search specific files. If not, search all files in these months.
        for ym in months_to_search:
            month_dir = os.path.join(DIARY_BASE_DIR, ym)
            if not os.path.exists(month_dir): continue
            
            if ticker_list:
                for t in ticker_list:
                    file_path = os.path.join(month_dir, f"{sanitize_ticker(t)}.json")
                    if os.path.exists(file_path):
                        with open(file_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            for e in data:
                                if from_date <= e["date"] <= to_date:
                                    all_entries.append(e)
            else:
                # Search ALL files in the month directory
                for filename in os.listdir(month_dir):
                    if filename.endswith(".json"):
                        file_path = os.path.join(month_dir, filename)
                        with open(file_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            for e in data:
                                if from_date <= e["date"] <= to_date:
                                    all_entries.append(e)

        metrics = calculate_metrics(all_entries)
        
        # Additional Review specific metrics
        pnl_values = [e.get("pnl_yen", 0) for e in all_entries if e.get("pnl_yen") is not None]
        best_pnl = max(pnl_values) if pnl_values else 0
        worst_pnl = min(pnl_values) if pnl_values else 0
        
        notes = []
        if metrics["win_rate"] >= 0.6: notes.append("良好な勝率を維持しています。")
        elif metrics["win_rate"] <= 0.4 and metrics["total_trades"] > 0: notes.append("勝率が低下しています。ルールの再確認が必要です。")
        
        if metrics["execution_rate"] < 0.3: notes.append("実行率が低いです。チャンスを逃している可能性があります。")
        
        return {
            "ok": True,
            "total_entries": metrics["total_entries"],
            "executed_trades": metrics["total_trades"],
            "win_rate": metrics["win_rate"],
            "execution_rate": metrics["execution_rate"],
            "best_trade": best_pnl,
            "worst_trade": worst_pnl,
            "notes": notes,
            "asof": to_date,
            "partial": len(all_entries) == 0,
            "missing_fields": ["diary_entries"] if len(all_entries) == 0 else [],
            "last_sync": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": "REVIEW_ERROR", "message": str(e)}
        )

# --- Portfolio Management ---

@router.get("/api/portfolio")
async def get_portfolio():
    """Get saved portfolio tickers."""
    try:
        if os.path.exists(PORTFOLIO_FILE):
            with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {
                    "ok": True,
                    "tickers": data.get("tickers", []),
                    "updated_at": data.get("updated_at", datetime.now().isoformat())
                }
        else:
            return {
                "ok": True,
                "tickers": [],
                "updated_at": datetime.now().isoformat()
            }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": "PORTFOLIO_READ_ERROR", "message": str(e)}
        )

@router.post("/api/portfolio")
async def save_portfolio(request: PortfolioRequest):
    """Save portfolio tickers with atomic write."""
    try:
        # Validate ticker count
        if len(request.tickers) > 50:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": "TOO_MANY_TICKERS", "message": "Maximum 50 tickers allowed"}
            )
        
        # Prepare data
        data = {
            "tickers": request.tickers,
            "updated_at": datetime.now().isoformat()
        }
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(PORTFOLIO_FILE), exist_ok=True)
        
        # Atomic write
        with write_lock:
            temp_file = PORTFOLIO_FILE + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            shutil.move(temp_file, PORTFOLIO_FILE)
        
        return {
            "ok": True,
            "tickers": request.tickers,
            "updated_at": data["updated_at"]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": "PORTFOLIO_SAVE_ERROR", "message": str(e)}
        )
