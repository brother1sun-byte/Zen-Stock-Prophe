# Project Agent Rules

## Project Mission

Zen Stock Prophet Pro is a Japanese-stock research and simulation tool. It helps a human inspect evidence, data quality, risk, and practice-ledger outcomes. It is not an automated trading system and must remain `manual_decision_support`.

## Engineering Principles

- Prefer the smallest simple change that satisfies the requirement.
- Reuse existing code and the examples in `patterns/`; do not duplicate logic.
- Do not add dependencies without a demonstrated need and review.
- Preserve type intent in Python annotations and JavaScript data contracts; do not bypass errors with unsafe coercion.
- Never swallow actionable errors. Optional-data failures must remain visible as unavailable, stale, cached, or partial.
- Preserve security boundaries, API compatibility, and persisted ledger history.
- Keep changes reviewable, backward-aware, and testable.

## Repository Rules

- React/Vite UI belongs in `src/`; reusable behavior goes in `src/hooks/` or `src/utils/`, and focused UI in `src/components/`.
- FastAPI routes and orchestration live in `backend/server.py`; reusable backend behavior belongs in focused `backend/*.py` modules. Do not perform a broad `server.py` refactor inside unrelated work.
- Frontend imports use relative ESM imports. Python modules retain the existing backend import compatibility used by `backend/server.py`.
- Validate API inputs at the boundary, return meaningful HTTP status codes, and preserve existing response fields unless a breaking change is explicitly approved.
- SQLite writes use parameterized SQL. Retain lifecycle and transaction history; never operate on a production database during tests.
- Record state-changing simulator actions without secrets. Do not log credentials, raw authorization data, or unnecessary external payloads.
- Tests belong in `tests/`; use pure-function tests, temporary SQLite databases, FastAPI `TestClient`, and Playwright mocks/test IDs as appropriate.
- Secrets stay in ignored local environment files. Never display, commit, or expose their values.
- Live broker orders, broker/RPA integration, automatic order execution, and guaranteed-profit claims are prohibited.

## AI Development Rules

Work in this order:

`Understand -> Plan -> Implement -> Validate -> Review -> Test -> Report`

- If requirements are unclear, do not make a large architectural change. State the uncertainty and choose a reversible minimal path or request a decision.
- Builder implementation is not final approval. Reviewer, QA, and Release Manager responsibilities stay independent; see `agents/README.md`.
- Run `python validators/validate_all.py` before release. Do not weaken tests, lint, safety checks, or validators to obtain a pass.
- Any production-data mutation, credential/account change, external publication/deployment, force push, or main/master push requires `HUMAN_APPROVAL_REQUIRED`.

## Detailed References

- Product and Definition of Done: `SPEC.md`
- Architecture and boundaries: `docs/architecture/system-overview.md`, `docs/product/product-boundaries.md`
- Implementation patterns: `patterns/README.md`
- Team workflow and roles: `agents/README.md`
- Validation: `docs/runbooks/validation.md`, `validators/README.md`
- Release and rollback: `docs/runbooks/release-and-rollback.md`
- Existing operating docs: `docs/user-manual.md`, `docs/release-checklist.md`, `docs/render-deployment.md`
