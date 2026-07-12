"""Read-only browser verification for portfolio and persistent ledger displays."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "test-results" / "portfolio-live-verification.png"


def fetch_json(path: str):
    api_port = os.environ.get("ZEN_API_PORT", "8889")
    with urlopen(f"http://127.0.0.1:{api_port}{path}", timeout=30) as response:
        return json.load(response)


def main() -> None:
    portfolio = fetch_json("/api/portfolio")
    transactions = fetch_json("/api/transactions")
    risk_state = fetch_json("/api/daytrade/risk-state")
    active = portfolio.get("holdings", [])
    archived = portfolio.get("archivedHoldings", [])
    assert risk_state.get("liveOrderMode") == "disabled", risk_state.get("liveOrderMode")

    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    console_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.goto("http://127.0.0.1:5174", wait_until="networkidle", timeout=120_000)
        page.locator(".detail-toggle").click()

        holding_rows = page.get_by_test_id("holding-row")
        assert holding_rows.count() == len(active), (holding_rows.count(), len(active))
        for holding in active:
            assert holding_rows.filter(has_text=holding["ticker"]).count() == 1, holding["ticker"]

        first_ticker = active[0]["ticker"] if active else None
        if first_ticker:
            holding_rows.filter(has_text=first_ticker).click()
            ticker_inputs = page.get_by_test_id("practice-order-ticker")
            ticker_values = [ticker_inputs.nth(index).input_value() for index in range(ticker_inputs.count())]
            assert first_ticker in ticker_values

        ledger_text = page.get_by_test_id("portfolio-ledger-events").inner_text()
        for holding in archived[:5]:
            assert holding["ticker"] in ledger_text, holding["ticker"]

        transaction_text = page.get_by_test_id("portfolio-transaction-history").inner_text()
        for transaction in transactions[:5]:
            assert transaction["ticker"] in transaction_text, transaction["ticker"]

        page.get_by_test_id("portfolio-transaction-history").scroll_into_view_if_needed()
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()

    assert not console_errors, console_errors
    print(json.dumps({
        "activeHoldings": len(active),
        "archivedHoldings": len(archived),
        "transactions": len(transactions),
        "selectedTicker": first_ticker,
        "liveOrderMode": risk_state.get("liveOrderMode"),
        "screenshot": str(SCREENSHOT),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
