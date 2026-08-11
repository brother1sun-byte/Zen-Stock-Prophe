# AI Development Team Bootstrap Plan

## Goal

Create a repository-specific, mechanically validated five-role development workflow without changing product behavior, adding dependencies, exposing secrets, or performing external operations.

## Current state

- React/Vite frontend, FastAPI/SQLite backend, Python and Playwright tests.
- Docker/Render deployment and optional Cloudflare development tunnel.
- ESLint and build/test commands exist; formatter and static typechecker do not.
- No repository-level AI constitution, role contracts, unified validator, or GitHub Actions workflow existed at plan creation.

## Files affected

- Governance: `AGENTS.md`, `SPEC.md`.
- Knowledge: selected `docs/` and `patterns/` files.
- Delegation: `agents/` role contracts and eval cases.
- Guardrails: `validators/`, `.github/workflows/validate.yml`.
- Integration documentation: `integrations/`; Render deploy gate in `render.yaml`.

## Implementation steps

1. Record architecture, product boundaries, engineering rules, and Definition of Done.
2. Extract only source-backed API, frontend, database, test, error, and security patterns.
3. Define independent role outputs, handoffs, three-cycle repair limit, and human approval boundaries.
4. Add deterministic contract/safety validators and a cross-platform full validation runner.
5. Add CI that installs pinned dependencies, runs the validator, and verifies the Docker build.
6. Require checks to pass before Render auto-deploy eligibility.
7. Run contract and repository-safety checks, then have independent Reviewer and QA assess the resulting diff.

## Risks and mitigations

- CI network/dependency variability: audit remains explicit and fail-closed; results identify the failing command.
- Playwright touching local state or reusing an unrelated server: the validator supplies a temporary `ZEN_DB_PATH` and disables existing-server reuse.
- False completion claims: formatter, typecheck, and Python vulnerability audit are reported `NOT_CONFIGURED`, never passed.
- Unsafe autonomy: external actions and production/data/account changes require human approval.

## Acceptance criteria

- All planned files are present and reference actual repository behavior.
- Role and eval contracts pass `validate_agent_contracts.py`.
- Safety invariants pass `validate_repo_safety.py` without displaying secret content.
- Full validator has one documented command and nonzero failure behavior.
- No commit, push, deployment, credential change, or product behavior change is performed by this bootstrap.
