from pathlib import Path
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import requests
import cast_support as C
import server


class CastTests(unittest.TestCase):
    def setUp(self):
        self.conf = dict(server.DEFAULT, calendars=[], visualTimers=[])
        self.manager = C.CastManager(lambda: self.conf)

    def launch(self):
        info = SimpleNamespace(uuid='fixture-screen', friendly_name='Test screen', host='192.168.1.50', model_name='Test TV')
        self.manager.devices = {'fixture-screen': info}
        self.manager.last_scan = time.time()
        cast = MagicMock()
        controller = MagicMock()
        controller.launch.side_effect = lambda **kw: kw['callback_function'](True)
        cast.status.app_id = controller.supporting_app_id = 'fixture-app'
        with patch('pychromecast.get_chromecast_from_cast_info', return_value=cast), \
             patch('pychromecast.controllers.dashcast.DashCastController', return_value=controller), \
             patch.object(self.manager, '_origin', return_value='http://192.168.1.2:8090'):
            controller.load_url.side_effect = lambda *a, **kw: [j.update(lastSeen=time.time()) for j in self.manager.jobs.values()]
            job = self.manager.start({'clientId': 'fixture-client', 'deviceId': 'fixture-screen',
                'source': {'kind': 'countdown', 'id': 'timer-one'},
                'timer': {'name': 'Test timer', 'status': 'running', 'remainingMs': 1800000}}, 8090)
        controller.launch.assert_called_once()
        self.assertTrue(controller.launch.call_args.kwargs['force_launch'])
        token = controller.load_url.call_args.args[0].split('#')[1]
        return job, token

    def test_private_options(self):
        for host in ('127.0.0.1', '8.8.8.8', '0.0.0.0', '224.0.0.1'):
            with self.assertRaises(ValueError): C.validate_options({'castKnownHosts': [host]})
        for origin in ('https://example.com', 'http://user:pass@192.168.1.2', 'http://192.168.1.2/path'):
            with self.assertRaises(ValueError): C.validate_options({'castBaseUrl': origin})
        self.assertEqual(C.validate_options({'castBaseUrl': 'http://192.168.1.2:8090/'})['castBaseUrl'], 'http://192.168.1.2:8090')

    def test_single_timer_capability_update_stop(self):
        job, token = self.launch()
        self.assertNotIn(token, repr(self.manager.jobs))
        snapshot = self.manager.receiver(token)
        self.assertEqual(set(snapshot), {'timer', 'theme', 'paperTexture', 'timezone', 'serverNow'})
        self.assertNotIn('calendars', repr(snapshot))
        self.assertIsNone(self.manager.receiver('x'*43))
        with self.assertRaises(C.CastError):
            self.manager.update({'sessionId': job['id'], 'clientId': 'someone-else'})
        self.manager.update({'sessionId': job['id'], 'clientId': 'fixture-client',
            'timer': {'name': 'Paused timer', 'status': 'paused', 'remainingMs': 45000}})
        self.assertEqual(self.manager.receiver(token)['timer']['remainingMs'], 45000)
        self.assertEqual(self.manager.status('someone-else')['sessions'], [])
        self.manager.stop({'sessionId': job['id'], 'clientId': 'fixture-client'})
        self.assertIsNone(self.manager.receiver(token))

    def test_expiry_disable_and_invalid_numbers(self):
        job, token = self.launch()
        self.conf['castEnabled'] = False
        self.assertIsNone(self.manager.receiver(token))
        self.conf['castEnabled'] = True
        self.manager.jobs[job['id']]['expiresAt'] = time.time()-1
        self.assertIsNone(self.manager.receiver(token))
        for value in (float('nan'), float('inf'), -1, True, 100*3600000+1):
            with self.assertRaises(C.CastError):
                C.timer_snapshot(self.conf, {'kind': 'countdown', 'id': 'a'}, {'status': 'running', 'remainingMs': value})

    def test_replacing_screen_revokes_old_link(self):
        _, previous = self.launch()
        _, current = self.launch()
        self.assertIsNone(self.manager.receiver(previous))
        self.assertIsNotNone(self.manager.receiver(current))
        self.assertEqual(len(self.manager.jobs), 1)

    def test_activity_must_be_configured(self):
        with self.assertRaises(C.CastError):
            C.timer_snapshot(self.conf, {'kind': 'activity', 'id': 'missing', 'at': time.time()*1000})

    def test_receiver_does_not_unlock_dashboard(self):
        manager = self.manager
        _, token = self.launch()
        class LANHandler(server.Handler):
            def setup(self):
                super().setup()
                self.client_address = ('192.168.1.50', self.client_address[1])
        with tempfile.TemporaryDirectory() as directory:
            password = Path(directory)/'password'
            password.write_text('test-password')
            with patch.object(server, 'CAST', manager), patch.object(server, 'ACCESS', password):
                http = server.ThreadingHTTPServer(('127.0.0.1', 0), LANHandler)
                worker = threading.Thread(target=http.serve_forever, daemon=True)
                worker.start()
                base = f'http://127.0.0.1:{http.server_port}'
                try:
                    headers = {'Authorization': 'Bearer '+token}
                    self.assertEqual(requests.get(base+'/cast/timer', timeout=3).status_code, 200)
                    self.assertEqual(requests.get(base+'/cast/state', timeout=3).status_code, 410)
                    self.assertEqual(requests.get(base+'/cast/state', headers=headers, timeout=3).status_code, 200)
                    for path in ('/', '/api/settings', '/api/cameras', '/api/events'):
                        self.assertEqual(requests.get(base+path, headers=headers, timeout=3).status_code, 401)
                    self.assertEqual(requests.post(base+'/api/cast/stop', json={}, auth=('kitchen', 'test-password'), timeout=3).status_code, 403)
                finally:
                    http.shutdown()
                    http.server_close()
                    worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
