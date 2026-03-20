import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const ART_DIR = "c:/Users/BRB33/OneDrive/Desktop/Antigravity/japan-stock-prophet/artifacts/e2e";
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

test.describe("Weekend Scenario Engine (Strict)", () => {
    test.beforeAll(() => ensureDir());

    const basePrediction = {
        ticker: "7203.T",
        company_name: "Toyota Motor Corp",
        current_price: 2500,
        asof: "2026-02-08",
        last_sync: "2026-02-06 15:00:00",
        quotation: { open: 2480, close: 2500, high: 2510, low: 2470, volume: 10000 },
        technical_analysis: { market_phase: { is_open: false, label: "CLOSE" } }
    };

    /**
     * Test G: Scenario Save
     * Goal: Verify user can input rules and save them.
     */
    test("G Scenario Save", async ({ page }) => {
        // Mock API
        await page.route("**/api/predict", async (route) => {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(basePrediction) });
        });

        await page.route("**/api/scenario", async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill({ status: 200, body: "null" }); // No existing rules
            } else if (route.request().method() === 'POST') {
                const data = JSON.parse(route.request().postData() || "{}");
                expect(data.ticker).toBe("7203.T");
                expect(data.rules_gap_up.entry_condition).toBe("Open > 2550");
                await route.fulfill({ status: 200, body: JSON.stringify({ status: "success" }) });
            }
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });

        // Navigate to Scenario Tab (default might be Snapshot, need to click Playbook/Scenario if logic changed)
        // Logic: if activeTab state defaults to 'snapshot', we need to switch.
        // But Scenario is in 'Playbook' tab now? No, looking at WeekendPlanSection.tsx:
        // Tab buttons: snapshot, risk, playbook.
        // Scenario UI is inside 'playbook' tab.
        await page.getByTestId("tab-playbook").click();

        // Check Input Form (Gap Up)
        const gapUpForm = page.getByTestId("scenario-gap-up-form");
        await expect(gapUpForm).toBeVisible();

        // Input Rule
        await gapUpForm.getByPlaceholder("例: 始値 > 1000").fill("Open > 2550");
        await gapUpForm.getByPlaceholder("例: +20 ticks").fill("+50");

        // Save
        await page.getByTestId("scenario-save").click();

        // Verify Success Message
        await expect(page.getByText("保存しました")).toBeVisible();

        await page.screenshot({ path: path.join(ART_DIR, "G_ScenarioSave_Strict.png") });
    });

    /**
     * Test H: Scenario Evaluate (Deterministic)
     * Goal: Verify logic works for Gap Up case.
     */
    test("H Scenario Evaluate", async ({ page }) => {
        // Mock 10:00 AM JST (Monday)
        await freezeJst(page, "2026-02-09T01:00:00.000Z");

        // Mock Open Market
        await page.route("**/api/predict", async (route) => {
            const openPred = { ...basePrediction, technical_analysis: { market_phase: { is_open: true, label: "OPEN" } } };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(openPred) });
        });

        // Catch-all mock for other API calls to prevent hanging
        await page.route("**/api/**", async (route) => {
            const url = route.request().url();
            if (!url.includes("predict") && !url.includes("scenario") && !url.includes("macro")) {
                await route.fulfill({ status: 404, body: "{}" });
            } else {
                await route.continue();
            }
        });

        // Mock Scenario GET (Empty/Default)
        await page.route(/\/api\/scenario(\?.*)?$/, async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
            } else {
                await route.continue();
            }
        });

        // Mock Macro Snapshot
        await page.route(/\/api\/macro_snapshot(\?.*)?$/, async (route) => {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partial: true, missing_fields: [] }) });
        });

        // Mock Evaluate API (Deterministic)
        await page.route("**/api/scenario/evaluate", async (route) => {
            const res = {
                scenario_type: "GAP_UP",
                recommended_action: "BUY at Market",
                reason: "Gap +1.5% > 0.5%",
                risk_note: "",
                lot_cap: "100",
                computed_inputs: { gap_pct: 1.5 },
                metadata: { version: "1.0" }
            };
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(res) });
        });

        await page.goto("/", { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);

        console.log("Checking Weekend Plan section state...");
        const header = page.getByTestId("weekend-plan-toggle");
        await expect(header).toBeVisible();

        // Ensure section is open
        const content = page.getByTestId("tab-snapshot");
        const isVisible = await content.isVisible().catch(() => false);
        if (!isVisible) {
            console.log("Section closed, clicking to open...");
            await header.click();
        }

        console.log("Switching to Playbook tab...");
        const tab = page.getByTestId("tab-playbook");
        await expect(tab).toBeVisible();
        await tab.click();

        console.log("Waiting for Scenario Form...");
        await expect(page.getByTestId("weekend-plan-scenario")).toBeVisible();

        // Ensure evaluate button is visible/enabled
        console.log("Checking Evaluate button...");
        const evalBtn = page.getByTestId("scenario-evaluate");
        await expect(evalBtn).toBeVisible({ timeout: 10000 });

        console.log("Clicking Evaluate...");
        await evalBtn.click();

        // Verify Result Card
        console.log("Waiting for Scenario Action result card...");
        const actionCard = page.getByTestId("scenario-action");
        await expect(actionCard).toBeVisible({ timeout: 15000 });
        await expect(actionCard).toContainText("GAP_UP");
        await expect(actionCard).toContainText("BUY at Market");

        await page.screenshot({ path: path.join(ART_DIR, "H_ScenarioEvaluate_Strict.png") });
        console.log("Test H Passed!");
    });
});
