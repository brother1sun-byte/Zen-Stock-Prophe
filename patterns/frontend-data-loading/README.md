# Frontend Data Loading Pattern

## When to use

Use for hooks that load multiple API resources, refresh selected data, or can receive overlapping user requests.

## Rules

- Use `Promise.allSettled` when partial data is useful; return and display the list of failed resources.
- Retain previous/cached values only with freshness and source metadata.
- Deduplicate the same in-flight request and prevent old responses from overwriting newer selections.
- Set busy/status state symmetrically and clear it in `finally`.
- Encode tickers and search text. Use endpoint-specific timeouts.
- Keep state-transition helpers pure where practical so they can be tested without a browser.

## Recommended examples

- Partial hydration and explicit error/status result: `src/hooks/useMarketData.js:78-155`.
- Per-ticker in-flight request reuse: `src/hooks/useMarketData.js:179-243`.
- Request-id stale-response guard: `src/hooks/useMarketData.js:245-266`.

## Prohibited patterns

- `Promise.all` for independent optional resources when one failure would blank the whole screen.
- Ignoring rejected results or converting them into a normal success status.
- Updating state from an obsolete response.
- Cache fallback without an age/source warning.
