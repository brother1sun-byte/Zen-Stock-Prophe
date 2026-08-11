# Validators

## Full command

```powershell
python validators/validate_all.py
```

Windows wrappers:

```powershell
validators\validate-all.ps1
validators\validate-all.cmd
```

The runner executes all selected checks and summarizes them at the end. Any failed check exits 1. Explicit `--skip-ui` or `--skip-audit` produces `INCOMPLETE` and exits 2 when the remaining checks pass. The default full run is required for release judgment.

Install the Python test environment first:

```powershell
python -m pip install -r requirements-test.txt
```

## Checks

1. Resolved npm executable smoke (`npm.cmd` on Windows when applicable)
2. `git diff --check`
3. `validate_text_hygiene.py` for local tracked/staged/untracked changes and all tracked files in CI
4. `validate_agent_contracts.py`
5. `validate_repo_safety.py`
6. `npm run lint`
7. Python `compileall`
8. `python -m unittest discover -s tests`
9. `npm run build`
10. `npm run test:ui` once
11. `npm ls --depth=0`
12. `python -m pip check`
13. `npm audit --omit=dev --audit-level=high`

Python and Playwright receive a temporary `ZEN_DB_PATH`. Playwright also receives `ZEN_PLAYWRIGHT_REUSE_EXISTING=0`, so occupied development ports fail explicitly instead of reusing unknown backend/frontend processes. The validator never uses a user's normal simulator database.

## Individual guardrails

```powershell
python validators/validate_agent_contracts.py
python validators/validate_repo_safety.py
python validators/validate_text_hygiene.py
```

The safety validator checks tracked/new secret-like filenames, private-key headers, high-confidence credential assignments, and Bearer literals without printing matching values. It reports only file, line, and finding type, runs internal real-like/placeholder detector tests, verifies `.env` ignore coverage, and checks the manual-decision/broker-disabled source invariants.

## Truthful limitations

- Formatter: `NOT_CONFIGURED` because the repository has no Prettier, Black, or Ruff formatter configuration.
- Static typecheck: `NOT_CONFIGURED` because the repository has no TypeScript, mypy, or pyright configuration.
- Python vulnerability audit: `NOT_CONFIGURED` because pip-audit or an equivalent scanner is not installed. `python -m pip check` verifies dependency consistency only; it does not detect known vulnerabilities.
- `compileall`, ESLint, and Vite build are useful checks but are not reported as a static typecheck.
- npm audit requires registry access. Use `--skip-audit` only for a clearly labeled non-release diagnostic run.
