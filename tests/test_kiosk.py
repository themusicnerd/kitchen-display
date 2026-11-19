import importlib.util
from pathlib import Path
import sqlite3
import os
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('kiosk', Path(__file__).resolve().parents[1]/'configure-kiosk.py')
kiosk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kiosk)


class KioskTests(unittest.TestCase):
    def test_browser_selection_and_touch_safe_chromium_flags(self):
        script=Path(__file__).resolve().parents[1]/'start-kiosk.sh'
        with tempfile.TemporaryDirectory() as directory:
            env=dict(os.environ,HOME=directory,KITCHEN_BROWSER='chromium',XDG_SESSION_TYPE='wayland')
            result=subprocess.run(['bash',str(script),'--dry-run'],env=env,text=True,capture_output=True,check=True)
            self.assertIn('--disable-pinch',result.stdout);self.assertIn('--ozone-platform=wayland',result.stdout)
            self.assertNotIn('--no-sandbox',result.stdout);self.assertNotIn('--disable-web-security',result.stdout)
            self.assertFalse((Path(directory)/'snap').exists())
            env['KITCHEN_BROWSER']='firefox'
            self.assertIn('firefox --no-remote',subprocess.run(['bash',str(script),'--dry-run'],env=env,text=True,capture_output=True,check=True).stdout)
            env['KITCHEN_BROWSER']='unknown'
            self.assertEqual(subprocess.run(['bash',str(script),'--dry-run'],env=env,capture_output=True).returncode,2)

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
