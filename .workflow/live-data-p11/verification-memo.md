# P11 Live Market Data Verification Memo

## Scope

This memo records the P11 live-data stability check for Zen Stock Prophet Pro.
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
- Market-hours live confirmation: not performed because this run occurred on a Saturday.
- Off-hours/weekend confirmation: performed against the local FastAPI and Vite servers.
- Real API-key retrieval confirmation: not performed because EDINET/J-Quants credentials were not configured in this shell environment.

## API Behavior Observed

- EDINET documents endpoint responded safely with an API-key-missing status.
- J-Quants earnings-calendar endpoint responded safely without exposing credentials.
- Stocks and daytrade risk-state endpoints responded successfully.
- No API key or credential value was printed to the terminal, browser console, diff, or this memo.

## Mobile UI Smoke Result

- Checked widths: 390px, 430px, and 768px.
- Lifestyle daytrade panel remained visible.
- Night Scan, Morning Gate, Work Monitor, and After Close Review were reachable.
- Manual price input accepted a test value and remained editable.
- After Close Review JSON/CSV export controls remained visible.
- No horizontal overflow was detected at the checked mobile widths.
- No browser console errors or page errors were observed during the smoke check.

## 30 Minute Live Monitor

- Start: 2026-07-04T09:35:35.833Z.
- End: 2026-07-04T10:06:25.135Z.
- Duration: 30.8 minutes.
- Samples: 31.
- Console errors: none.
- Page errors: none.
- Horizontal overflow: none.
- Lifestyle panel visible in every sample: yes.
- Decision brief visible in every sample: yes.
- After Close Review visible in every sample: yes.
- Data notices visible in every sample: yes.
- Heap observation: used JS heap decreased from about 42.1 MB to about 39.6 MB; no abnormal increase was observed.
- Request failures: repeated `net::ERR_ABORTED` events were observed for `/api/daytrade/signals?kind=gainers`; the UI remained stable and continued to show safe data notices.
- Data flags observed: synthetic/fallback/manual-input notices were visible; cache text was not observed in this run.
- Secret values displayed or recorded: none.

## Safety Boundary

The app remains a manual decision-support tool. It does not provide investment
advice, guarantee profit, place orders, automate trading, connect to broker APIs,
or send trading logs externally. Final decisions remain the user's responsibility.

## Remaining Checks

- Real EDINET/J-Quants retrieval with actual credentials.
- Market-hours behavior on a trading day.
- Natural authentication-failure and rate-limit behavior if it occurs under normal usage.
- Investigation of repeated aborted `gainers` signal requests if they appear in real user sessions.
