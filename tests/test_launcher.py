import tempfile
import unittest
from pathlib import Path

import launcher


class LauncherTests(unittest.TestCase):
    def test_rotate_log_keeps_bounded_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backend.log"
            path.write_text("x" * 20, encoding="utf-8")
            launcher.rotate_log(path, max_bytes=10, backups=2)
            self.assertFalse(path.exists())
            self.assertTrue((Path(directory) / "backend.log.1").exists())

    def test_port_probe_fails_closed_for_unused_port(self):
        self.assertFalse(launcher.port_is_open("127.0.0.1", 1, timeout=0.01))


if __name__ == "__main__":
    unittest.main()
