from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
API_PORT = os.environ.get("ZEN_API_PORT", "8889")
API_HOST = os.environ.get("ZEN_API_HOST", "127.0.0.1")
WEB_URL = "http://localhost:5174/"


def popen(command: list[str]) -> subprocess.Popen:
    return subprocess.Popen(
        command,
        cwd=ROOT,
        creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0,
    )


def npm_command() -> str:
    return shutil.which("npm.cmd") or shutil.which("npm") or "npm"


def main() -> int:
    print("Zen Stock Prophet Pro")
    print("Starting local-only retail safety mode dashboard...")

    backend_env = os.environ.copy()
    backend_env["ZEN_API_PORT"] = API_PORT
    backend_env["ZEN_API_HOST"] = API_HOST

    backend = subprocess.Popen(
        [sys.executable, str(ROOT / "backend" / "server.py")],
        cwd=ROOT,
        env=backend_env,
        creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0,
    )
    time.sleep(4)

    frontend = popen([npm_command(), "run", "dev"])
    time.sleep(4)

    webbrowser.open(WEB_URL)

    print("Dashboard:", WEB_URL)
    print("Live broker orders are disabled.")
    print("Close this window only after stopping the app.")

    try:
        while True:
            if backend.poll() is not None:
                print("Backend stopped.")
                return backend.returncode or 1
            if frontend.poll() is not None:
                print("Frontend stopped.")
                return frontend.returncode or 1
            time.sleep(2)
    except KeyboardInterrupt:
        backend.terminate()
        frontend.terminate()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
