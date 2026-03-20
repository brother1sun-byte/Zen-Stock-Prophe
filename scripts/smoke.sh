#!/bin/bash
set -e
API_BASE="http://localhost:8000"

echo "--- Starting Smoke Test (Japan Stock Prophet) ---"

check_endpoint() {
    local url=$1
    echo -n "Checking $url..."
    if curl -s -f "$url" > /dev/null; then
        echo " [PASS]"
        return 0
    else
        echo " [FAIL]"
        return 1
    fi
}

today=$(date +%Y-%m-%d)
last_week=$(date -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d)

results=()
check_endpoint "$API_BASE/health" || results+=(1)
check_endpoint "$API_BASE/api/portfolio" || results+=(1)
check_endpoint "$API_BASE/api/scoring?ticker=7203" || results+=(1)
check_endpoint "$API_BASE/api/review?from=$last_week&to=$today" || results+=(1)

if [ ${#results[@]} -ne 0 ]; then
    echo -e "\n--- SMOKE TEST FAILED ---"
    exit 1
else
    echo -e "\n--- ALL SMOKE TESTS PASSED ---"
    exit 0
fi
