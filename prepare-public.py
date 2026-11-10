#!/usr/bin/env python3
"""Export an explicit source allowlist, never local credentials or deployment data."""
import argparse
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
FILES = [
    'server.py', 'oauth_accounts.py', 'camera_config.py', 'install.py', 'setup-streams.py',
    'start-kiosk.sh', 'kitchen-display.service', 'kitchen-cameras.service',
    'requirements.txt', 'requirements.lock', '.gitignore', 'ACCOUNT_SETUP.md',
    'SECURITY.md', 'NOTICE.md', 'LICENSE', 'prepare-public.py',
    'static/index.html', 'static/settings.html', 'static/style.css', 'static/app.js',
    'static/settings.js', 'static/accounts.js', 'static/night-mode.js',
    'static/icons.js', 'static/hls.min.js', 'static/assets/google-sans-flex.ttf',
    'static/assets/OFL.txt', 'static/assets/LUCIDE-LICENSE.txt',
    'static/assets/paper-texture.png', 'static/assets/PAPER-TEXTURE.md',
    'static/assets/HLS-LICENSE.txt', 'static/assets/GO2RTC-LICENSE.txt',
    'tests/test_calendar.py', 'tests/test_account_settings.py', 'tests/test_oauth.py',
    'tests/test_camera_config.py', 'tests/test_camera_http.py', 'tests/test_night_settings.py',
    'tests/night-mode.cjs', 'tests/settings-browser.cjs', 'tests/test_install.py',
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    destination = args.destination.expanduser().resolve()
    if destination == ROOT or destination.is_relative_to(ROOT):
        parser.error('Export to a separate empty directory outside the working checkout.')
    if destination.exists() and any(destination.iterdir()):
        parser.error('Destination must be empty. Existing exports are never overwritten.')
    # Exported copies can be exported again without carrying personalised local docs.
    readme = 'PUBLIC_README.md' if (ROOT/'PUBLIC_README.md').exists() else 'README.md'
    mapping = {filename: filename for filename in FILES}
    mapping[readme] = 'README.md'
    for source in mapping:
        path = ROOT/source
        if path.is_symlink() or not path.is_file():
            parser.error(f'Missing or unsafe source file: {source}')
    print(f'{len(mapping)} allowlisted files -> {destination}')
    if not args.apply:
        print('Dry-run only. Add --apply to copy source files.')
        return
    destination.mkdir(parents=True, exist_ok=True)
    for source, target in mapping.items():
        path = destination/target
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT/source, path)
    print('Source export complete. Review and secret-scan before publishing.')


if __name__ == '__main__':
    main()
