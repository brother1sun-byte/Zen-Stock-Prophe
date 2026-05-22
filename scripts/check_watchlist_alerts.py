"""Generate the Zen Stock Prophet Pro watchlist alert packet.

The script prefers the running local API. If the API is not available, it imports
the backend directly and evaluates the same alert engine. It writes a JSON
packet and a plain-text email body that can be consumed by a scheduler or by a
Codex/Gmail automation.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API = "http://127.0.0.1:8889/api/alerts/watchlist"
DEFAULT_OUT_DIR = ROOT / "backend" / "alerts"


def fetch_from_api(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def build_locally() -> dict:
    sys.path.insert(0, str(ROOT / "backend"))
    import server  # noqa: WPS433
    from alert_engine import build_watchlist_alert_report  # noqa: WPS433

    return build_watchlist_alert_report(server.STOCKS, server.get_stock_data, server.TechnicalAnalyzer)


def write_outputs(report: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "latest_watchlist_alert.json"
    email_path = out_dir / "latest_watchlist_email.txt"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    email_path.write_text(report["email"]["body"], encoding="utf-8")
    return json_path, email_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Check watchlist limit-price alerts.")
    parser.add_argument("--api", default=DEFAULT_API, help="Local alert API endpoint.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Directory for alert artifacts.")
    parser.add_argument("--local-only", action="store_true", help="Skip API and import backend directly.")
    args = parser.parse_args()

    try:
        report = build_locally() if args.local_only else fetch_from_api(args.api)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        report = build_locally()

    json_path, email_path = write_outputs(report, Path(args.out_dir))
    print(f"status={report['status']}")
    print(f"alerts={len(report['alerts'])}")
    print(f"json={json_path}")
    print(f"email={email_path}")
    print(f"subject={report['email']['subject']}")
    return 2 if report["alerts"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
