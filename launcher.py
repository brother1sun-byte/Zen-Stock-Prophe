from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
API_PORT = os.environ.get("ZEN_API_PORT", "8889")
API_HOST = os.environ.get("ZEN_API_HOST", "127.0.0.1")
WEB_URL = "http://localhost:5174/"


def _hidden_creationflags() -> int:
    if sys.platform != "win32":
        return 0
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    return flags


def popen(command: list[str], log_name: str, env: dict[str, str] | None = None) -> subprocess.Popen:
    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / log_name
    log_file = log_path.open("a", encoding="utf-8", errors="replace")
    return subprocess.Popen(
        command,
        cwd=ROOT,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=_hidden_creationflags(),
    )


def npm_command() -> str:
    return shutil.which("npm.cmd") or shutil.which("npm") or "npm"


def main() -> int:
    backend_env = os.environ.copy()
    backend_env["ZEN_API_PORT"] = API_PORT
    backend_env["ZEN_API_HOST"] = API_HOST

    backend = popen(
        [sys.executable, str(ROOT / "backend" / "server.py")],
        "backend.log",
        env=backend_env,
    )
    time.sleep(4)

    frontend = popen([npm_command(), "run", "dev"], "frontend.log")
    time.sleep(4)

    webbrowser.open(WEB_URL)

    try:
        while True:
            if backend.poll() is not None:
                return backend.returncode or 1
            if frontend.poll() is not None:
                return frontend.returncode or 1
            time.sleep(2)
    except KeyboardInterrupt:
        backend.terminate()
        frontend.terminate()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
