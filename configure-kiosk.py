#!/usr/bin/env python3
"""Lock zoom in the dedicated Firefox kiosk profile. Dry-run unless --apply."""
import argparse
import os
from pathlib import Path
import shutil
import sqlite3

START = '// BEGIN KITCHEN DISPLAY ZOOM\n'
END = '// END KITCHEN DISPLAY ZOOM\n'


def configure(profile, apply=False):
    path = profile/'user.js'
    original = path.read_text() if path.exists() else ''
    block = START + (Path(__file__).with_name('kiosk-prefs.js')).read_text() + END
    before, marker, after = original.partition(START)
    if marker:
        _, closing, suffix = after.partition(END)
        if not closing:
            raise ValueError('Unclosed kitchen preference block; leaving the profile unchanged.')
        content = before + block + suffix
    else:
        content = original + ('\n' if original and not original.endswith('\n') else '') + block
    if not apply:
        print('Dry-run: preserve other preferences; lock kiosk zoom and reset saved site zoom.')
        return
    profile.mkdir(parents=True, mode=0o700, exist_ok=True)
    profile.chmod(0o700)
    backup = profile/'user.js.before-kitchen-zoom'
    if path.exists() and not backup.exists():
        shutil.copy2(path, backup)
        backup.chmod(0o600)
    if content != original:
        temporary = path.with_suffix('.tmp')
        fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as handle:
            handle.write(content)
        temporary.replace(path)
    path.chmod(0o600)
    database = profile/'content-prefs.sqlite'
    if database.exists():
        try:
            with sqlite3.connect(database, timeout=2) as connection:
                count = connection.execute("SELECT count(*) FROM prefs WHERE settingID IN (SELECT id FROM settings WHERE name='browser.content.full-zoom')").fetchone()[0]
                if count:
                    snapshot = profile/'content-prefs.before-kitchen-zoom.sqlite'
                    if not snapshot.exists():
                        fd = os.open(snapshot, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                        os.close(fd)
                        with sqlite3.connect(snapshot) as target:
                            connection.backup(target)
                    connection.execute("DELETE FROM prefs WHERE settingID IN (SELECT id FROM settings WHERE name='browser.content.full-zoom')")
                print(f'Reset {count} saved zoom value(s) in the dedicated kiosk profile.')
        except sqlite3.OperationalError:
            print('Zoom preferences installed; saved zoom database is busy. Stop the kiosk and retry to reset it.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    configure(args.profile.expanduser(), args.apply)
