import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const ART_DIR = path.join(process.cwd(), "artifacts", "e2e");
function ensureDir() {
    if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });
}

function freezeJst(page: any, iso: string) {
    return page.addInitScript((t: string) => {
        const fixed = new Date(t).getTime();
        const OriginalDate = Date;
        // @ts-expect-error - Mocking Date globally
        window.Date = function (...args: any[]) {
            if (args.length === 0) {
                return new OriginalDate(fixed);
            }
            // @ts-expect-error - Spread args
            return new OriginalDate(...args);
        };
        window.Date.now = () => fixed;
        Object.setPrototypeOf(window.Date, OriginalDate);
    }, iso);
}

test.describe("Weekend Plan Phase 2 acceptance A-F", () => {
    test.beforeAll(() => ensureDir());

    const basePrediction = {
        ticker: "7203.T",
        company_name: "Toyota Motor Corp",
        current_price: 2500,
        price_change_percent: 1.2,
        asof: "2026-02-08",
        last_sync: "2026-02-06 15:00:00", // Hardened asof source
        chart_data: [{ name: "02/06", base: 2500 }], // Backup source
        day_trading: {
            decision: "BUY",
            super_score: 85,
            reasoning_list: ["Strong trend"],
            lot_management: { shares: 100, entry_price: 2500, target_price: 2600, stop_price: 2400 }
        },
        // We omit technical_analysis.market_phase to test JST logic in E,
        // or include it when we want to force state.
        technical_analysis: {},
        long_term_snapshot: {
            profitability: { roe: 0.12, operating_margin: 0.08, revenue_growth: 0.05 },
            safety: { equity_ratio: 0.4, debt_to_equity: 0.8 },
            shareholder_returns: { dividend_yield: 0.03, payout_ratio: 0.3 },
            valuation_band: { per: 10.5, pbr: 1.1, status: "NEUTRAL" },
            warnings: []
        },
        event_risk: { upcoming_events: [], warnings: [] },
        concentration_risk: { correlation_report: [], sector_distribution: {}, remedies: [] },
        playbook_references: []
    };

    // A: Initial Load - No *Additional* API calls
    test.beforeEach(async ({ page }) => {
        // Global mocks for core APIs called on mount
        await page.route("**/api/scenario*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
        });
        await page.route("**/api/macro_snapshot*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, partial: { vix: 20, skew: 130 } }) });
        });
        await page.route("**/api/scoring/aggregate*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, total_entries: 0 }) });
        });
        await page.route("**/api/scoring/rules*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, rules: {} }) });
        });
        await page.route("**/api/portfolio*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, tickers: [] }) });
        });
        await page.route("**/api/diary*", async (route) => {
            await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, items: [] }) });
        });
    });

    test("A 初期表示で新規APIを呼ばない", async ({ page }) => {
        await freezeJst(page, "2026-02-10T01:00:00.000Z");

        // Mock api/predict
        await page.route("**/api/predict", async (route) => {
            const resp = { ...basePrediction, technical_analysis: { market_phase: { is_open: true, label: "OPEN" } } };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        const hits: string[] = [];
        page.on("request", (req) => {
            const u = req.url();
            // Check for backend routes that might be called if logic was wrong
            if (u.includes("/api/fundamentals") || u.includes("/api/events") || u.includes("/api/correlation") || u.includes("/api/playbook")) {
                hits.push(u);
            }
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);

        // Asof Stability Check: Even on Tue (10th), it should show last_sync (6th)
        await expect(page.getByTestId("weekend-plan-toggle")).toContainText("基準日: 2026-02-06");

        // Also check that Weekend Plan is NOT open/visible in "Open" state by default
        await expect(page.getByTestId("weekend-plan-toggle")).toBeVisible();
        await expect(page.getByTestId("tab-snapshot")).not.toBeVisible();

        expect(hits.length, "Should not call detailed APIs").toBe(0);
        await page.screenshot({ path: path.join(ART_DIR, "A.png"), fullPage: true });
    });

    // B: Partial/Error Handling
    test("B partial 欠損でもUIが落ちない", async ({ page }) => {
        // Weekends stuck -> JST closed
        await freezeJst(page, "2026-02-07T03:00:00.000Z");

        // Mock Partial
        await page.route("**/api/predict", async (route) => {
            const resp = {
                ...basePrediction,
                asof: "2026-02-08", // Add asof
                partial: true,
                missing_fields: ["fundamentals", "sector"],
                long_term_snapshot: undefined, // Simulate missing
                concentration_risk: { correlation_report: [], sector_distribution: undefined, remedies: [] }
                // events, playbook exist
            };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });

        // Open accordion if not already (JST Closed should default open, but let's click if needed or check)
        // Actually JST Closed = Default Open.
        // Verify Banner
        await expect(page.getByTestId("weekend-plan-partial-banner")).toBeVisible({ timeout: 5000 });
        const missingText = await page.getByTestId("weekend-plan-missing-fields").textContent();
        expect(missingText).toContain("財務データ");
        expect(missingText).toContain("セクター分類");

        await page.screenshot({ path: path.join(ART_DIR, "B.png"), fullPage: true });
    });

    // C: Warnings
    test("C 決算直前警告 新規のみ制限", async ({ page }) => {
        await freezeJst(page, "2026-02-07T03:00:00.000Z");

        await page.route("**/api/predict", async (route) => {
            const resp = {
                ...basePrediction,
                event_risk: {
                    upcoming_events: [{ type: "earnings", date: "2026-02-10", days_left: 3 }],
                    warnings: ["決算直前のため注意が必要です"]
                }
            };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });

        // Switch to Risk Tab
        await page.getByTestId("tab-risk").click();

        const warningBox = page.getByTestId("weekend-plan-event-warning");
        await expect(warningBox).toBeVisible();
        await expect(warningBox).toContainText("決算直前");
        await expect(warningBox).toContainText("新規エントリーのみ制限");

        await page.screenshot({ path: path.join(ART_DIR, "C.png"), fullPage: true });
    });

    // D: Correlation Limit
    test("D 相関は上位3ペアだけ表示", async ({ page }) => {
        await freezeJst(page, "2026-02-07T03:00:00.000Z");

        await page.route("**/api/predict", async (route) => {
            const resp = {
                ...basePrediction,
                concentration_risk: {
                    // Mock 5 pairs
                    correlation_report: [
                        { pair: "A-B", correlation: 0.99, warning: true },
                        { pair: "C-D", correlation: 0.98, warning: true },
                        { pair: "E-F", correlation: 0.97, warning: true },
                        { pair: "G-H", correlation: 0.96, warning: false },
                        { pair: "I-J", correlation: 0.95, warning: false }
                    ],
                    sector_distribution: { "Automotive": 0.5 },
                    remedies: ["Diversify"]
                }
            };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.getByTestId("tab-risk").click();

        // Check "上位3件" text is present
        await expect(page.getByText("上位3件")).toBeVisible();

        // Check list content.
        // The implementation performs slice(0, 3).
        // So "G-H" and "I-J" should NOT be visible. "E-F" SHOULD be visible.
        await expect(page.getByText("A-B")).toBeVisible();
        await expect(page.getByText("E-F")).toBeVisible();
        await expect(page.getByText("G-H")).not.toBeVisible();

        await page.screenshot({ path: path.join(ART_DIR, "D.png"), fullPage: true });
    });

    // E: Auto Open/Close logic (JST fallback)
    test("E 自動開閉", async ({ page }) => {
        // 1. Closed Case (Sat) -> Auto Open
        await freezeJst(page, "2026-02-07T03:00:00.000Z");
        await page.route("**/api/predict", async (route) => {
            // Enforce null market_phase to test JST logic
            const resp = { ...basePrediction, technical_analysis: { market_phase: null } };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("tab-snapshot")).toBeVisible();
        await page.screenshot({ path: path.join(ART_DIR, "E-closed.png"), fullPage: true });

        // 2. Open Case (Tue) -> Auto Close
        const pageOpen = await page.context().newPage();
        await freezeJst(pageOpen, "2026-02-10T01:00:00.000Z");
        await pageOpen.route("**/api/predict", async (route) => {
            const resp = { ...basePrediction, technical_analysis: { market_phase: null } }; // JST fallback
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resp) });
        });

        await pageOpen.goto("/", { waitUntil: "domcontentloaded" });
        await expect(pageOpen.getByTestId("tab-snapshot")).not.toBeVisible();
        await expect(pageOpen.getByTestId("weekend-plan-toggle")).toBeVisible();

        await pageOpen.screenshot({ path: path.join(ART_DIR, "E-open.png"), fullPage: true });
        await pageOpen.close();
    });

    // F: Existing UI Integrity
    test("F 既存予測カードが壊れていない", async ({ page }) => {
        // Just mock standard valid response
        await page.route("**/api/predict", async (route) => {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(basePrediction) });
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).toContainText("Toyota Motor");
        await page.screenshot({ path: path.join(ART_DIR, "F.png"), fullPage: true });
    });

});
