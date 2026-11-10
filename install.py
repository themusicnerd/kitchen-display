#!/usr/bin/env python3
"""Install user services and dependencies. Dry-run unless --apply is given."""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent
VERSION = '1.9.15'
BUILDS = {
    'x86_64': ('amd64', '20b46c6910734cb05ecefb234066f36868ff19b42ba1418a7a32e13a3e035712'),
    'aarch64': ('arm64', 'af416f22b21a24ab83b8d78642190b4932ae695b4e386853f11d1b0319781763'),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--kiosk', action='store_true', help='Also install Firefox desktop autostart')
    args = parser.parse_args()
    if os.getuid() == 0:
        parser.error('Run as the desktop user, without sudo.')
    if platform.system() != 'Linux' or platform.machine() not in BUILDS:
        parser.error('Supported targets: Linux x86_64 and aarch64 with user systemd.')
    if any(c in str(ROOT) for c in '\n\r%"\\'):
        parser.error('Use a checkout path without quotes, backslashes, percent signs or newlines.')
    print(f'Checkout: {ROOT}\nPrivate state: ~/.config/kitchen-display')
    print('Create venv; install locked Python dependencies; download checksum-verified go2rtc.')
    print('Install/start kitchen-display and kitchen-cameras user services. Existing settings are retained.')
    if args.kiosk:
        print('Also install Firefox kiosk autostart at desktop login.')
    if not args.apply:
        print('Dry-run only. Add --apply to make these changes.')
        return
    subprocess.run([sys.executable, '-m', 'venv', str(ROOT/'.venv')], check=True)
    python = str(ROOT/'.venv/bin/python')
    subprocess.run([python, '-m', 'pip', 'install', '-r', str(ROOT/'requirements.lock')], check=True)
    arch, checksum = BUILDS[platform.machine()]
    binary = ROOT/'bin/go2rtc'
    if not binary.exists() or hashlib.sha256(binary.read_bytes()).hexdigest() != checksum:
        url = f'https://github.com/AlexxIT/go2rtc/releases/download/v{VERSION}/go2rtc_linux_{arch}'
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(32*1024*1024)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise SystemExit('go2rtc checksum mismatch; nothing executed.')
        binary.parent.mkdir(exist_ok=True)
        temporary = binary.with_suffix('.download')
        temporary.write_bytes(data)
        temporary.chmod(0o755)
        temporary.replace(binary)
    # Do not import third-party app dependencies in the bootstrap interpreter.
    subprocess.run([python, '-c', 'import camera_config as c; '
                    'c.write_private(c.BRIDGE,c.bridge_config(c.load())) if not c.BRIDGE.exists() else None'],
                   cwd=ROOT, check=True)
    units = Path.home()/'.config/systemd/user'
    units.mkdir(parents=True, exist_ok=True)
    for name in ('kitchen-display', 'kitchen-cameras'):
        source = (ROOT/(name+'.service')).read_text()
        source = source.replace('WorkingDirectory=%h/kitchen-display', f'WorkingDirectory="{ROOT}"')
        prefix = f'ExecStart="{ROOT}/.venv/bin/python" "{ROOT}/server.py"' if name == 'kitchen-display' else f'ExecStart="{ROOT}/bin/go2rtc"'
        original = 'ExecStart=%h/kitchen-display/.venv/bin/python %h/kitchen-display/server.py' if name == 'kitchen-display' else 'ExecStart=%h/kitchen-display/bin/go2rtc'
        source = source.replace(original, prefix)
        target = units/(name+'.service')
        if target.exists() and target.read_text() != source:
            shutil.copy2(target, target.with_suffix('.service.before-install'))
        target.write_text(source)
    if args.kiosk:
        browser_unit = units/'kitchen-display-browser.service'
        source = (ROOT/'kitchen-display-browser.service').read_text()
        source = source.replace('WorkingDirectory=%h/kitchen-display', f'WorkingDirectory="{ROOT}"')
        source = source.replace('%h/kitchen-display', str(ROOT))
        if browser_unit.exists() and browser_unit.read_text() != source:
            shutil.copy2(browser_unit, browser_unit.with_suffix('.service.before-install'))
        browser_unit.write_text(source)
        autostart = Path.home()/'.config/autostart/kitchen-display.desktop'
        autostart.parent.mkdir(parents=True, exist_ok=True)
        if autostart.exists():
            shutil.copy2(autostart, autostart.with_suffix('.desktop.before-install'))
        autostart.write_text('[Desktop Entry]\nType=Application\nName=Kitchen Display\n'
                             'Exec=systemctl --user start kitchen-display-browser.service\nX-GNOME-Autostart-enabled=true\n')
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'kitchen-cameras.service', 'kitchen-display.service'], check=True)
    subprocess.run(['systemctl', '--user', 'restart', 'kitchen-cameras.service', 'kitchen-display.service'], check=True)
    print('Open http://localhost:8090/settings. No sleep or automatic-login settings were changed.')


if __name__ == '__main__':
    main()
