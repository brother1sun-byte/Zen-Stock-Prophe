# Validation Runbook

## Full validation

From the repository root:

```powershell
python validators/validate_all.py
```

Windows convenience entry points are `validators\validate-all.ps1` and `validators\validate-all.cmd`.

Install the Python test environment with `python -m pip install -r requirements-test.txt`. The file includes the Render runtime requirements and the pinned FastAPI test-client dependency.

The runner executes local changed/staged/untracked text hygiene (all tracked text in CI), agent/eval contracts, secret and safety invariants, ESLint, Python compilation, Python tests, frontend build, Playwright, npm dependency integrity, pip dependency integrity, and npm production vulnerability audit. It runs every selected check, prints a summary, and exits nonzero if any check fails.

Playwright receives a temporary `ZEN_DB_PATH` and `ZEN_PLAYWRIGHT_REUSE_EXISTING=0`. It must start validator-owned backend/frontend processes; if port 8889 or 5174 is already occupied, the check fails rather than reusing an unknown server or normal database.

## Explicit reduced modes

- `--skip-ui`: omit Playwright only when browser execution is unavailable. This is not a release-pass result.
- `--skip-audit`: omit the network-backed npm audit only when the registry is unavailable. This is not a release-pass result.

Formatter, static typecheck, and Python vulnerability audit print `NOT_CONFIGURED`. They are not counted as passes. `pip check` is dependency consistency only, not a vulnerability audit. See `validators/README.md` for individual commands and interpretation.

## Failure handling

1. Keep the first failing command and complete summary as evidence.
2. Builder fixes the smallest root cause; never disable the check or delete a test.
3. Reviewer inspects the diff; QA reruns the relevant check independently.
4. After three failed repair cycles, stop as `BLOCKED` and report the problem, attempted repairs, failure reason, and human decision needed.
