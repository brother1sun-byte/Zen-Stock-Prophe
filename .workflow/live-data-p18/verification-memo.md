# P18 EDINET document and long monitor validation

## 1. Purpose

Verify P18 for Zen Stock Prophet Pro during Japanese market hours:
EDINET document status, J-Quants/supplemental data status, Zen Loop Desk safety
boundaries, ERR_ABORTED impact, heap trend, stale UI, no-action state,
responsive display, and verified candidate gate behavior.

This memo records only non-secret status and counts. API keys, tokens,
credentials, environment variable values, and `.env` contents were not displayed
or recorded.

## 2. Conclusion

P18 was completed with documentation-only changes.

- EDINET configured-key retrieval was not completed because this environment had
  no EDINET key configured and the endpoint returned `api_key_missing`.
- J-Quants status endpoint returned `configured=true`, `available=true`, and
  `mode=API_KEY` from the running backend. The current shell did not expose
  J-Quants credential values.
- A 61.01 minute market-hours browser monitor completed.
- `ERR_ABORTED` reproduced 134 times, mainly during page reload / in-flight
  request cancellation, but did not cause UI breakage, stale UI, no-action
  disappearance, actionable board misdisplay, or verified candidate gate
  weakening.
- Heap usage moved from about 53.5 MB to about 33.1 MB with a limit of about
  3.76 GB; no harmful growth was observed.
- 390px, 430px, and 768px widths had no horizontal scroll.
- No external order, automated trading, broker/RPA integration, external
  notification, or external log sending was observed or added.

## 3. Execution Time

- Date: 2026-07-07 JST
- Market-hours window: afternoon session
- Monitor start: 2026-07-07 13:26:53 JST
- Monitor end: 2026-07-07 14:27:53 JST
- Monitor duration: 61.01 minutes

## 4. API Configuration Status

- `.env`: absent
- `.env.example`: present
- `.env` git ignore: confirmed by `git check-ignore -v .env`
- EDINET API key: not configured in this environment
- J-Quants credentials: not shown; current shell did not expose values
- Running backend J-Quants endpoint: `configured=true`, `available=true`,
  `mode=API_KEY`
- Secret display: none

## 5. EDINET Configured-Key Check

- Endpoint checked:
  `/api/research/edinet/documents?start_date=2026-07-07&end_date=2026-07-07`
- HTTP status: 200
- Endpoint status: `api_key_missing`
- Document count: not available
- Result: EDINET configured-key retrieval remains incomplete.
- Safety display: the endpoint did not present missing EDINET data as fetched
  data.

## 6. J-Quants and Supplemental Data Results

- `/api/research/jquants/status`: HTTP 200, `configured=true`,
  `available=true`, `mode=API_KEY`
- `/api/research/earnings-calendar?start_date=2026-07-07&end_date=2026-07-07`:
  HTTP 200, `status=no_data`, `source=J-Quants`
- `/api/daytrade/signals?kind=gainers`: HTTP 200,
  `source=NO_VERIFIED_RANKING_SIGNAL`
- `/api/daytrade/risk-state`: HTTP 200, `liveOrderMode=disabled`
- `/api/ai-fund/desk?kind=gainers`: HTTP 200,
  `mode=LOCAL_AI_HEDGE_FUND_DESK`
- Yahoo/yfinance/Stooq supplemental state was observed through the existing
  daytrade/ranking surfaces; no verified ranking signal was produced.

## 7. 60-Minute Monitor Result

- Browser target: `http://127.0.0.1:5174/`
- Backend target: `http://127.0.0.1:8889/`
- Existing local servers were already listening on ports 5174 and 8889.
- Console errors: 0
- Page errors: 0
- Request failures: 134
- `ERR_ABORTED`: 134
- Zen Loop Desk visible at every sampled check: yes
- Lifestyle daytrade panel visible at every sampled check: yes
- No verified candidate state visible at every sampled check: yes
- No-action/manual-support state visible at every sampled check: yes
- Actionable board max count: 0
- External action wording detected by monitor: no

Observed `ERR_ABORTED` endpoint families included:

- `/api/daytrade/signals?kind=gainers`
- `/api/ai-fund/desk?kind=gainers`
- `/api/research/edinet/documents`
- `/api/research/jquants/status`
- `/api/stock/...`
- `/api/daytrade/analysis/...`
- `/api/portfolio`
- `/api/alerts/watchlist`
- `/api/stocks`
- `/api/market/universe`
- `/api/daytrade/broker-status`
- `/api/daytrade/autopilot/status`

Judgment: the aborts aligned with reload / in-flight request cancellation and
did not create an observed user-facing safety issue.

## 8. Heap Trend

- Heap samples: 11
- Start used heap: about 53.5 MB
- End used heap: about 33.1 MB
- Heap limit: about 3.76 GB
- Harmful growth: not observed
- UI operation issue: not observed

## 9. Stale UI and No-Action Checks

- Stale UI: not observed
- No verified candidate display disappearance: not observed
- No-action display disappearance: not observed
- Actionable board misdisplay: not observed
- Research-only state maintained: yes

## 10. Responsive Display

- 390px: no horizontal scroll
- 430px: no horizontal scroll
- 768px: no horizontal scroll

## 11. Verified Candidate Gate

The following gate expectations remained intact:

- `tradeReadiness == ready` is required for actionable status.
- `decisionAudit.verdict == PASS` is required.
- Actionable size is required.
- Cross-engine confirmation must be `aligned` when required.
- Candidates that do not satisfy the gate remain `research-only`.
- `NO_VERIFIED_RANKING_SIGNAL` did not manufacture a verified candidate.
- No actionable board was shown when no verified candidate was present.

## 12. Alerts / NO_ACTION

- `alerts=0` / `NO_ACTION` was not converted into external notification,
  sending, ordering, broker/RPA integration, automated trading, or external log
  sending.
- No such capability was added.

## 13. Test Results

- `npm run test -- tests/ui/zen-loop-desk.spec.js`: passed, 3 passed
- `npm run lint`: passed
- `npm run build`: passed
- `npm run test`: passed, 84 passed
- `npm run test:ui`: passed, 84 passed
- `python -m unittest discover -s tests`: passed, 170 tests OK
- `git diff --check`: passed
- `git status --short --untracked-files=all`: clean before force-adding this
  ignored memo

## 14. Changed Files

- `.workflow/live-data-p18/verification-memo.md`

## 15. Commit Information

- Committed after final diff review with a Lore-format message:
  `Record P18 market-hours validation evidence`

## 16. Remaining Issues

1. EDINET configured-key retrieval remains unverified because no EDINET key was
   configured in this environment.
2. `ERR_ABORTED` continues to occur frequently during reload and request
   cancellation, but no UI/safety impact was observed in this run.
3. Some browser-visible Japanese text remains mojibake in the Zen Loop Desk
   area; this run did not modify UI copy because P18 was validation-focused.

## 17. Next Steps

1. Configure EDINET outside git and rerun the EDINET document check without
   displaying or recording the key value.
2. Continue tracking `ERR_ABORTED` only if it begins to affect stale UI,
   no-action visibility, or verified candidate gating.
3. Plan a separate UI-copy cleanup for the remaining browser-visible mojibake.
