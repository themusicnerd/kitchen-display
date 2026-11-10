from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import requests
import server


class CameraHTTPTests(unittest.TestCase):
    def test_local_editing_and_lan_restrictions(self):
        remote = {'value': False}

        class TestHandler(server.Handler):
            def setup(self):
                super().setup()
                if remote['value']:
                    self.client_address = ('192.0.2.10', self.client_address[1])

        with tempfile.TemporaryDirectory() as directory:
            password = Path(directory)/'lan-password'
            password.write_text('test-only-lan-password')
            with patch.object(server, 'ACCESS', password), \
                 patch.object(server.camera_config, 'public', return_value={'revision': 'fixture', 'cameras': []}), \
                 patch.object(server.camera_config, 'save', return_value={'ok': True}) as save:
                http = server.ThreadingHTTPServer(('127.0.0.1', 0), TestHandler)
                worker = threading.Thread(target=http.serve_forever, daemon=True)
                worker.start()
                url = f'http://127.0.0.1:{http.server_port}/api/cameras'
                headers = {'Content-Type': 'application/json', 'X-Kitchen-Request': '1'}
                try:
                    self.assertEqual(requests.get(url, timeout=3).status_code, 200)
                    self.assertEqual(requests.post(url, json={}, timeout=3).status_code, 403)
                    hostile = dict(headers, Origin='https://untrusted.example')
                    self.assertEqual(requests.post(url, json={}, headers=hostile, timeout=3).status_code, 403)
                    self.assertEqual(requests.post(url, json={}, headers=headers, timeout=3).status_code, 200)
                    save.assert_called_once()
                    remote['value'] = True
                    self.assertEqual(requests.get(url, timeout=3).status_code, 401)
                    auth = ('kitchen', 'test-only-lan-password')
                    self.assertEqual(requests.get(url, auth=auth, timeout=3).status_code, 403)
                    self.assertEqual(requests.post(url, json={}, headers=headers, auth=auth, timeout=3).status_code, 403)
                    save.assert_called_once()
                finally:
                    http.shutdown()
                    http.server_close()
                    worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
