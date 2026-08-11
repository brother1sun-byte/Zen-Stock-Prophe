# ADR 0001: Five-role AI development workflow

- Status: Accepted
- Date: 2026-08-11

## Context

The repository has meaningful frontend, backend, database, research-safety, and deployment surfaces but previously lacked one durable contract for AI planning, implementation, independent review, QA, and release judgment.

## Decision

Use five independent responsibilities:

1. Architect defines goal, impact, plan, risks, tests, and acceptance criteria.
2. Builder implements the approved minimal change and runs validators.
3. Reviewer inspects requirements and the diff independently; `CRITICAL` or `HIGH` findings prevent approval.
4. QA independently executes relevant checks and edge cases.
5. Release Manager considers only Reviewer-approved and QA-passed changes, then returns `READY_TO_RELEASE` or `BLOCKED`.

Reviewer or QA failures return to Builder for at most three repair cycles. A third failed cycle becomes `BLOCKED` with evidence and a human decision request. Dangerous or externally mutating operations stop as `HUMAN_APPROVAL_REQUIRED`.

`AGENTS.md` is the top-level rule, `agents/` contains role contracts, `patterns/` records source-backed examples, and `validators/validate_all.py` is the mechanical validation entry point.

## Consequences

- Builder cannot self-approve or release.
- Handoffs require explicit outputs rather than informal claims.
- The workflow adds documentation and validation cost but reduces role confusion and unsafe release claims.
- It does not create a runtime broker, deployment bot, or external orchestration service.
