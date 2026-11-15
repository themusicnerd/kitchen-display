from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import requests
import recovery
import server


class RecoveryTests(unittest.TestCase):
    def test_fixed_detached_command_and_duplicate_protection(self):
        with patch.object(recovery, 'PENDING_UNTIL', 0), \
             patch.object(recovery.shutil, 'which', side_effect=lambda name: '/usr/bin/'+name), \
             patch.object(recovery.subprocess, 'run') as run:
            result = recovery.schedule_restart()
            self.assertEqual(result['generation'], recovery.GENERATION)
            command = run.call_args.args[0]
            self.assertEqual(command[-5:], ['/usr/bin/systemctl', '--user', 'restart', *recovery.SERVICES][-5:])
            self.assertIn('--on-active=3s', command)
            self.assertIn('--timer-property=RemainAfterElapse=no', command)
            self.assertNotIn('sudo', command)
            self.assertEqual(recovery.schedule_restart(), result)
            run.assert_called_once()

    def test_failure_does_not_lock_out_retry(self):
        with patch.object(recovery, 'PENDING_UNTIL', 0), \
             patch.object(recovery.shutil, 'which', return_value='/usr/bin/example'), \
             patch.object(recovery.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'test')):
            with self.assertRaises(recovery.RecoveryError): recovery.schedule_restart()
            self.assertEqual(recovery.PENDING_UNTIL, 0)
        with patch.object(recovery, 'PENDING_UNTIL', 0), patch.object(recovery.shutil, 'which', return_value=None):
            with self.assertRaises(recovery.RecoveryError): recovery.schedule_restart()

    def test_http_confirmation_origin_and_local_only(self):
        remote = {'value': False}
        class TestHandler(server.Handler):
            def setup(self):
                super().setup()
                if remote['value']: self.client_address = ('192.168.1.10', self.client_address[1])
        with tempfile.TemporaryDirectory() as directory:
            password = Path(directory)/'password'; password.write_text('test-password')
            with patch.object(server, 'ACCESS', password), \
                 patch.object(recovery, 'schedule_restart', return_value={'ok': True}) as restart:
                http = server.ThreadingHTTPServer(('127.0.0.1', 0), TestHandler)
                worker = threading.Thread(target=http.serve_forever, daemon=True); worker.start()
                url = f'http://127.0.0.1:{http.server_port}/api/recovery'
                headers = {'Content-Type': 'application/json', 'X-Kitchen-Request': '1'}
                try:
                    self.assertEqual(requests.get(url, timeout=3).json()['generation'], recovery.GENERATION)
                    for body in ({}, {'confirm': False}, {'confirm': 1}, {'confirm': True, 'command': 'reboot'}):
                        self.assertEqual(requests.post(url, headers=headers, json=body, timeout=3).status_code, 400)
                    self.assertEqual(requests.post(url, json={'confirm': True}, timeout=3).status_code, 403)
                    self.assertEqual(requests.post(url, headers=dict(headers, Origin='https://hostile.example'), json={'confirm': True}, timeout=3).status_code, 403)
                    self.assertEqual(requests.post(url, headers=headers, json={'confirm': True}, timeout=3).status_code, 202)
                    restart.assert_called_once()
                    remote['value'] = True
                    self.assertEqual(requests.get(url, timeout=3).status_code, 401)
                    auth = ('kitchen', 'test-password')
                    self.assertEqual(requests.get(url, auth=auth, timeout=3).status_code, 403)
                    self.assertEqual(requests.post(url, headers=headers, auth=auth, json={'confirm': True}, timeout=3).status_code, 403)
                    restart.assert_called_once()
                finally:
                    http.shutdown(); http.server_close(); worker.join(timeout=3)
