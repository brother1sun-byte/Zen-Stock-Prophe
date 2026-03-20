
import os
import json
import time
import statistics
from datetime import datetime, timedelta
from collections import defaultdict

class OpsMetricsManager:
    def __init__(self, log_dir: str):
        self.log_dir = log_dir
        self.log_path = os.path.join(self.log_dir, "ops_metrics_log.json")
        self._ensure_log_exists()
        
        # State
        self.current_window_start = datetime.now()
        # Structure: self.buffers[route_key] = { "latencies": [], "statuses": [], "degraded_count": 0, "error_429_count": 0 }
        self.buffers = defaultdict(lambda: {
            "latencies": [],
            "statuses": [],
            "degraded_count": 0,
            "error_429_count": 0
        })
        
        # Minimum interval for flushing (e.g., 1 hour)
        self.FLUSH_INTERVAL_SECONDS = 3600 

    def _ensure_log_exists(self):
        if not os.path.exists(self.log_path):
            with open(self.log_path, 'w', encoding='utf-8') as f:
                json.dump([], f)

    def record_request(self, latency: float, status_code: int, route_key: str = "other", is_degraded: bool = False):
        """
        Record a request metric and check if flush is needed.
        latency: seconds
        route_key: 'predict' or 'other'
        """
        # 1. Add to Buffer
        buf = self.buffers[route_key]
        buf["latencies"].append(latency)
        buf["statuses"].append(status_code)
        if is_degraded:
            buf["degraded_count"] += 1
        if status_code == 429:
            buf["error_429_count"] += 1
            
        # 2. Check Time Logic (Request-Triggered Snapshot)
        now = datetime.now()
        elapsed = (now - self.current_window_start).total_seconds()
        
        if elapsed >= self.FLUSH_INTERVAL_SECONDS:
            self.flush_metrics(now)

    def flush_metrics(self, flush_time: datetime):
        """Calculate stats for all routes and write to log."""
        snapshot = {
            "timestamp": flush_time.isoformat(),
            "routes": {}
        }
        
        has_data = False
        
        for route_key, buf in self.buffers.items():
            count = len(buf["latencies"])
            if count == 0:
                continue
                
            has_data = True
            
            # Latency Stats
            lats = sorted(buf["latencies"])
            avg = statistics.mean(lats)
            max_lat = max(lats)
            
            # p95 logic: null if samples < 20 to avoid noise
            if count >= 20:
                p95_idx = int(count * 0.95)
                p95 = lats[p95_idx]
                p50_idx = int(count * 0.50)
                p50 = lats[p50_idx]
            else:
                p95 = None
                p50_idx = int(count * 0.50)
                p50 = lats[p50_idx]

            # Reliability Stats
            success_count = sum(1 for s in buf["statuses"] if 200 <= s < 300)
            success_rate = (success_count / count) * 100
            degraded_rate = (buf["degraded_count"] / count) * 100
            
            route_stats = {
                "latency": {
                    "p50": round(p50, 3),
                    "p95": round(p95, 3) if p95 is not None else None,
                    "avg": round(avg, 3),
                    "max": round(max_lat, 3)
                },
                "rates": {
                    "success": round(success_rate, 1),
                    "degraded": round(degraded_rate, 1)
                },
                "counts": {
                    "total": count,
                    "error_429": buf["error_429_count"]
                }
            }
            snapshot["routes"][route_key] = route_stats
            
        # Reset Buffers
        self.buffers.clear()
        self.current_window_start = flush_time
        
        if not has_data:
            return

        # Write to Log (Atomic Write)
        temp_path = self.log_path + ".tmp"
        try:
            # 1. Read existing
            history = []
            if os.path.exists(self.log_path):
                try:
                    with open(self.log_path, 'r', encoding='utf-8') as f:
                        history = json.load(f)
                        if not isinstance(history, list):
                            history = []
                except (json.JSONDecodeError, Exception) as e:
                    print(f"WARNING: Ops Log corrupted, resetting: {e}")
                    history = []
            
            # 2. Append new
            history.append(snapshot)
            if len(history) > 168:
                history = history[-168:]
                
            # 3. Write to temp then rename
            with open(temp_path, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2)
            
            os.replace(temp_path, self.log_path)
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            print(f"ERROR writing Ops Log: {e}")

    def get_latest(self):
        """Return the current in-memory status (approximate) or last snapshot."""
        # Return stats of CURRENT accumulating window for real-time view?
        # Specification says "get_ops_latest". 
        # Usually implies the last *finished* snapshot. 
        # But if valid snapshot is only every hour, user sees old data.
        # User requirement implies "snapshot" based.
        # Let's return the last logged snapshot.
        history = self.get_history(hours=1)
        if history:
            return history[-1]
        return {}

    def get_history(self, hours: int = 24):
        """Get last N hours of metrics"""
        if not os.path.exists(self.log_path):
            return []
        try:
            with open(self.log_path, 'r', encoding='utf-8') as f:
                try:
                    data = json.load(f)
                except (json.JSONDecodeError, Exception):
                    return []
                # Filter by timestamp? Simpler: just return last N entries if we assume 1 entry/hour
                return data[-hours:] if data else []
        except Exception:
            return []
