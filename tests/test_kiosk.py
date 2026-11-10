import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('kiosk', Path(__file__).resolve().parents[1]/'configure-kiosk.py')
kiosk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kiosk)


class KioskTests(unittest.TestCase):
    def test_dry_run_idempotence_and_zoom_only_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory)/'profile'
            kiosk.configure(profile)
            self.assertFalse(profile.exists())
            profile.mkdir()
            (profile/'user.js').write_text('user_pref("example.custom", true);\n')
            with sqlite3.connect(profile/'content-prefs.sqlite') as connection:
                connection.executescript("CREATE TABLE settings(id INTEGER, name TEXT); CREATE TABLE prefs(settingID INTEGER, value REAL); INSERT INTO settings VALUES(1,'browser.content.full-zoom'),(2,'other.preference'); INSERT INTO prefs VALUES(1,1.5),(2,42);")
            kiosk.configure(profile, True)
            first = (profile/'user.js').read_text()
            self.assertIn('example.custom', first)
            self.assertIn('"zoom.maxPercent", 100', first)
            kiosk.configure(profile, True)
            self.assertEqual(first, (profile/'user.js').read_text())
            with sqlite3.connect(profile/'content-prefs.sqlite') as connection:
                self.assertEqual(connection.execute('SELECT * FROM prefs').fetchall(), [(2, 42.0)])
            self.assertTrue((profile/'content-prefs.before-kitchen-zoom.sqlite').exists())
            self.assertEqual((profile/'user.js').stat().st_mode & 0o777, 0o600)
