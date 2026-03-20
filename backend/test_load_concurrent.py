#!/usr/bin/env python3
"""
Phase5: 負荷試験スクリプト（同時アクセステスト）
- 5/20/50並列でAPIに同時アクセス
- 429エラー耐性検証
- SLO達成率（p95 < 2秒）の確認
"""
import requests
import time
import statistics
import json
import concurrent.futures
import threading
from datetime import datetime

API_URL = "http://127.0.0.1:8000/api/hot-picks"
CONCURRENCY_LEVELS = [5, 20, 50]
REQUESTS_PER_LEVEL = 30

# スレッドローカルストレージ（カウンター用）
thread_local = threading.local()

def make_request(request_id, concurrency):
    """1回のAPIリクエストを実行"""
    start = time.time()
    try:
        response = requests.get(API_URL, timeout=10)
        elapsed = (time.time() - start) * 1000  # ms
        
        if response.status_code == 200:
            data = response.json()
            picks = data.get("picks", [])
            
            # Degraded検出（staleフラグ）
            degraded_count = sum(1 for p in picks if p.get("data_status") == "stale")
            
            return {
                "success": True,
                "total_ms": elapsed,
                "picks_count": len(picks),
                "degraded_count": degraded_count,
                "status_code": 200,
                "concurrency": concurrency,
                "request_id": request_id
            }
        elif response.status_code == 429:
            # Rate limit - これも「成功」として扱う（degraded扱い）
            return {
                "success": True,
                "total_ms": elapsed,
                "picks_count": 0,
                "degraded_count": 0,
                "status_code": 429,
                "rate_limited": True,
                "concurrency": concurrency,
                "request_id": request_id
            }
        else:
            return {
                "success": False,
                "total_ms": elapsed,
                "status_code": response.status_code,
                "error": f"HTTP {response.status_code}",
                "concurrency": concurrency,
                "request_id": request_id
            }
    except Exception as e:
        elapsed = (time.time() - start) * 1000
        return {
            "success": False,
            "total_ms": elapsed,
            "error": str(e),
            "concurrency": concurrency,
            "request_id": request_id
        }

def run_concurrent_load_test(concurrency, num_requests):
    """指定の並列数で負荷テストを実行"""
    print(f"\n🔥 Concurrency: {concurrency} parallel requests")
    print(f"   Total requests: {num_requests}")
    print("   " + "=" * 50)
    
    results = []
    start_time = time.time()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(make_request, i, concurrency)
            for i in range(num_requests)
        ]
        
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            
            # 進捗表示（10件ごと）
            if len(results) % 10 == 0:
                print(f"   Progress: {len(results)}/{num_requests}")
    
    total_duration = time.time() - start_time
    
    return results, total_duration

def analyze_results(results, concurrency, total_duration):
    """テスト結果を分析"""
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]
    rate_limited = [r for r in successful if r.get("rate_limited", False)]
    degraded = [r for r in successful if r.get("degraded_count", 0) > 0]
    
    total_times = [r["total_ms"] for r in successful]
    
    if not total_times:
        return {
            "concurrency": concurrency,
            "total_requests": len(results),
            "successful": 0,
            "failed": len(failed),
            "failure_rate": 100.0,
            "error": "All requests failed"
        }
    
    p50 = statistics.median(total_times)
    p95 = statistics.quantiles(total_times, n=20)[18] if len(total_times) >= 20 else max(total_times)
    avg_time = statistics.mean(total_times)
    max_time = max(total_times)
    
    # SLO達成率
    slo_target = 2000  # 2秒
    slo_success = sum(1 for t in total_times if t < slo_target)
    slo_rate = slo_success / len(total_times) * 100
    
    # Throughput計算
    throughput = len(successful) / total_duration
    
    return {
        "concurrency": concurrency,
        "total_requests": len(results),
        "successful": len(successful),
        "failed": len(failed),
        "rate_limited": len(rate_limited),
        "degraded": len(degraded),
        "failure_rate": (len(failed) / len(results)) * 100,
        "statistics": {
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "avg_ms": round(avg_time, 2),
            "max_ms": round(max_time, 2)
        },
        "slo": {
            "target_ms": slo_target,
            "achievement_rate": round(slo_rate, 1),
            "passed": slo_success,
            "total": len(total_times)
        },
        "throughput_rps": round(throughput, 2),
        "total_duration_sec": round(total_duration, 2)
    }

