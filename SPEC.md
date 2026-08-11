# Zen Stock Prophet Pro Specification

## Product Overview

Zen Stock Prophet Pro is a local-first Japanese-stock research, explainable analysis, and practice-portfolio application. It consolidates market and disclosure evidence, highlights missing or stale data, and supports a user's manual decision. It does not place real orders.

## System Architecture

- A React 19 single-page UI is built and served with Vite during development.
- A FastAPI application supplies `/api/*`, owns SQLite persistence, coordinates market/research adapters, and serves the production frontend build.
- Vite proxies development `/api` requests to FastAPI on port 8889.
- Docker builds the frontend, then runs FastAPI/Uvicorn as a non-root user.
- Render deploys the Docker service and checks `/api/health`.

See `docs/architecture/system-overview.md` for boundaries and data flow.

## Core Domains

- Market universe, rankings, price history, and data-quality/freshness signals.
- Stock detail, advanced analysis, pre-open and day-trade research support.
- Disclosure and earnings research using available EDINET/J-Quants/manual sources.
- Watchlist, personal workspace, and Japanese-language decision-support views.
- Simulator-only practice orders, portfolio ledger, lifecycle history, and reviews.
- Safety gates that prevent unverified candidates or broker execution from becoming actionable orders.

## Technical Stack

- Frontend: JavaScript/JSX, React 19, Vite 8, Recharts, Lucide React.
- Backend: Python 3.12, FastAPI, Pydantic, Uvicorn, pandas/numpy/scikit-learn and data-source libraries listed in `requirements-render.txt`.
- Database: SQLite configured by `ZEN_DB_PATH`.
- Tests: Python `unittest`/FastAPI `TestClient` with `requirements-test.txt`; Playwright for browser and directly imported frontend utility tests.
- Quality: ESLint, Vite build, Python compile/unittest, Playwright, dependency-integrity checks, repository secret/safety checks, and npm production vulnerability audit.
- Delivery: Docker, Render; Cloudflare tunnel is an optional temporary development share command.
- Package management: npm lockfile for frontend; pinned pip requirements for Render.
- Formatter: `NOT_CONFIGURED` (no Prettier, Black, or Ruff formatter configuration exists).
- Static typecheck: `NOT_CONFIGURED` (no TypeScript, mypy, or pyright configuration exists). Python annotations and build/lint checks do not equal a static typecheck.
- Python vulnerability audit: `NOT_CONFIGURED` (no pip-audit or equivalent is installed). `pip check` verifies installed dependency consistency, not known vulnerabilities.

## Directory Architecture

- `src/`: frontend entry point, components, hooks, pure utilities, and static/manual data.
- `backend/`: FastAPI application and focused market, research, portfolio, and analysis services.
- `tests/`: Python unit/integration tests and Playwright tests under `tests/ui/`.
- `scripts/`: operator utilities; they must not silently perform external or destructive actions.
- `docs/`: user, architecture, product, decision, plan, release, and runbook documentation.
- `patterns/`: project-specific implementation guidance linked to source-of-truth code.
- `agents/`: independent AI role contracts and workflow evaluations.
- `validators/`: the cross-platform validation entry point and guardrails.
- `integrations/`: documentation for integrations already present in the repository.

## Development Rules

- Preserve `manual_decision_support`, `LIVE_BROKER_ORDERS_ENABLED = False`, and the broker-disabled API behavior.
- Extend existing hooks, utilities, focused services, and tests before adding new abstractions.
- Treat source, freshness, cached/synthetic status, and unavailable inputs as part of the product contract.
- Do not expose environment values to frontend code, logs, reports, fixtures, or commits.
- Use temporary databases in tests and parameterized SQLite statements in runtime code.
- Preserve current API consumers. Breaking schema, environment, database, or deployment changes require an explicit decision record and migration/rollback plan.
- Update the closest durable documentation when behavior or operations change.

## Definition of Done

A change is done only when:

- The stated requirement and acceptance criteria are met with no unrelated refactor.
- Relevant implementation patterns and project boundaries are preserved.
- `python validators/validate_all.py` completes successfully, or every `NOT_CONFIGURED`/environmental limitation is truthfully reported and Release Manager blocks the release.
- ESLint, Python compile, Python tests, Vite build, Playwright tests, dependency checks, safety checks, and agent-contract checks pass where applicable.
- Formatter, static typecheck, and Python vulnerability audit remain explicitly `NOT_CONFIGURED`; they are never reported as passed.
- No critical security issue, secret exposure, production-data risk, or broker/live-order capability is introduced.
- Reviewer has no `CRITICAL` or `HIGH` finding and reports `APPROVED`.
- QA independently executes the relevant checks and reports `PASS`.
- Unused code, temporary hacks, skipped validation, and unresolved TODO escapes are absent.
- API compatibility, environment changes, migrations, deployment risk, and rollback are documented.
- Release Manager reports `READY_TO_RELEASE`; otherwise the result is `BLOCKED`.
