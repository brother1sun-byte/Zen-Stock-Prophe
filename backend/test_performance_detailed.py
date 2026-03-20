#!/usr/bin/env python3
"""
パフォーマンステストスクリプト（提出品質版）
- N=30回の試行で p50 / p95 / max を計測
- キャッシュ状態（cold/warm）を明記
- 内訳計測: fetch_ms / analysis_ms / total_ms
"""
import requests
import time
import statistics
import json

API_URL = "http://127.0.0.1:8000/api/hot-picks"
N_TRIALS = 30

def measure_performance(trial_id, cache_state):
    """1回の試行を計測"""
    start = time.time()
    try:
        response = requests.get(API_URL, timeout=10)
        elapsed = (time.time() - start) * 1000  # ms
        
        if response.status_code == 200:
            data = response.json()
            picks = data.get("picks", [])
            
            # 内訳計測（各pickのfetch_ms/analysis_msを集計）
            fetch_times = [p.get("fetch_ms", 0) for p in picks if "fetch_ms" in p]
            analysis_times = [p.get("analysis_ms", 0) for p in picks if "analysis_ms" in p]
            
            return {
                "success": True,
                "total_ms": elapsed,
                "fetch_ms_avg": statistics.mean(fetch_times) if fetch_times else 0,
                "analysis_ms_avg": statistics.mean(analysis_times) if analysis_times else 0,
                "picks_count": len(picks),
                "cache_state": cache_state
            }
        else:
            return {"success": False, "total_ms": elapsed, "error": response.status_code}
    except Exception as e:
        elapsed = (time.time() - start) * 1000
        return {"success": False, "total_ms": elapsed, "error": str(e)}

def main():
    print(f"🧪 Starting Performance Test (N={N_TRIALS})")
    print("=" * 60)
    
    results = []
    
    # Cold start (キャッシュクリア想定: 最初の3回)
    print("\n[Cold Start: 1-3回目]")
    for i in range(3):
        result = measure_performance(i+1, "cold")
        results.append(result)
        print(f"  Trial {i+1}: {result['total_ms']:.2f}ms")
        time.sleep(0.5)
    
    # Warm cache (キャッシュヒット期待: 4-30回目)
    print("\n[Warm Cache: 4-30回目]")
    for i in range(3, N_TRIALS):
        result = measure_performance(i+1, "warm")
        results.append(result)
        if (i+1) % 5 == 0:
            print(f"  Trial {i+1}: {result['total_ms']:.2f}ms")
        time.sleep(0.3)
    
    # 統計計算
    successful = [r for r in results if r["success"]]
    total_times = [r["total_ms"] for r in successful]
    
    if not total_times:
        print("\n❌ すべての試行が失敗しました")
        return
    
    p50 = statistics.median(total_times)
    p95 = statistics.quantiles(total_times, n=20)[18]  # 95パーセンタイル
    max_time = max(total_times)
    avg_time = statistics.mean(total_times)
    
    # Cold vs Warm 比較
    cold_times = [r["total_ms"] for r in successful if r["cache_state"] == "cold"]
    warm_times = [r["total_ms"] for r in successful if r["cache_state"] == "warm"]
    
    print("\n" + "=" * 60)
    print("📊 Performance Test Results")
    print("=" * 60)
    print(f"Total Trials: {N_TRIALS}")
    print(f"Successful: {len(successful)} ({len(successful)/N_TRIALS*100:.1f}%)")
    print(f"\n【Overall Statistics】")
    print(f"  p50 (median): {p50:.2f} ms")
    print(f"  p95:          {p95:.2f} ms")
    print(f"  Average:      {avg_time:.2f} ms")
    print(f"  Max:          {max_time:.2f} ms")
    
    if cold_times and warm_times:
        print(f"\n【Cache Effect】")
        print(f"  Cold Start (avg): {statistics.mean(cold_times):.2f} ms")
        print(f"  Warm Cache (avg): {statistics.mean(warm_times):.2f} ms")
        print(f"  Speed-up:         {statistics.mean(cold_times)/statistics.mean(warm_times):.2f}x")
    
    # 内訳平均
    fetch_avg = statistics.mean([r.get("fetch_ms_avg", 0) for r in successful if r.get("fetch_ms_avg", 0) > 0])
    analysis_avg = statistics.mean([r.get("analysis_ms_avg", 0) for r in successful if r.get("analysis_ms_avg", 0) > 0])
    
    print(f"\n【Breakdown (per ticker average)】")
    print(f"  Fetch:    {fetch_avg:.2f} ms")
    print(f"  Analysis: {analysis_avg:.2f} ms")
    
    # SLO達成率
    slo_target = 2000  # 2秒
    slo_success = sum(1 for t in total_times if t < slo_target)
    slo_rate = slo_success / len(total_times) * 100
    
    print(f"\n【SLO Achievement】")
    print(f"  Target: < {slo_target} ms")
    print(f"  Achievement Rate: {slo_rate:.1f}% ({slo_success}/{len(total_times)})")
    
    # 結果をJSONで保存
    report = {
        "test_date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "n_trials": N_TRIALS,
        "successful_trials": len(successful),
        "statistics": {
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "avg_ms": round(avg_time, 2),
            "max_ms": round(max_time, 2)
        },
        "cache_effect": {
            "cold_avg_ms": round(statistics.mean(cold_times), 2) if cold_times else None,
            "warm_avg_ms": round(statistics.mean(warm_times), 2) if warm_times else None,
            "speedup": round(statistics.mean(cold_times)/statistics.mean(warm_times), 2) if cold_times and warm_times else None
        },
        "breakdown": {
            "fetch_ms": round(fetch_avg, 2),
            "analysis_ms": round(analysis_avg, 2)
        },
        "slo": {
            "target_ms": slo_target,
            "achievement_rate": round(slo_rate, 1)
        }
    }
    
    with open("performance_test_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ Report saved to: performance_test_report.json")
    print("=" * 60)

if __name__ == "__main__":
    main()
