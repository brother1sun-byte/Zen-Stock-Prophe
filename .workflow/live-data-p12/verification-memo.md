# P12 Market-Hours Live Data Verification Memo

## Scope

This memo records the P12 live-data stability check for Zen Stock Prophet Pro.
It does not contain API key values, credentials, screenshots with secrets, or
external trading logs.

## API Configuration

- EDINET API key: not configured in the current shell environment.
- J-Quants API key or credential variables: not configured in the current shell environment.
- `.env`: not present in the working tree.
- `.env.example`: present.
- `.env` ignore rule: confirmed by `git check-ignore -v .env`.
- Secret values displayed or recorded: none.

## Date And Market Session Coverage

- Verification date: 2026-07-04 JST.
- Day of week: Saturday.
- Market-hours live confirmation: not performed because this run occurred outside the Japanese equity market session.
- Off-hours/weekend confirmation: performed against the local FastAPI and Vite servers.
- Real API-key retrieval confirmation: not performed because EDINET/J-Quants credentials were not configured in this shell environment.

## API Behavior Observed

- EDINET documents endpoint responded safely with an API-key-missing status.
- J-Quants earnings-calendar endpoint responded safely without exposing credentials.
- Stocks, daytrade risk-state, and daytrade signals endpoints responded successfully.
- `/api/daytrade/signals?kind=gainers` returned `NO_VERIFIED_RANKING_SIGNAL` when requested directly.
- No API key or credential value was printed to the terminal, browser console, diff, or this memo.

## Mobile UI Smoke Result

- Checked widths: 390px, 430px, and 768px.
- A `networkidle` wait timed out once, likely because the app continues background data retrieval; the follow-up smoke used `domcontentloaded` plus required UI selectors.
- Lifestyle daytrade panel remained visible.
- Night Scan, Morning Gate, Work Monitor, and After Close Review were reachable.
- Manual price input remained visible.
- No horizontal overflow was detected at the checked mobile widths.
- No browser console errors, page errors, or request failures were observed during the follow-up smoke check.
- Synthetic/fallback/manual-input notices were visible.

## 30 Minute Live Monitor

- Start: 2026-07-04T12:33:00.939Z.
- End: 2026-07-04T13:03:07.221Z.
- Duration: 30.1 minutes.
- Samples: 31.
- Console errors: none.
- Page errors: none.
- Horizontal overflow: none.
- Lifestyle panel visible in every sample: yes.
- Decision brief visible in every sample: yes.
- Night Scan card visible in every sample: yes.
- After Close Review text visible in every sample: yes.
- Data notices visible in every sample: yes.
- Heap observation: used JS heap decreased from about 64.0 MB to about 35.1 MB; no abnormal increase was observed.
- Data flags observed: synthetic, fallback, manual-input, today-points, material, supply-demand, technical, and risk text were visible.
- Cache text was not observed in this run.
- Secret values displayed or recorded: none.

## ERR_ABORTED Review

- Reproduced: yes.
- Count: 9 request failures during the 30.1 minute monitor.
- Endpoint: `/api/daytrade/signals?kind=gainers`.
- Failure: `net::ERR_ABORTED`.
- Direct endpoint check: returned HTTP 200 with `NO_VERIFIED_RANKING_SIGNAL`.
- UI impact: none observed. The lifestyle panel, decision brief, Night Scan card, data notices, and After Close Review text remained visible in all samples.
- Console/page impact: none observed.
- Current judgment: no code fix in P12. The aborted requests appear to be background retrieval or cancellation behavior without user-visible breakage. Revisit only if the same endpoint causes visible stale-data warnings, user-facing errors, or repeated console failures in a weekday market-hours run.

## Safety Boundary

The app remains a manual decision-support tool. It does not provide investment
advice, guarantee profit, place orders, automate trading, connect to broker APIs,
or send trading logs externally. Final decisions remain the user's responsibility.

## Remaining Checks

- Real EDINET/J-Quants retrieval with actual credentials.
- Market-hours behavior on a trading day.
- Market-hours 30+ minute monitor with real credentials configured.
- Natural authentication-failure and rate-limit behavior if it occurs under normal usage.
- Follow-up review of `ERR_ABORTED` during a weekday market-hours run.
