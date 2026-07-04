# P13 Monday Market-Hours Live Data Checklist

## Purpose

Prepare a safe Monday market-hours verification run for Zen Stock Prophet Pro.
This checklist must not contain API key values, credentials, screenshots with
secrets, or external trading logs.

## Monday P13 Conditions

- Run during a Japanese equity market session.
- Target windows: 9:00-11:30 or 12:30-15:30 JST.
- Keep the app open for at least 30 minutes.
- Confirm EDINET / J-Quants key configuration by presence only.
- Do not print, copy, screenshot, log, or commit API key values.
- Keep `.env` out of git.
- Treat all output as manual decision-support evidence, not investment advice.

## Pre-Run Commands

```bash
git status --short
git log -1 --oneline
git check-ignore -v .env
```

## API Key Presence Check

Record only these states:

- EDINET API key: configured / not configured
- J-Quants credentials: configured / not configured
- `.env`: present / not present
- `.env.example`: present / not present
- Secret values displayed: none

Do not record actual values.

## Live Data Checks

- EDINET API response.
- J-Quants authentication response.
- J-Quants price response.
- J-Quants volume response.
- Price display.
- Volume display.
- Data update timestamp.
- Delayed-data display.
- Cache display.
- synthetic display.
- fallback display.
- Missing-data safe display.
- No API key or credential values in logs, UI, diffs, or notes.

## Lifestyle Daytrade UI Checks

- Night Scan is visible.
- Morning Gate is visible.
- Work Monitor is visible.
- After Close Review is visible.
- "今日見るべきポイント" is visible.
- "材料" is separated from other signals.
- "需給" is separated from other signals.
- "テクニカル" is separated from other signals.
- "リスク" is separated from other signals.
- Manual price input is visible and usable.
- After Close Review JSON export UI is visible.
- After Close Review CSV export UI is visible.

## Mobile Width Checks

Check each width:

- 390px
- 430px
- 768px

For each width, confirm:

- No horizontal overflow.
- Major cards remain readable.
- Manual price input remains usable.
- Export controls remain reachable.
- No console errors.
- No page errors.

## 30+ Minute Live Monitor

Record:

- Start time.
- End time.
- Duration.
- Console error count.
- Page error count.
- UI breakage: yes / no.
- Horizontal overflow: yes / no.
- Heap or memory abnormal increase: yes / no.
- API success/failure state.
- cache / synthetic / fallback visibility.
- `ERR_ABORTED` occurrence count.
- Secret values displayed: none.

## ERR_ABORTED Review

For `/api/daytrade/signals?kind=gainers`, confirm:

- Reproduced during market hours: yes / no.
- Reproduced outside market hours: yes / no.
- UI impact: none / visible issue.
- Data notice impact: none / visible issue.
- Likely cause: cancellation / timeout / navigation / unknown.
- Fix needed: yes / no.
- Reason for the fix/no-fix decision.

## Failure And Edge Cases

Confirm safe behavior where possible:

- API key missing.
- API key configured.
- Authentication failure.
- Rate limit, only if naturally encountered or safely mocked.
- Network failure.
- Missing data.
- Cache usage.
- synthetic/fallback usage.
- Broken localStorage.
- Empty localStorage.

Do not intentionally stress real APIs to force a rate limit.

## Post-Run Tests

```bash
npm run lint
npm run build
npm run test
npm run test:ui
python -m unittest discover -s tests
git diff --check
git status --short
```

## P13 Verification Memo

After the run, create:

```text
.workflow/live-data-p13/verification-memo.md
```

The memo should include:

- Real API key configured/not configured status, without values.
- Market-hours confirmation range.
- Off-hours confirmation range, if performed.
- 30+ minute live monitor result.
- `ERR_ABORTED` reproduction and judgment.
- Unverified ranges.
- Confirmation that API key values were not recorded.
- Confirmation that `.env` stayed out of git.
- Confirmation that final decisions remain the user's responsibility.

## Safety Boundary

Zen Stock Prophet Pro is a manual decision-support tool. It does not provide
investment advice, guarantee profit, place orders, automate trading, connect to
broker APIs, or send trading logs externally.
