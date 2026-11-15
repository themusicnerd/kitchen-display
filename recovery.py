"""Queue a fixed, local-only appliance restart outside the server's own unit."""
import secrets
import shutil
import subprocess
import threading
import time

GENERATION = secrets.token_hex(16)
LOCK = threading.Lock()
PENDING_UNTIL = 0
SERVICES = ('kitchen-cameras.service', 'kitchen-display.service', 'kitchen-display-browser.service')


class RecoveryError(Exception):
    pass


def schedule_restart():
    global PENDING_UNTIL
    with LOCK:
        if time.monotonic() < PENDING_UNTIL:
            return {'ok': True, 'generation': GENERATION, 'delaySeconds': 3}
        runner, control = shutil.which('systemd-run'), shutil.which('systemctl')
        if not runner or not control:
            raise RecoveryError('Restart needs the installed systemd user services.')
        command = [runner, '--user', '--quiet', '--collect',
                   '--unit=kitchen-display-recovery-'+secrets.token_hex(4),
                   '--on-active=3s', '--timer-property=RemainAfterElapse=no',
                   control, '--user', 'restart', *SERVICES]
        try:
            subprocess.run(command, check=True, capture_output=True, text=True, timeout=8)
        except (OSError, subprocess.SubprocessError):
            raise RecoveryError('Could not queue the restart. Check the systemd user services.') from None
        PENDING_UNTIL = time.monotonic()+30
        return {'ok': True, 'generation': GENERATION, 'delaySeconds': 3}