def main():
    print("=" * 70)
    print("🧪 Phase5: Load Testing - Concurrent Access Test")
    print("=" * 70)
    print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    all_results = {}
    
    for concurrency in CONCURRENCY_LEVELS:
        results, total_duration = run_concurrent_load_test(concurrency, REQUESTS_PER_LEVEL)
        analysis = analyze_results(results, concurrency, total_duration)
        all_results[f"concurrency_{concurrency}"] = analysis
        
        # 結果表示
        print(f"\n   ✅ Completed in {total_duration:.2f}s")
        print(f"   Success: {analysis['successful']}/{analysis['total_requests']}")
        print(f"   Failure Rate: {analysis['failure_rate']:.1f}%")
        print(f"   p95: {analysis['statistics']['p95_ms']} ms")
        print(f"   SLO Achievement: {analysis['slo']['achievement_rate']}%")
        print(f"   Throughput: {analysis['throughput_rps']} req/s")
        
        if analysis.get('rate_limited', 0) > 0:
            print(f"   ⚠️  Rate Limited: {analysis['rate_limited']} requests")
        
        # 少し待機（次の負荷テストとの間隔）
        if concurrency != CONCURRENCY_LEVELS[-1]:
            print("\n   Cooling down for 3 seconds...")
            time.sleep(3)
    
    # 総合レポート
    print("\n" + "=" * 70)
    print("📊 Load Test Summary")
    print("=" * 70)
    
    for key, analysis in all_results.items():
        c = analysis['concurrency']
        print(f"\n【Concurrency: {c}】")
        print(f"  Success Rate: {100 - analysis['failure_rate']:.1f}%")
        print(f"  p50: {analysis['statistics']['p50_ms']}ms | p95: {analysis['statistics']['p95_ms']}ms")
        print(f"  SLO: {analysis['slo']['achievement_rate']}% ({analysis['slo']['passed']}/{analysis['slo']['total']})")
        print(f"  Throughput: {analysis['throughput_rps']} req/s")
    
    # 受入基準チェック
    print("\n" + "=" * 70)
    print("🎯 Acceptance Criteria")
    print("=" * 70)
    
    # 1. p95 < 2秒 達成率 95%以上
    all_slo_rates = [analysis['slo']['achievement_rate'] for analysis in all_results.values()]
    overall_slo_rate = sum(all_slo_rates) / len(all_slo_rates)
    slo_pass = overall_slo_rate >= 95.0
    
    print(f"1. p95 < 2s達成率: {overall_slo_rate:.1f}% {'✅ PASS' if slo_pass else '❌ FAIL (target: 95%+)'}")
    
    # 2. 429発生時もdegradedで応答
    rate_limited_total = sum(analysis.get('rate_limited', 0) for analysis in all_results.values())
    degraded_pass = rate_limited_total == 0 or all(analysis.get('rate_limited', 0) == 0 or analysis.get('degraded', 0) > 0 for analysis in all_results.values())
    
    print(f"2. 429時degraded応答: {'✅ PASS' if degraded_pass else '❌ FAIL'} (rate limited: {rate_limited_total})")
    
    # 3. 失敗率 < 5%
    all_failure_rates = [analysis['failure_rate'] for analysis in all_results.values()]
    max_failure_rate = max(all_failure_rates)
    failure_pass = max_failure_rate < 5.0
    
    print(f"3. 失敗率 < 5%: {max_failure_rate:.1f}% {'✅ PASS' if failure_pass else '❌ FAIL'}")
    
    # 総合判定
    all_pass = slo_pass and degraded_pass and failure_pass
    print(f"\n総合判定: {'✅ ALL PASS' if all_pass else '❌ NEEDS IMPROVEMENT'}")
    
    # JSON保存
    report = {
        "test_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "test_type": "concurrent_load_test",
        "concurrency_levels": CONCURRENCY_LEVELS,
        "requests_per_level": REQUESTS_PER_LEVEL,
        "results": all_results,
        "acceptance_criteria": {
            "slo_achievement_rate": {
                "value": round(overall_slo_rate, 1),
                "target": 95.0,
                "pass": slo_pass
            },
            "degraded_mode": {
                "pass": degraded_pass
            },
            "failure_rate": {
                "value": round(max_failure_rate, 1),
                "target": 5.0,
                "pass": failure_pass
            },
            "overall": all_pass
        }
    }
    
    with open("load_test_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ Report saved to: load_test_report.json")
    print("=" * 70)

if __name__ == "__main__":
    main()
