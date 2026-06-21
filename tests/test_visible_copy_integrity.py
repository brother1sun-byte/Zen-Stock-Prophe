from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


MOJIBAKE_COPY_FILES = [
    ROOT / "src" / "App.jsx",
    ROOT / "src" / "components" / "TopCandidateCard.jsx",
    ROOT / "src" / "hooks" / "useDashboardViewModel.js",
    ROOT / "src" / "utils" / "chatGptPrompt.js",
    ROOT / "src" / "utils" / "stockNames.js",
    ROOT / "backend" / "daytrade_autopilot.py",
    ROOT / "backend" / "daytrade_engine.py",
    ROOT / "backend" / "portfolio_api_service.py",
    ROOT / "backend" / "preopen_scoring.py",
    ROOT / "backend" / "server.py",
]

VISIBLE_ENGLISH_COPY_FILES = [
    ROOT / "src" / "App.jsx",
    ROOT / "src" / "components" / "TopCandidateCard.jsx",
    ROOT / "src" / "hooks" / "useDashboardViewModel.js",
    ROOT / "src" / "utils" / "chatGptPrompt.js",
    ROOT / "backend" / "daytrade_autopilot.py",
    ROOT / "backend" / "daytrade_engine.py",
    ROOT / "backend" / "portfolio_api_service.py",
    ROOT / "backend" / "preopen_scoring.py",
    ROOT / "backend" / "server.py",
]


class VisibleCopyIntegrityTests(unittest.TestCase):
    def test_key_visible_copy_files_do_not_contain_mojibake_fragments(self):
        fragments = (
            "\u7e3a",
            "\u7e5d",
            "\u8b5b",
            "\u7b06",
            "\u870a",
            "\u9a6b",
            "\u90e2",
            "\u96b4",
            "\u908a\uff7a",
            "\u90e2\uff67",
            "\u9677",
            "\u9b2f",
            "\u95d5",
            "\u96ce",
            "\u30fb\uff7d",
            "????",
            "\u9706",
        )
        offenders = []
        for path in MOJIBAKE_COPY_FILES:
            text = path.read_text(encoding="utf-8")
            for line_no, line in enumerate(text.splitlines(), 1):
                if any(fragment in line for fragment in fragments):
                    offenders.append(f"{path.relative_to(ROOT)}:{line_no}: {line.strip()[:120]}")
        self.assertEqual([], offenders)

    def test_key_visible_copy_files_do_not_expose_leftover_english_labels(self):
        fragments = (
            "Broker integration is disabled",
            "paper-review evidence",
            "Autopilot is disabled in simulator-only mode",
            "No broker order was sent",
            "Recorded {ticker}",
            "Closed portfolio holding",
            "Toyota Motor",
            "Dexerials Corporation",
            "Kyowa Kirin Co.,Ltd.",
            "Valuation Check After Recent Mixed Share Price Performance",
            "/ RR ",
        )
        offenders = []
        for path in VISIBLE_ENGLISH_COPY_FILES:
            text = path.read_text(encoding="utf-8")
            for line_no, line in enumerate(text.splitlines(), 1):
                if any(fragment in line for fragment in fragments):
                    offenders.append(f"{path.relative_to(ROOT)}:{line_no}: {line.strip()[:120]}")
        self.assertEqual([], offenders)


if __name__ == "__main__":
    unittest.main()
