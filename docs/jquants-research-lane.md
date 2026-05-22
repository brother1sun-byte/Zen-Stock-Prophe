# J-Quants Research Lane

Zen Stock Prophet Pro now treats J-Quants API as the preferred official Japan-stock equivalent to Financial Datasets for research data.

## Why J-Quants

- It is provided through the JPX/J-Quants surface for Japanese equities.
- It covers listed issue information, daily OHLC, financial statements, dividends, and earnings announcement schedules.
- It fits the app as a research supplement, not an execution source.

## Safety Boundary

- Rakuten Securities, MarketSpeed RSS, and RPA order-entry integration are out of scope and not used.
- J-Quants is read-only and does not create order intents.
- Live broker orders remain disabled.
- If no token is configured, the app returns connector readiness only.

## Free Plan Data Policy

J-Quants free-plan data is delayed. Zen Stock Prophet Pro therefore uses a
two-lane design:

- Recent lane: the most recent 12 weeks are filled by a separate read-only
  recent-data provider, currently the existing yfinance fallback. This is only
  for dashboard freshness and is not treated as official exchange history.
- Official history lane: data older than 12 weeks and up to the configured
  two-year free-plan window is fetched from J-Quants as the official historical
  source.
- API packets expose both `recentQuote` and `delayedQuote`. `latestQuote` uses
  `recentQuote` when available, otherwise it falls back to `delayedQuote`.
- `dataPolicy.recentWindowDays` defaults to `84`, and
  `dataPolicy.officialHistoryDays` defaults to `730`.

## Setup

Set one of these values before starting the backend. For local use, prefer `.env.local`
because it is ignored by git and loaded by the backend automatically.

```powershell
Copy-Item .env.local.example .env.local
notepad .env.local
```

Or write the API key with the helper script:

```powershell
.\scripts\configure_jquants_token.ps1 -ApiKey "your-api-key"
```

Then start the backend as usual:

```powershell
$env:ZEN_API_HOST = "127.0.0.1"
$env:ZEN_API_PORT = "8889"
python backend/server.py
```

## API

```text
GET /api/research/jquants/status
GET /api/research/jquants/{code}
```

Examples:

```text
GET /api/research/jquants/4980
GET /api/research/jquants/4980.T
```

The research packet returns issue metadata, the latest daily quote, the latest financial statement summary, and recent daily quote rows when credentials are configured.
