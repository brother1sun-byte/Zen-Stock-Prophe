# Security and Safety Pattern

## When to use

Use for environment configuration, external data, CORS/network exposure, database paths, decision-support gates, and any proposed integration.

## Rules

- Secrets live only in ignored server-side environment files/configuration; report presence/absence, never values.
- Existing process environment wins over `.env.local`; local loading must not overwrite it.
- Keep CORS restricted to configured local/private origins unless a reviewed deployment requirement says otherwise.
- Preserve `LIVE_BROKER_ORDERS_ENABLED = False`, `manual_decision_support`, and `BROKER_DISABLED` behavior.
- Treat external input/data as untrusted. Validate tickers and expose source/freshness/quality.
- Require `HUMAN_APPROVAL_REQUIRED` for deployment, account/credential changes, production data, main/master push, force push, or destructive/external actions.

## Recommended examples

- Non-overwriting local env loader: `backend/local_env.py:11-27`.
- Secret/local artifact ignore rules: `.gitignore:18-37`.
- CORS and live-order hard disable: `backend/server.py:118-125`.
- Machine-visible health invariant: `backend/server.py:3830-3837`.
- Broker-disabled buy/sell endpoints: `backend/server.py:4371-4378`.

## Prohibited patterns

- Printing, logging, screenshotting, diffing, committing, or returning secret values.
- Client-side secret configuration or tracked real `.env` files.
- Authentication/security/check bypass, wildcard network exposure without review, or disabling validators.
- Broker/RPA integration, automatic orders, production DB deletion, or guaranteed-profit claims.
