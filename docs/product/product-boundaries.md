# Product Boundaries

## The product does

- Organize Japanese-stock research, evidence, data-source status, and risk checks.
- Provide explainable analysis and practice-only portfolio/transaction records.
- Mark live, cached, manual, synthetic, stale, unavailable, and unverified evidence distinctly.
- Help a human prepare, review, and record a manual decision.

## The product does not

- Place, route, or automate real broker orders.
- Connect to broker/RPA execution or promise profit, certainty, or investment advice.
- Promote an unverified ranking, synthetic price, or missing source to an actionable candidate.
- Send review data, prompts, transaction history, secrets, or logs to external AI automatically.
- Delete production data or mutate external services as part of routine validation.

## Non-negotiable release invariants

- `/api/health` identifies `manual_decision_support` and reports live orders disabled.
- Buy/sell endpoints remain `BROKER_DISABLED`.
- Secrets stay server-side and out of tracked files and generated evidence.
- Ledger lifecycle changes retain history and reasons.
- User-visible Japanese copy does not conceal data gaps or source quality.

User instructions and release checks remain in `docs/user-manual.md`, `docs/release-checklist.md`, and `docs/retail-release-readiness.md`.
