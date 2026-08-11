# System Overview

## Runtime topology

1. `src/main.jsx` mounts the React application defined by `src/App.jsx` and focused components/hooks/utilities.
2. In development, Vite listens on 5174 and proxies `/api` to FastAPI on 8889 (`vite.config.js`).
3. `backend/server.py` exposes FastAPI routes and delegates reusable work to focused modules such as `portfolio_api_service.py` and `daytrade_analysis.py`.
4. SQLite stores simulator portfolio, holdings, transactions, and audit messages. `ZEN_DB_PATH` selects the database path.
5. Market and research adapters return live, cached, synthetic, manual, or unavailable provenance. The UI must preserve those distinctions.
6. In production, `Dockerfile` builds `dist/`, copies it into a Python runtime, and Uvicorn serves the API and SPA. `render.yaml` defines the Render service and health check.

## Trust boundaries

- Browser: presentation and user-controlled local inputs; never receives secret API values.
- FastAPI: validates API input, reads server-side environment configuration, coordinates external data, and owns persistence.
- External sources: untrusted and fallible; timeout, source, freshness, and error state are product data.
- SQLite: simulator ledger only. Tests use a temporary database, never a user's runtime database.
- Broker boundary: deliberately absent. `/api/buy` and `/api/sell` remain broker-disabled, and health reports `manual_decision_support`.

## Key constraints

- `backend/server.py` is a large compatibility surface; extract only focused behavior needed by the active change.
- Preserve existing `/api/*` fields used by React and Playwright.
- Cache and fallback behavior must never convert unverified data into a verified or actionable signal.
- See `docs/product/product-boundaries.md` and existing `docs/jquants-research-lane.md` for product/source-specific detail.
