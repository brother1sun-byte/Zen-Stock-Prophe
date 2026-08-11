#!/usr/bin/env python3
"""Run the repository's complete mechanical validation suite."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Result:
    name: str
    status: str
    seconds: float = 0.0
    command: str = ""


def display_command(command: list[str]) -> str:
    return " ".join(f'"{item}"' if " " in item else item for item in command)


def resolve_npm_executable() -> str | None:
    """Resolve npm without relying on Windows subprocess PATHEXT behavior."""
    names = ("npm.cmd", "npm.exe", "npm") if os.name == "nt" else ("npm", "npm.cmd", "npm.exe")
    for name in names:
        resolved = shutil.which(name)
        if resolved:
            return resolved
    return None


def unavailable_check(name: str, executable: str) -> Result:
    print(f"\n=== {name} ===")
    print(f"Required executable was not found: {executable}")
    print(f"--- {name}: FAIL (0.0s) ---")
    return Result(name=name, status="FAIL", command=executable)


def run_check(name: str, command: list[str], *, env: dict[str, str] | None = None) -> Result:
    rendered = display_command(command)
    print(f"\n=== {name} ===")
    print(f"$ {rendered}")
    started = time.perf_counter()
    try:
        completed = subprocess.run(command, cwd=ROOT, env=env, check=False)
        status = "PASS" if completed.returncode == 0 else "FAIL"
    except OSError as exc:
        print(f"Unable to execute command: {exc}")
        status = "FAIL"
    elapsed = time.perf_counter() - started
    print(f"--- {name}: {status} ({elapsed:.1f}s) ---")
    return Result(name=name, status=status, seconds=elapsed, command=rendered)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-ui", action="store_true", help="Skip Playwright; result is incomplete and exits 2 if all executed checks pass.")
    parser.add_argument("--skip-audit", action="store_true", help="Skip npm audit; result is incomplete and exits 2 if all executed checks pass.")
    args = parser.parse_args()

    results: list[Result] = []
    print("Formatter check: NOT_CONFIGURED (no repository formatter configuration)")
    results.append(Result("formatter", "NOT_CONFIGURED"))
    print("Static typecheck: NOT_CONFIGURED (no TypeScript/mypy/pyright configuration)")
    results.append(Result("typecheck", "NOT_CONFIGURED"))
    print("Python vulnerability audit: NOT_CONFIGURED (pip check verifies dependency consistency, not vulnerabilities)")
    results.append(Result("Python vulnerability audit", "NOT_CONFIGURED"))

    npm = resolve_npm_executable()
    if npm:
        results.append(run_check("npm executable smoke", [npm, "--version"]))
    else:
        results.append(unavailable_check("npm executable smoke", "npm/npm.cmd"))

    with tempfile.TemporaryDirectory(prefix="zen-validator-") as temp_dir:
        isolated_env = os.environ.copy()
        isolated_env["ZEN_DB_PATH"] = str(Path(temp_dir) / "simulator.db")
        isolated_env["PYTHONDONTWRITEBYTECODE"] = "1"
        isolated_env["ZEN_PLAYWRIGHT_REUSE_EXISTING"] = "0"

        checks: list[tuple[str, list[str] | None, dict[str, str] | None]] = [
            ("git diff hygiene", ["git", "diff", "--check"], None),
            ("changed and untracked text hygiene", [sys.executable, "validators/validate_text_hygiene.py"], isolated_env),
            ("agent and eval contracts", [sys.executable, "validators/validate_agent_contracts.py"], isolated_env),
            ("repository safety", [sys.executable, "validators/validate_repo_safety.py"], isolated_env),
            ("frontend lint", [npm, "run", "lint"] if npm else None, isolated_env),
            ("python syntax", [sys.executable, "-m", "compileall", "-q", "backend", "scripts", "tests", "validators"], isolated_env),
            ("python unit and integration tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests"], isolated_env),
            ("frontend build", [npm, "run", "build"] if npm else None, isolated_env),
        ]
        for name, command, env in checks:
            results.append(run_check(name, command, env=env) if command else unavailable_check(name, "npm/npm.cmd"))

        if args.skip_ui:
            print("\n=== Playwright UI/E2E ===\nSKIPPED by explicit --skip-ui (release validation is incomplete)")
            results.append(Result("Playwright UI/E2E", "SKIPPED"))
        else:
            if npm:
                results.append(run_check("Playwright UI/E2E", [npm, "run", "test:ui"], env=isolated_env))
            else:
                results.append(unavailable_check("Playwright UI/E2E", "npm/npm.cmd"))

        if npm:
            results.append(run_check("npm dependency integrity", [npm, "ls", "--depth=0"], env=isolated_env))
        else:
            results.append(unavailable_check("npm dependency integrity", "npm/npm.cmd"))
        results.append(run_check("Python dependency integrity", [sys.executable, "-m", "pip", "check"], env=isolated_env))

        if args.skip_audit:
            print("\n=== npm production vulnerability audit ===\nSKIPPED by explicit --skip-audit (release validation is incomplete)")
            results.append(Result("npm production vulnerability audit", "SKIPPED"))
        else:
            if npm:
                results.append(
                    run_check(
                        "npm production vulnerability audit",
                        [npm, "audit", "--omit=dev", "--audit-level=high"],
                        env=isolated_env,
                    )
                )
            else:
                results.append(unavailable_check("npm production vulnerability audit", "npm/npm.cmd"))

    print("\n=== VALIDATION SUMMARY ===")
    for result in results:
        duration = f" ({result.seconds:.1f}s)" if result.seconds else ""
        print(f"{result.status:14} {result.name}{duration}")

    failures = [result for result in results if result.status == "FAIL"]
    skipped = [result for result in results if result.status == "SKIPPED"]
    if failures:
        print(f"VALIDATION RESULT: FAIL ({len(failures)} failed check(s))")
        return 1
    if skipped:
        print(f"VALIDATION RESULT: INCOMPLETE ({len(skipped)} explicitly skipped check(s))")
        return 2
    print("VALIDATION RESULT: PASS (formatter, typecheck, and Python vulnerability audit remain NOT_CONFIGURED, not passed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
