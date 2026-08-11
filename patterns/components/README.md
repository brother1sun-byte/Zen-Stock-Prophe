# Component Pattern

## When to use

Use for a focused UI concept with clear inputs, particularly source/freshness status, decision-support state, or an independently testable panel.

## Rules

- Keep domain transformation in `src/utils/` or a hook; components render an explicit view model.
- Keep props small and named. Derive display metadata once rather than scattering label/tone rules.
- Use semantic roles where possible and stable `data-testid` values for product-critical state.
- Display source, warning, unavailable, and caution states instead of hiding them.
- Reuse existing CSS structure and components before introducing a new visual abstraction.

## Recommended example

`src/components/DataSourceBadge.jsx:1-20` delegates classification to `src/utils/dataSource.js`, renders compact/full variants, exposes an accessible title, and gives warning states stable test IDs.

`src/App.jsx:44-89` shows the existing component/hook/utility split; new behavior should move toward focused modules rather than enlarge the application component.

## Prohibited patterns

- Fetching external data directly inside a presentational component.
- Duplicating source labels, risk rules, or domain calculations in JSX.
- Selecting critical E2E controls only by fragile visual position or incidental text.
- Styling an unknown, stale, or synthetic value as confirmed live data.
