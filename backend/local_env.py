from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL_ENV_PATH = ROOT / ".env.local"


def load_local_env(path: Path = LOCAL_ENV_PATH) -> list[str]:
    """Load simple KEY=VALUE pairs without adding a runtime dependency."""
    loaded: list[str] = []
    if not path.exists():
        return loaded

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or key in os.environ:
            continue
        os.environ[key] = value
        loaded.append(key)
    return loaded
