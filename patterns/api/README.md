# API Pattern

## When to use

Use this pattern for a new frontend API call, FastAPI route, external-data adapter boundary, or expensive endpoint that can receive concurrent requests.

## Rules

- Normalize and validate path/query/body input at the FastAPI boundary.
- Use the shared frontend `api()` client, an operation-appropriate timeout, and URL encoding for user-controlled path/query values.
- Distinguish invalid input, missing data, unavailable capability, and upstream failure with meaningful 4xx/5xx status codes.
- Retry/fallback only errors known to be recoverable; retain the last useful error.
- For expensive duplicate work, use bounded caching/request coalescing without turning failed or stale data into verified data.
- Preserve existing response fields or document and approve a breaking change.

## Recommended examples

- Frontend timeout and recoverable-base fallback: `src/api/apiClient.js:33-87`.
- Ticker normalization and validation: `backend/server.py:3226-3241`.
- Query constraint, cache, request coalescing, and exception mapping: `backend/server.py:4575-4660`.
- Concurrency/cache verification: `tests/test_daytrade_analysis.py:147-232`.

Extend these implementations or extract a focused helper; do not reproduce them in a new client or route framework.

## Prohibited patterns

- Bare or broad exceptions that silently return success/null.
- Infinite retry, unbounded external waits, or retrying validation/authorization failures.
- Raw string interpolation into SQL, paths, or unencoded API parameters.
- Returning synthetic, cached, or unavailable data as live/verified.
- Adding broker execution or order-routing endpoints.
