# P17 EDINET key and long monitor validation

## 1. Purpose

Validate the P17 follow-up items after P16:

- EDINET real-key setup state without exposing secrets
- EDINET document endpoint behavior
- Longer market-hours monitoring for `ERR_ABORTED`, heap growth, stale UI, and no-action display loss
- Zen Loop Desk verified-candidate gate preservation

This validation remains manual decision support only. It does not add or enable investment advice, profit guarantees, automated trading, live orders, broker/RPA integration, external notifications, or external log sending.

## 2. Execution time

- Date: 2026-07-06
- Session: afternoon JST market-hours session
- API status check: around 15:00 JST
- Live browser monitoring: 15:01:58-15:32:10 JST
- Duration: 30.2 minutes
- Note: 60-minute monitoring could not fit fully inside market hours because the run started at 15:00 JST. A 30+ minute run was executed and ended shortly after the 15:30 close.
- Workspace: `C:\Users\BRB33\investment-simulator-pro`
- P16 reference commit: `36457c5 docs: record P16 EDINET and abort monitoring validation`

## 3. Secret handling

No API key, token, password, refresh token, `.env` value, or environment-variable value was displayed, copied, recorded, or committed.

Non-secret setup observations:

- `.env`: absent
- `.env.example`: present
- `.env` is ignored by `.gitignore`
- Current shell environment: EDINET and J-Quants auth variables were not set
- `git status --short --untracked-files=all`: clean before P17 memo creation

## 4. EDINET real-key setup check

EDINET real-key setup could not be confirmed because no EDINET key was present in the current shell environment and no `.env` file existed.

Observed endpoint result:

- `/api/research/edinet/documents`: HTTP 200, `status=api_key_missing`, `documentCount=0`

Conclusion: EDINET real-key retrieval remains unverified. The application did not present the missing-key state as successful document retrieval.

## 5. API status checked

Checked endpoints:

- `/api/research/jquants/status`
- `/api/research/edinet/documents`
- `/api/research/earnings-calendar`
- `/api/daytrade/signals?kind=gainers`
- `/api/daytrade/risk-state`

Observed non-secret statuses:

- J-Quants status endpoint: HTTP 200, `configured=true`, `available=true`
- EDINET documents endpoint: HTTP 200, `status=api_key_missing`, `documentCount=0`
- Earnings calendar endpoint: HTTP 200, `status=no_data`, `source=J-Quants`, `itemCount=0`
- Daytrade gainers endpoint: one direct PowerShell request failed without secret output; live browser monitoring later captured successful responses
- Daytrade risk-state endpoint: HTTP 200

## 6. Live monitoring result

30.2 minutes of browser monitoring was performed at 430px width, followed by width checks at 390px, 430px, and 768px.

Observed responses:

- 325 tracked responses for the monitored API family
- `/api/daytrade/signals?kind=gainers`: 38 responses
- `/api/ai-fund/desk?kind=gainers`: 45 responses
- `/api/daytrade/risk-state`: 53 responses
- `/api/research/jquants/status`: 48 responses
- `/api/research/edinet/documents`: 26 responses
- `/api/research/earnings-calendar`: 13 responses

Observed request failures:

- 73 tracked request failures
- 73 were `net::ERR_ABORTED`
- Affected endpoints included `/api/daytrade/signals?kind=gainers`, `/api/ai-fund/desk?kind=gainers`, `/api/daytrade/risk-state`, `/api/research/jquants/status`, `/api/research/edinet/documents`, `/api/stocks`, `/api/alerts/watchlist`, and selected `/api/stock/...` requests

Observed impact:

- Console errors: 0
- Page errors: 0
- Horizontal overflow: none at 390px, 430px, or 768px
- No actionable trade board text appeared
- The no-action element remained present throughout the monitoring snapshots
- No verified-candidate status leaked into the source check
- No browser mojibake indicator was observed

Conclusion: `ERR_ABORTED` remains reproducible and more frequent in this run, but current evidence still indicates request cancellation/replacement behavior rather than a safety or UI failure. No code fix was made.

## 7. Heap trend

Observed JS heap:

- Start used JS heap: about 44.7 MB
- End used JS heap: about 72.2 MB
- Heap size limit: about 3.76 GB

The used heap increased during the 30.2-minute run, but no UI degradation, page error, console error, or operation failure was observed. No clear causal link between `ERR_ABORTED` count and heap increase was established in this run.

## 8. Stale UI and no-action display check

Stale UI symptoms were not observed:

- no-action state remained present
- actionable board did not appear
- no verified-candidate state was not lost
- mobile widths had no horizontal overflow
- response failures did not remove the Zen Loop Desk panel

One text-extraction probe using exact `String.includes` returned false for the manual-boundary phrase despite the phrase being visible in the panel text sample. The dedicated Playwright UI test confirmed the user-visible phrase remains present, so no application fix was made.

## 9. Mojibake impact check

Browser findings:

- Body text mojibake indicator: not observed
- Zen Loop Desk panel mojibake indicator: not observed
- JSON/source display mojibake indicator: not observed
- Existing UI regression test for Japanese text passed

Conclusion: PowerShell mojibake remains an operator-terminal observation, not a confirmed browser UI encoding defect.

## 10. Verified candidate gate check

The gate remains unchanged and requires:

- `tradeReadiness == ready`
- `decisionAudit.verdict == PASS`
- actionable size
- cross-engine confirmation aligned when cross-engine confirmation is required

Conditions not meeting the gate remain `research-only`.

When verified signals are absent, Zen Loop Desk does not create a fallback verified candidate.

## 11. `alerts=0` / `NO_ACTION` check

The alert-only model remains display-only:

- `alerts=0` or `status=NO_ACTION` is not converted into sending.
- No external notification path was added.
- No order, broker, RPA, or external logging path was added.

## 12. Tests executed

- `npm run test -- tests/ui/zen-loop-desk.spec.js`: passed, 3 tests
- `npm run lint`: passed
- `npm run build`: passed
- `npm run test`: passed, 84 tests
- `npm run test:ui`: passed, 84 tests
- `python -m unittest discover -s tests`: passed, 170 tests
- `git diff --check`: passed
- `git status --short --untracked-files=all`: only this ignored P17 memo was pending before force-add

## 13. Changed files

- `.workflow/live-data-p17/verification-memo.md`

No application source or test source was changed for P17.

## 14. Remaining issues

1. EDINET real-key retrieval remains unverified because no EDINET key was available in the current shell environment or `.env`.
2. `ERR_ABORTED` remains reproducible; current evidence shows no UI breakage or gate weakening, but it should remain a monitoring item.
3. Heap increased during the 30.2-minute browser run, but no degradation was observed; a longer session is needed to assess long-run memory behavior.
4. The exact text-extraction anomaly should be considered a test-harness observation unless user-visible text assertions begin failing.

## 15. Next steps

1. Provide or set EDINET key outside git and re-run the EDINET document endpoint without exposing the key value.
2. Run a 60+ minute market-hours monitor starting earlier in the trading session.
3. Continue observing `ERR_ABORTED` only if it correlates with stale UI, missing no-action state, or refresh recovery failure.
4. Keep verified-candidate gating unchanged unless a safety-preserving defect fix is proven by tests.
