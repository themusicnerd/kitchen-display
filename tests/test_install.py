from contextlib import redirect_stdout
import hashlib
import io
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import install


class InstallTests(unittest.TestCase):
    def test_dry_run_and_portable_services_keep_existing_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)/'home'
            root = home/'checkout with spaces'
            root.mkdir(parents=True)
            for filename in ('kitchen-display.service', 'kitchen-cameras.service', 'kitchen-display-browser.service'):
                shutil.copy2(install.ROOT/filename, root/filename)
            private = home/'.config/kitchen-display'
            private.mkdir(parents=True)
            (private/'settings.json').write_text('{"title":"Keep me"}')
            binary = root/'bin/go2rtc'
            binary.parent.mkdir()
            binary.write_bytes(b'fixture executable')
            digest = hashlib.sha256(binary.read_bytes()).hexdigest()
            with patch.object(install, 'ROOT', root), patch.object(install.Path, 'home', return_value=home), \
                 patch.object(install.platform, 'system', return_value='Linux'), \
                 patch.object(install.platform, 'machine', return_value='x86_64'), \
                 patch.object(install.os, 'getuid', return_value=1000), \
                 patch.object(install, 'BUILDS', {'x86_64': ('amd64', digest)}), \
                 patch.object(install.subprocess, 'run') as run, redirect_stdout(io.StringIO()):
                with patch('sys.argv', ['install.py']):
                    install.main()
                    run.assert_not_called()
                    self.assertFalse((home/'.config/systemd').exists())
                with patch('sys.argv', ['install.py', '--apply', '--kiosk']):
                    install.main()
                service = (home/'.config/systemd/user/kitchen-display.service').read_text()
                self.assertIn(f'WorkingDirectory="{root}"', service)
                self.assertIn(f'ExecStart="{root}/.venv/bin/python" "{root}/server.py"', service)
                self.assertNotIn('%h/kitchen-display', service)
                self.assertEqual((private/'settings.json').read_text(), '{"title":"Keep me"}')
                self.assertIn('Exec=systemctl --user start kitchen-display-browser.service', (home/'.config/autostart/kitchen-display.desktop').read_text())
                browser_unit = (home/'.config/systemd/user/kitchen-display-browser.service').read_text()
                self.assertIn(f'ExecStart=/bin/bash "{root}/start-kiosk.sh"', browser_unit)
                self.assertFalse(any('sudo' in str(call) for call in run.call_args_list))


if __name__ == '__main__':
    unittest.main()
