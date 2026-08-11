# SQLite Ledger Pattern

## When to use

Use for simulator portfolio, holding lifecycle, transaction, or audit-record changes. This pattern does not authorize production-data operations.

## Rules

- Validate and normalize values before opening a write transaction.
- Use parameterized SQL exclusively.
- Persist the domain change, transaction history, and audit message in one commit.
- Represent SOLD, VOIDED, and ARCHIVED as lifecycle states; retain the historical row, reason, and timestamp.
- Tests set `ZEN_DB_PATH` or `server.DB_PATH` to a temporary directory and restore it in `finally`.
- Close/rollback safely on exceptions in new code; do not copy manual connection cleanup where it lacks exception protection.

## Recommended examples

- Validated manual position with parameterized upsert and transaction record: `backend/portfolio_api_service.py:134-180`.
- Non-destructive close lifecycle and retained reason/history: `backend/portfolio_api_service.py:206-267`.
- Temporary-database API lifecycle test: `tests/test_portfolio_exit_plan.py:104-143`.

## Prohibited patterns

- Tests or validators using the user's normal/production database.
- Deleting lifecycle history to correct an entry or make a test pass.
- SQL assembled from input strings.
- Schema change without compatibility, migration, and rollback review.
