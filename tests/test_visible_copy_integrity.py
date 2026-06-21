from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class VisibleCopyIntegrityTests(unittest.TestCase):
    def test_key_visible_copy_files_do_not_contain_mojibake_fragments(self):
        files = [
            ROOT / "src" / "components" / "TopCandidateCard.jsx",
            ROOT / "src" / "hooks" / "useDashboardViewModel.js",
            ROOT / "backend" / "preopen_scoring.py",
            ROOT / "backend" / "server.py",
        ]
        fragments = (
            "繝",
            "譛",
            "縺",
            "繧",
            "蜃",
            "鬮",
            "荳",
            "豌",
            "�",
            "????",
            "軁E",
        )
        offenders = []
        for path in files:
            text = path.read_text(encoding="utf-8")
            for line_no, line in enumerate(text.splitlines(), 1):
                if any(fragment in line for fragment in fragments):
                    offenders.append(f"{path.relative_to(ROOT)}:{line_no}: {line.strip()[:120]}")
        self.assertEqual([], offenders)


if __name__ == "__main__":
    unittest.main()
