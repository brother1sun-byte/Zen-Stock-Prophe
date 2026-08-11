#!/usr/bin/env python3
"""Validate secret hygiene and product safety invariants without exposing values."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IGNORED_DIRS = {".git", "node_modules", "dist", "build", "test-results", "playwright-report", "__pycache__", ".omx"}
SECRET_FILENAMES = {".env", ".env.local", "id_rsa", "id_ed25519", "credentials.json", "service-account.json"}
PRIVATE_KEY_HEADERS = tuple(
    "-----BEGIN " + key_type + "-----"
    for key_type in ("PRIVATE KEY", "RSA PRIVATE KEY", "OPENSSH PRIVATE KEY", "EC PRIVATE KEY")
)
TEXT_EXTENSIONS = {
    ".c", ".cfg", ".cmd", ".conf", ".css", ".env", ".go", ".html", ".ini", ".java", ".js", ".json",
    ".jsx", ".md", ".ps1", ".py", ".rb", ".rs", ".sh", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
}
TEXT_FILENAMES = {"dockerfile", ".gitignore", ".dockerignore"}
EXACT_PLACEHOLDERS = {
    "test", "fake", "example", "placeholder", "redacted", "changeme", "dummy", "sample", "mock",
    "your_api_key_here", "your_token_here", "your_password_here", "your_secret_here", "replace_me", "replace-me",
}
ENV_REFERENCE_MARKERS = ("${", "{{", "os.environ", "getenv(", "process.env", "import.meta.env", "secrets.", "env.")
SENSITIVE_ASSIGNMENT_PATTERN = re.compile(
    r'''(?ix)
    ["']?
    (?P<name>(?:[A-Z][A-Z0-9_]*_(?:API_KEY|TOKEN|PASSWORD|SECRET)|AUTHORIZATION))
    ["']?\s*(?:=|:)\s*
    (?P<value>"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;#}\]]+)
    ''',
)
BEARER_LITERAL_PATTERN = re.compile(r"(?i)\bBearer\s+(?P<value>[A-Za-z0-9._~+/=-]{12,})")


def normalized_literal(raw: str) -> str:
    value = raw.strip().rstrip(",")
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1].strip()
    return value


def is_allowed_literal(value: str) -> bool:
    lowered = value.strip().lower()
    if not lowered or lowered in {"none", "null", "undefined"}:
        return True
    if lowered in EXACT_PLACEHOLDERS:
        return True
    if any(marker in lowered for marker in ENV_REFERENCE_MARKERS):
        return True
    if value.startswith(("$", 'f"', "f'")) or "{" in value or "}" in value:
        return True
    if set(lowered) <= {"x", "*", "-", "_"}:
        return True
    return False


def looks_real_like(value: str) -> bool:
    lowered = value.lower()
    known_prefix = lowered.startswith(("sk-", "ghp_", "github_pat_", "xox", "aiza", "eyj"))
    mixed = any(char.isalpha() for char in value) and any(char.isdigit() for char in value)
    return known_prefix or (len(value) >= 16 and mixed)


def secret_literal_findings(text: str, path: Path | None = None) -> list[tuple[int, str]]:
    findings: list[tuple[int, str]] = []
    is_test_fixture = path is not None and "tests" in path.parts
    for line_number, line in enumerate(text.splitlines(), 1):
        for match in SENSITIVE_ASSIGNMENT_PATTERN.finditer(line):
            value = normalized_literal(match.group("value"))
            if value.lower().startswith("bearer "):
                value = value[7:].strip()
            real_like = looks_real_like(value)
            if len(value) >= 8 and (real_like or (not is_allowed_literal(value) and not is_test_fixture)):
                findings.append((line_number, f"hardcoded {match.group('name').upper()} literal"))
        for match in BEARER_LITERAL_PATTERN.finditer(line):
            value = normalized_literal(match.group("value"))
            if looks_real_like(value):
                findings.append((line_number, "hardcoded Bearer credential"))
    return findings


def detector_self_test() -> list[str]:
    failures: list[str] = []
    sensitive_name = "SERVICE_" + "API_KEY"
    real_value = "sk-live-" + "A7b9C2d4E6f8G1h3"
    placeholder_sample = sensitive_name + '="' + "place" + "holder" + '"'
    bearer_sample = "Authorization: " + "Bearer " + real_value
    required_real_values = [
        real_value,
        "sk-" + "test-" + "A7b9C2d4E6f8G1h3",
        "sk-live-con" + "test-" + "A7b9C2d4E6f8G1h3",
        "sk-live-sam" + "ple-" + "A7b9C2d4E6f8G1h3",
    ]
    for index, required_value in enumerate(required_real_values, 1):
        sample = sensitive_name + '="' + required_value + '"'
        findings = secret_literal_findings(sample)
        if not findings:
            failures.append(f"secret detector self-test did not detect real-like assignment {index}")
        if any(required_value in kind for _line, kind in findings):
            failures.append(f"secret detector self-test exposed a credential value in finding {index}")
    if secret_literal_findings(placeholder_sample):
        failures.append("secret detector self-test rejected an allowed placeholder")
    bearer_findings = secret_literal_findings(bearer_sample)
    if not bearer_findings:
        failures.append("secret detector self-test did not detect a Bearer literal")
    if any(real_value in kind for _line, kind in bearer_findings):
        failures.append("secret detector self-test exposed a Bearer credential value in finding")
    return failures


def git_paths() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError("git ls-files failed")
    decoded = result.stdout.decode("utf-8", errors="surrogateescape")
    paths = []
    for raw in decoded.split("\0"):
        if not raw:
            continue
        path = Path(raw)
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        paths.append(path)
    return paths


def is_forbidden_secret_file(path: Path) -> bool:
    name = path.name.lower()
    if name in SECRET_FILENAMES:
        return True
    if name.startswith(".env.") and not name.endswith(".example"):
        return True
    if path.suffix.lower() in {".pem", ".p12", ".pfx", ".key"}:
        return True
    return False


def check_ignore(target: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "-q", target],
        cwd=ROOT,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def main() -> int:
    failures: list[str] = detector_self_test()
    try:
        paths = git_paths()
    except RuntimeError as exc:
        print(f"REPOSITORY SAFETY VALIDATION: FAIL ({exc})")
        return 1

    for relative in paths:
        if is_forbidden_secret_file(relative):
            failures.append(f"secret-like file is tracked or staged for addition: {relative}")
            continue
        full_path = ROOT / relative
        if not full_path.is_file():
            continue
        try:
            is_known_text = relative.suffix.lower() in TEXT_EXTENSIONS or relative.name.lower() in TEXT_FILENAMES
            if full_path.stat().st_size > 2_000_000 and not is_known_text:
                continue
            text = full_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line_number, line in enumerate(text.splitlines(), 1):
            if any(header in line for header in PRIVATE_KEY_HEADERS):
                failures.append(f"{relative}:{line_number}: private-key material")
        for line_number, kind in secret_literal_findings(text, relative):
            failures.append(f"{relative}:{line_number}: {kind}")

    for target in [".env", ".env.local"]:
        if not check_ignore(target):
            failures.append(f"required local secret file is not ignored: {target}")

    server_path = ROOT / "backend" / "server.py"
    try:
        server_text = server_path.read_text(encoding="utf-8")
    except OSError:
        failures.append("backend/server.py is unavailable")
        server_text = ""
    required_server_invariants = {
        "live orders hard-disabled": "LIVE_BROKER_ORDERS_ENABLED = False",
        "manual decision mode exposed": '"mode": "manual_decision_support"',
        "broker-disabled response preserved": '"mode": "BROKER_DISABLED"',
    }
    for label, marker in required_server_invariants.items():
        if marker not in server_text:
            failures.append(f"missing safety invariant: {label}")

    if failures:
        print("REPOSITORY SAFETY VALIDATION: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"REPOSITORY SAFETY VALIDATION: PASS ({len(paths)} tracked/new files checked; secret values not displayed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
