# Release and Rollback Runbook

## Release gate

A release candidate requires:

- Full validator success with no skipped UI or audit checks.
- Reviewer `APPROVED` with no `CRITICAL` or `HIGH` findings.
- QA `PASS` with executed evidence.
- Release Manager review of migrations, environment variables, API compatibility, documentation, deployment risk, and rollback.
- Human approval before any push, deployment, account/credential change, or production-data operation.

Existing operational detail remains in `docs/release-checklist.md`, `docs/render-deployment.md`, and `docs/release-notes.md`.

## Render release

Render uses `Dockerfile`, `render.yaml`, and `/api/health`. Auto-deploy eligibility is gated on repository checks. Do not change environment values or trigger deployment from validation.

## Rollback

1. Stop further rollout and preserve failing logs without secret values.
2. Identify the last known-good commit/image and the affected API, UI, environment, or schema surface.
3. Prefer deploying the last known-good immutable revision. Do not force push or rewrite history.
4. SQLite schema changes require a forward/backward data plan before release. Never delete a production database as rollback.
5. Verify `/api/health`, manual-decision mode, broker-disabled behavior, primary UI smoke paths, and persisted ledger visibility.
6. Record the incident, cause, evidence, and follow-up decision. External rollback execution requires human approval.

If a safe rollback cannot preserve data or compatibility, return `BLOCKED` and request a human decision.
