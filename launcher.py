from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
API_PORT = os.environ.get("ZEN_API_PORT", "8889")
API_HOST = os.environ.get("ZEN_API_HOST", "127.0.0.1")
WEB_URL = "http://localhost:5174/"
LOG_MAX_BYTES = 2 * 1024 * 1024
LOG_BACKUPS = 3


def _hidden_creationflags() -> int:
    if sys.platform != "win32":
        return 0
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    return flags


def rotate_log(path: Path, max_bytes: int = LOG_MAX_BYTES, backups: int = LOG_BACKUPS) -> None:
    if not path.exists() or path.stat().st_size < max_bytes:
        return
    for index in range(backups, 0, -1):
        source = path if index == 1 else path.with_suffix(f"{path.suffix}.{index - 1}")
        target = path.with_suffix(f"{path.suffix}.{index}")
        if source.exists():
            if target.exists():
                target.unlink()
            source.replace(target)


def port_is_open(host: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_url(url: str, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=1.0) as response:
                if 200 <= response.status < 500:
                    return True
        except OSError:
            time.sleep(0.5)
    return False


def popen(command: list[str], log_name: str, env: dict[str, str] | None = None) -> subprocess.Popen:
    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / log_name
    rotate_log(log_path)
    log_file = log_path.open("a", encoding="utf-8", errors="replace")
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=_hidden_creationflags(),
    )
    log_file.close()
    return process


def stop_processes(*processes: subprocess.Popen | None) -> None:
    for process in processes:
        if process is not None and process.poll() is None:
            process.terminate()
    for process in processes:
        if process is None or process.poll() is not None:
            continue
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def npm_command() -> str:
    return shutil.which("npm.cmd") or shutil.which("npm") or "npm"


def main() -> int:
    backend_env = os.environ.copy()
    backend_env["ZEN_API_PORT"] = API_PORT
    backend_env["ZEN_API_HOST"] = API_HOST

    backend = None
    frontend = None
    if not port_is_open(API_HOST, int(API_PORT)):
        backend = popen([sys.executable, str(ROOT / "backend" / "server.py")], "backend.log", env=backend_env)
    if not wait_for_url(f"http://{API_HOST}:{API_PORT}/api/health"):
        stop_processes(backend)
        return 1

    if not port_is_open("127.0.0.1", 5174):
        frontend = popen([npm_command(), "run", "dev"], "frontend.log")
    if not wait_for_url(WEB_URL):
        stop_processes(frontend, backend)
        return 1

    webbrowser.open(WEB_URL)

    try:
        while True:
            if backend is not None and backend.poll() is not None:
                return backend.returncode or 1
            if frontend is not None and frontend.poll() is not None:
                return frontend.returncode or 1
            time.sleep(2)
    except KeyboardInterrupt:
        return 0
    finally:
        stop_processes(frontend, backend)


if __name__ == "__main__":
    raise SystemExit(main())
