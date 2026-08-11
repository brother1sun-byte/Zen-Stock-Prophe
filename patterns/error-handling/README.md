# Error Handling Pattern

## When to use

Use whenever an API, external data source, cache, local storage, analysis engine, or database operation can fail.

## Rules

- Classify expected failures and attach actionable context without secrets.
- Preserve exception chaining when translating backend errors.
- Fail closed for security, validation, order/broker, and corrupted-state boundaries.
- Optional data may fail soft only when the result explicitly says unavailable/partial and the primary decision is not promoted.
- Frontend catches update visible status/log state and return a documented null/error result.
- Cleanup busy state, in-flight markers, locks/events, and temporary resources in `finally`.

## Recommended examples

- HTTP error metadata and selected recoverable fallback: `src/api/apiClient.js:39-87`.
- Partial result with visible warning: `src/hooks/useMarketData.js:132-155`.
- Backend 404/422/502 mapping with chained exceptions: `backend/server.py:4612-4660`.
- Optional-context timeout returning an explicit error code: `tests/test_daytrade_analysis.py:234-255`.

## Prohibited patterns

- Empty/broad catch that hides a required failure.
- Logging and continuing after validation/security failure.
- Returning success with silently missing required fields.
- Leaking credentials, tokens, full authorization headers, or sensitive upstream payloads in error text.
