from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
import os
import json
import shutil
import time
from datetime import datetime

router = APIRouter()

# --- 1. Data Models (Strict) ---

class ScenarioRule(BaseModel):
    entry_condition: str = Field(..., max_length=100)
    take_profit: str = Field(..., max_length=50)
    stop_loss: str = Field(..., max_length=50)
    lot_cap: str = Field("100", max_length=20)
    no_trade_condition: str = Field("", max_length=100)
    note: str = Field("", max_length=200)

class ScenarioRuleSet(BaseModel):
    version: str = Field("1.0", pattern=r"^\d+\.\d+$")
    ticker: str = Field(..., min_length=1, max_length=20)
    asof: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$") # YYYY-MM-DD
    created_at: str
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    rules_gap_up: ScenarioRule
    rules_gap_down: ScenarioRule
    rules_range: ScenarioRule

class ScenarioEvaluationRequest(BaseModel):
    ticker: str
    asof: str
    current_price: float
    open_price: float
    prev_close: float
    market_regime: Optional[str] = None
    rules: Optional[ScenarioRuleSet] = None

class ScenarioEvaluationResult(BaseModel):
    scenario_type: str # GAP_UP, GAP_DOWN, RANGE, NO_TRADE
    recommended_action: str
    reason: str
    risk_note: str
    lot_cap: str
    computed_inputs: Dict[str, float]
    metadata: Dict[str, Any] = {} # For debugging/audit

# --- 2. Persistence Layer (Robust) ---
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "scenarios")
os.makedirs(DATA_DIR, exist_ok=True)

def _get_file_path(ticker: str, asof: str) -> str:
    # Sanitize inputs to prevent path traversal
    safe_ticker = "".join(x for x in ticker if x.isalnum() or x in "._-")
    safe_asof = "".join(x for x in asof if x.isalnum() or x == "-")
    return os.path.join(DATA_DIR, f"{safe_ticker}_{safe_asof}.json")

def _atomic_write(file_path: str, data: dict):
    """Writes data to a temp file then renames it for atomicity."""
    temp_path = f"{file_path}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        # Atomic replace
        shutil.move(temp_path, file_path)
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise IOError(f"Failed to write scenario file: {e}")

# --- 3. Endpoints ---

@router.get("/api/scenario", response_model=Optional[ScenarioRuleSet])
async def get_scenario(ticker: str, asof: str):
    file_path = _get_file_path(ticker, asof)
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Basic migration/validation could go here
            return data
        except Exception as e:
            print(f"Error loading scenario: {e}")
            return None
    return None

@router.post("/api/scenario", response_model=Dict[str, str])
async def save_scenario(data: ScenarioRuleSet):
    # Validation
    if not data.ticker or not data.asof:
        raise HTTPException(status_code=400, detail="Ticker and Asof are required")
    
    file_path = _get_file_path(data.ticker, data.asof)
    try:
        data.updated_at = datetime.now().isoformat()
        _atomic_write(file_path, data.dict())
        return {"status": "success", "path": file_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Persistence error: {str(e)}")

@router.post("/api/scenario/evaluate", response_model=ScenarioEvaluationResult)
async def evaluate_scenario(req: ScenarioEvaluationRequest):
    # 1. Load Rules
    rules = req.rules
    if not rules:
        loaded = await get_scenario(req.ticker, req.asof)
        if not loaded:
             return ScenarioEvaluationResult(
                scenario_type="UNKNOWN",
                recommended_action="シナリオ未登録(No Rules)",
                reason="該当する週末シナリオが見つかりません",
                risk_note="ルールを設定してください",
                lot_cap="0",
                computed_inputs={}
            )
        rules = ScenarioRuleSet(**loaded)

    # 2. Compute Gap
    if req.prev_close == 0:
        gap_pct = 0.0
    else:
        gap_pct = ((req.open_price - req.prev_close) / req.prev_close) * 100

    # 3. Determine Scenario Type
    # Configurable Thresholds? For now, fixed.
    GAP_THRESHOLD_UP = 0.5 # +0.5%
    GAP_THRESHOLD_DOWN = -0.5 # -0.5%
    
    selected_scenario = "RANGE"
    active_rule = rules.rules_range
    reason_base = f"Gap {gap_pct:.2f}% inside [{GAP_THRESHOLD_DOWN}%, {GAP_THRESHOLD_UP}%]"

    if gap_pct > GAP_THRESHOLD_UP:
        selected_scenario = "GAP_UP"
        active_rule = rules.rules_gap_up
        reason_base = f"Gap {gap_pct:.2f}% > {GAP_THRESHOLD_UP}% (Gap Up)"
    elif gap_pct < GAP_THRESHOLD_DOWN:
        selected_scenario = "GAP_DOWN"
        active_rule = rules.rules_gap_down
        reason_base = f"Gap {gap_pct:.2f}% < {GAP_THRESHOLD_DOWN}% (Gap Down)"

    # 4. Check No-Trade Condition (Priority 1)
    # This is a text-based check for now.
    nt_cond = active_rule.no_trade_condition.strip()
    is_no_trade = False
    
    # Simple logic: if NT condition is NOT empty and matches a "truthy" keyword?
    # Or implies "User must check this".
    # Requirement: "no_trade -> gap ... -> entry"
    # If NT condition is written, we treat it as a WARNING/CHECK requirement.
    # We can't auto-evaluate text like "VIX>30" without a parser.
    # BUT, if req.market_regime is provided (e.g. from macro), we could check.
    # For this iteration: If NT cond exists, append to risk_note.
    
    final_action = f"Entry: {active_rule.entry_condition} / TP: {active_rule.take_profit} / SL: {active_rule.stop_loss}"
    risk_note = active_rule.note
    
    if nt_cond:
         risk_note = f"[NO TRADE CHECK] {nt_cond} | {risk_note}"
         # If strict, we might set action to "WAIT"
         # But usually NT is conditional. We'll leave it as a strong note.

    # 5. Result
    return ScenarioEvaluationResult(
        scenario_type=selected_scenario,
        recommended_action=final_action,
        reason=reason_base,
        risk_note=risk_note,
        lot_cap=active_rule.lot_cap,
        computed_inputs={
            "gap_pct": gap_pct,
            "current_price": req.current_price,
            "open_price": req.open_price,
            "prev_close": req.prev_close
        },
        metadata={"version": rules.version, "evaluated_at": datetime.now().isoformat()}
    )
