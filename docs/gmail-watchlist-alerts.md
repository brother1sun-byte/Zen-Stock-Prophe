# Gmail Watchlist Alerts

Zen Stock Prophet Pro can now produce an email-ready alert when a Watchlist stock is close to its planned limit price.

## Safety Boundary

- This is a notification system, not investment advice.
- It never places live broker orders.
- It only reports when the local simulator says a stock is actionable or near the planned limit price.
- Final judgment and any order entry must remain manual.

## Alert Rules

- `ACTIONABLE`: the existing technical analysis says `BUY_LIMIT_OK` with at least 60% confidence.
- `SOON`: the analysis says `WAIT_FOR_PULLBACK`, but the current price is within 2% above the planned limit price.
- `MARKET_CAUTION`: the stock is otherwise actionable or close, but broad Japanese equity indexes are both weak.
- `WAIT`, `WATCH`, and `AVOID` are included in the report but do not trigger urgent email.

## Local Check

Run:

```powershell
python scripts\check_watchlist_alerts.py
```

Outputs:

- `backend\alerts\latest_watchlist_alert.json`
- `backend\alerts\latest_watchlist_email.txt`

Exit code is `2` when urgent alerts exist and `0` when there is no urgent alert.

## API

When the backend is running:

```powershell
Invoke-RestMethod http://127.0.0.1:8889/api/alerts/watchlist
```

The response contains:

- `status`
- `market`
- `alerts`
- `candidates`
- `email.subject`
- `email.body`

## Gmail Automation

The recurring Codex automation checks this report during Japanese market hours. It sends Gmail only when `alerts` is not empty. No email is sent for a normal no-action state, so the mailbox stays quiet until a review-worthy timing appears.

The alert automation is configured as a Codex `worktree` cron job, not a `local` PC job. That matters operationally:

- `worktree` execution keeps the notification check independent of this PC being powered on.
- The job runs `python scripts\check_watchlist_alerts.py --local-only`, so it does not depend on a localhost FastAPI server.
- If the automation environment is missing the app's runtime Python packages, the job installs only the existing runtime needs before rerunning the check.
- A fully powered-off PC cannot run local software; PC-off notification requires this Codex-side automation or another external always-on runner.

## Morning Investment News

毎朝8時の朝刊メールは、次のAPI/スクリプトで作成します。

```powershell
Invoke-RestMethod http://127.0.0.1:8889/api/alerts/daily-digest
python scripts\build_morning_digest.py
```

The morning digest includes:

- broad market context
- Watchlist limit-price status
- urgent or near-entry alerts
- top candidate summary
- recent related news for the top Watchlist names

Outputs:

- `backend\alerts\latest_morning_digest.json`
- `backend\alerts\latest_morning_digest_email.txt`

The 8:00 Gmail automation also uses Codex `worktree` execution and runs `python scripts\build_morning_digest.py --local-only`, so the morning digest is not tied to the local PC being on.
