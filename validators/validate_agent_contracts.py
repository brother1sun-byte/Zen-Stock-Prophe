#!/usr/bin/env python3
"""Validate the repository's AI role and eval contracts deterministically."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROLE_FILES = {
    "architect": ROOT / "agents" / "architect" / "ROLE.md",
    "builder": ROOT / "agents" / "builder" / "ROLE.md",
    "reviewer": ROOT / "agents" / "reviewer" / "ROLE.md",
    "qa": ROOT / "agents" / "qa" / "ROLE.md",
    "release-manager": ROOT / "agents" / "release-manager" / "ROLE.md",
}
EVAL_FILE = ROOT / "agents" / "evals" / "workflow-cases.json"


def add_failure(failures: list[str], condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def validate_roles(failures: list[str]) -> None:
    universal = {
        "architect": ["Goal", "Current State", "Implementation Plan", "Acceptance Criteria", "HUMAN_APPROVAL_REQUIRED"],
        "builder": ["Files Changed", "Validation Commands and Results", "never self-approves", "BLOCKED"],
        "reviewer": ["CRITICAL", "HIGH", "APPROVED", "CHANGES_REQUIRED", "git diff"],
        "qa": ["PASS", "FAIL", "NOT_CONFIGURED", "temporary SQLite"],
        "release-manager": ["READY_TO_RELEASE", "BLOCKED", "Rollback Strategy", "Reviewer `APPROVED`", "QA `PASS`"],
    }
    for role, path in ROLE_FILES.items():
        add_failure(failures, path.is_file(), f"missing role contract: {path.relative_to(ROOT)}")
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for term in universal[role]:
            add_failure(
                failures,
                term in text,
                f"{path.relative_to(ROOT)} is missing required contract term: {term}",
            )

    team_path = ROOT / "agents" / "README.md"
    add_failure(failures, team_path.is_file(), "missing agents/README.md")
    if team_path.is_file():
        team_text = team_path.read_text(encoding="utf-8")
        for term in ["three cycles", "HUMAN_APPROVAL_REQUIRED", "Builder cannot self-approve", "NOT_CONFIGURED"]:
            add_failure(failures, term in team_text, f"agents/README.md is missing workflow term: {term}")


def validate_evals(failures: list[str]) -> None:
    add_failure(failures, EVAL_FILE.is_file(), "missing agents/evals/workflow-cases.json")
    if not EVAL_FILE.is_file():
        return
    try:
        payload = json.loads(EVAL_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        failures.append(f"invalid workflow eval JSON: {exc}")
        return

    cases = payload.get("cases")
    add_failure(failures, isinstance(cases, list) and bool(cases), "workflow evals require a non-empty cases list")
    if not isinstance(cases, list):
        return

    required = {"id", "category", "input", "pass_criteria"}
    allowed_categories = {"control", "regression", "boundary"}
    ids: list[str] = []
    categories: set[str] = set()
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            failures.append(f"eval case {index} must be an object")
            continue
        missing = sorted(required - set(case))
        add_failure(failures, not missing, f"eval case {index} missing fields: {', '.join(missing)}")
        case_id = case.get("id")
        category = case.get("category")
        add_failure(failures, isinstance(case_id, str) and bool(case_id.strip()), f"eval case {index} has invalid id")
        add_failure(failures, category in allowed_categories, f"eval case {case_id or index} has invalid category")
        for field in ["input", "pass_criteria"]:
            value = case.get(field)
            add_failure(failures, isinstance(value, str) and bool(value.strip()), f"eval case {case_id or index} has invalid {field}")
        if isinstance(case_id, str):
            ids.append(case_id)
        if category in allowed_categories:
            categories.add(category)

    add_failure(failures, len(ids) == len(set(ids)), "workflow eval case ids must be unique")
    add_failure(failures, categories == allowed_categories, "workflow evals must include control, regression, and boundary cases")


def main() -> int:
    failures: list[str] = []
    validate_roles(failures)
    validate_evals(failures)
    if failures:
        print("AGENT CONTRACT VALIDATION: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"AGENT CONTRACT VALIDATION: PASS ({len(ROLE_FILES)} roles, eval categories complete)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
