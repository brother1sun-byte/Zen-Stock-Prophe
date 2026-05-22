"""Build the daily Zen Stock Prophet Pro Gmail digest."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API = "http://127.0.0.1:8889/api/alerts/daily-digest"
DEFAULT_OUT_DIR = ROOT / "backend" / "alerts"


def fetch_from_api(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def build_locally() -> dict:
    sys.path.insert(0, str(ROOT / "backend"))
    import server  # noqa: WPS433
    from daily_digest import build_daily_digest  # noqa: WPS433

    return build_daily_digest(server.STOCKS, server.get_stock_data, server.TechnicalAnalyzer)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the morning investment digest.")
    parser.add_argument("--api", default=DEFAULT_API, help="Local digest API endpoint.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Directory for digest artifacts.")
    parser.add_argument("--local-only", action="store_true", help="Skip API and import backend directly.")
    args = parser.parse_args()

    try:
        digest = build_locally() if args.local_only else fetch_from_api(args.api)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        digest = build_locally()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "latest_morning_digest.json"
    email_path = out_dir / "latest_morning_digest_email.txt"
    json_path.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")
    email_path.write_text(digest["email"]["body"], encoding="utf-8")

    print(f"status={digest['status']}")
    print(f"alerts={len(digest['alerts'])}")
    print(f"news_groups={len(digest['news'])}")
    print(f"json={json_path}")
    print(f"email={email_path}")
    print(f"subject={digest['email']['subject']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
