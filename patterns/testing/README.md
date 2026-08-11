# Testing Pattern

## When to use

Every behavior change requires the cheapest test that proves it and a regression/edge case appropriate to its risk.

## Rules

- Test pure Python/JavaScript functions directly before adding browser coverage.
- Use Python `unittest`, mocks, and deterministic frames/fixtures for analysis logic.
- Use FastAPI `TestClient` and a temporary SQLite path for API/persistence behavior.
- Use Playwright API route mocks and stable roles/test IDs for UI behavior.
- Test failure, missing-data, stale/cache, timeout, and concurrency paths when the change touches them.
- For Japanese visible copy, keep `tests/test_visible_copy_integrity.py` and browser mojibake checks passing.

## Recommended examples

- Analysis input/evidence tests: `tests/test_daytrade_analysis.py`.
- Concurrent cache and optional-context timeout tests: `tests/test_daytrade_analysis.py:147-255`.
- Temporary SQLite lifecycle test: `tests/test_portfolio_exit_plan.py:104-143`.
- Mocked UI with role/test-id assertions: `tests/ui/zen-ui.spec.js:371-415`.
- Visible-copy mechanical guard: `tests/test_visible_copy_integrity.py:34-83`.

## Prohibited patterns

- Real external APIs, secrets, normal user databases, or production data in tests.
- Sleep-only synchronization when an observable event/result can be awaited.
- Snapshot-only tests for domain/safety decisions.
- Deleting, skipping, or weakening a test to obtain PASS.
