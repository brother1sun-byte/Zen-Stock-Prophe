#!/usr/bin/env python3
"""Check changed and untracked text for whitespace and merge-conflict artifacts."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IGNORED_PARTS = {".git", "node_modules", "dist", "build", "test-results", "playwright-report", "__pycache__", ".omx"}
CONFLICT_PREFIXES = ("<<<<<<<", "=======", ">>>>>>>")


def git_name_list(arguments: list[str], *, allow_failure: bool = False) -> list[Path]:
    result = subprocess.run(
        ["git", *arguments, "-z"],
        cwd=ROOT,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        if allow_failure:
            return []
        raise RuntimeError(f"git {' '.join(arguments)} failed")
    decoded = result.stdout.decode("utf-8", errors="surrogateescape")
    return [Path(item) for item in decoded.split("\0") if item]


def candidate_paths() -> list[Path]:
    paths: set[Path] = set()
    if os.environ.get("GITHUB_ACTIONS", "").lower() == "true":
        paths.update(git_name_list(["ls-files"]))
    else:
        paths.update(git_name_list(["diff", "--name-only", "--diff-filter=ACMR"]))
        paths.update(git_name_list(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]))
        paths.update(git_name_list(["ls-files", "--others", "--exclude-standard"]))
    return sorted(
        path for path in paths
        if not any(part in IGNORED_PARTS for part in path.parts)
    )


def inspect_text(path: Path) -> list[tuple[int, str]]:
    full_path = ROOT / path
    if not full_path.is_file():
        return []
    try:
        raw = full_path.read_bytes()
    except OSError:
        return []
    if b"\0" in raw:
        return []
    text = raw.decode("utf-8", errors="replace")
    findings: list[tuple[int, str]] = []
    for line_number, line in enumerate(text.splitlines(), 1):
        if line.endswith((" ", "\t")):
            findings.append((line_number, "trailing whitespace"))
        if line.startswith(CONFLICT_PREFIXES):
            findings.append((line_number, "merge-conflict marker"))
    return findings


def main() -> int:
    try:
        paths = candidate_paths()
    except RuntimeError as exc:
        print(f"TEXT HYGIENE VALIDATION: FAIL ({exc})")
        return 1
    failures: list[tuple[Path, int, str]] = []
    for path in paths:
        failures.extend((path, line, kind) for line, kind in inspect_text(path))
    if failures:
        print("TEXT HYGIENE VALIDATION: FAIL")
        for path, line, kind in failures:
            print(f"- {path}:{line}: {kind}")
        return 1
    scope = "all tracked files" if os.environ.get("GITHUB_ACTIONS", "").lower() == "true" else "changed/new text candidates"
    print(f"TEXT HYGIENE VALIDATION: PASS ({len(paths)} {scope} checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
