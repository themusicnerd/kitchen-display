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

    def launch(self, kind='countdown'):
        info = SimpleNamespace(uuid='fixture-screen', friendly_name='Test screen', host='192.168.1.50', model_name='Test TV')
        self.manager.devices = {'fixture-screen': info}
        self.manager.last_scan = time.time()
        cast = MagicMock()
        controller = MagicMock()
        controller.is_active = False
        def launch_callback(**kw):
            controller.is_active = True
            cast.status.app_id = 'fixture-app'
            kw['callback_function'](True)
        controller.launch.side_effect = launch_callback
        cast.status.app_id = controller.supporting_app_id = 'fixture-app'
        cast.quit_app.side_effect = lambda **kw: setattr(cast.status, 'app_id', None)
        self.last_cast, self.last_link = cast, MagicMock()
        with patch('pychromecast.get_chromecast_from_cast_info', return_value=cast), \
             patch('pychromecast.controllers.dashcast.DashCastController', return_value=controller), \
             patch.object(self.manager, '_origin', return_value='http://192.168.1.2:8090'), \
             patch.object(C, 'timer_controller', return_value=MagicMock()), \
             patch.object(C, 'LiveCastLink', return_value=self.last_link), \
             patch('zeroconf.Zeroconf'), patch.object(C.time, 'sleep'):
            controller.load_url.side_effect = lambda *a, **kw: [j.update(lastSeen=time.time()) for j in self.manager.jobs.values()]
            stopwatch = kind == 'stopwatch'
            job = self.manager.start({'clientId': 'fixture-client', 'deviceId': 'fixture-screen',
                'source': {'kind': kind, 'id': 'stopwatch' if stopwatch else 'timer-one'},
                'timer': {'name': 'Test timer', 'status': 'running', 'remainingMs': 1800000,
                          'elapsedMs': 65000, 'laps': [10000]}}, 8090)
        controller.launch.assert_called_once()
        self.assertTrue(controller.launch.call_args.kwargs['force_launch'])
        cast.disconnect.assert_not_called()
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
        self.last_link.close.assert_called_once()
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
        old_link = self.last_link
        _, current = self.launch()
        self.assertIsNone(self.manager.receiver(previous))
        self.assertIsNotNone(self.manager.receiver(current))
        self.assertEqual(len(self.manager.jobs), 1)
        old_link.close.assert_called_once()
        self.last_link.close.assert_not_called()

    def test_expiry_releases_sender(self):
        job, _ = self.launch()
        self.manager.jobs[job['id']]['expiresAt'] = time.time()-1
        self.assertEqual(self.manager.status('fixture-client')['sessions'], [])
        self.last_link.close.assert_called_once()

    def test_failed_launch_closes_resolver_and_preserves_previous_link(self):
        old_job, token = self.launch()
        old_link = self.last_link
        resolver = MagicMock()
        with patch('zeroconf.Zeroconf', return_value=resolver), \
             patch('pychromecast.get_chromecast_from_cast_info', side_effect=RuntimeError), \
             patch.object(self.manager, '_origin', return_value='http://192.168.1.2:8090'):
            with self.assertRaises(C.CastError):
                self.manager.start({'clientId': 'fixture-client', 'deviceId': 'fixture-screen',
                    'source': {'kind': 'countdown', 'id': 'another'},
                    'timer': {'name': 'Another timer', 'status': 'running', 'remainingMs': 60000}}, 8090)
        resolver.close.assert_called_once()
        old_link.close.assert_not_called()
        self.assertEqual(list(self.manager.jobs), [old_job['id']])
        self.assertIsNotNone(self.manager.receiver(token))

    def test_sender_heartbeat_and_cleanup_do_not_quit_other_apps(self):
        for allowed, active, sends in ((True, True, 1), (False, True, 0), (True, False, 0)):
            link = object.__new__(C.LiveCastLink)
            link.cast, link.resolver, link.controller = MagicMock(), MagicMock(), MagicMock()
            link.controller.is_active = active
            link.allowed = lambda: allowed
            link.closed = MagicMock()
            link.closed.wait.side_effect = [False, True]
            link._watch()
            self.assertEqual(link.controller.send_message.call_count, sends)
            link.cast.disconnect.assert_called_once_with(timeout=3)
            link.cast.quit_app.assert_not_called()
            link.resolver.close.assert_called_once()

    def test_sender_close_stops_worker(self):
        cast, resolver = MagicMock(), MagicMock()
        link = C.LiveCastLink(cast, resolver, MagicMock(), lambda: True)
        link.close()
        link.worker.join(timeout=1)
        self.assertFalse(link.worker.is_alive())
        cast.disconnect.assert_called_once_with(timeout=3)
        resolver.close.assert_called_once()

    def test_activity_must_be_configured(self):
        with self.assertRaises(C.CastError):
            C.timer_snapshot(self.conf, {'kind': 'activity', 'id': 'missing', 'at': time.time()*1000})

    def test_stopwatch_snapshot_and_validation(self):
        source = {'kind': 'stopwatch', 'id': 'stopwatch'}
        timer = {'status': 'running', 'elapsedMs': 65000, 'laps': [10000, 30000]}
        value = C.timer_snapshot(self.conf, source, timer)
        self.assertEqual(value['kind'], 'stopwatch')
        self.assertEqual(value['elapsedMs'], 65000)
        self.assertAlmostEqual(value['startedAt'], time.time()*1000, delta=100)
        self.assertEqual(value['laps'], [10000, 30000])
        value = C.timer_snapshot(self.conf, source, dict(timer, status='paused'))
        self.assertIsNone(value['startedAt'])
        for change in ({'elapsedMs': -1}, {'elapsedMs': float('inf')}, {'status': 'finished'},
                       {'laps': [70000]}, {'laps': [30000, 10000]}, {'laps': [True]}, {'laps': list(range(101))}):
            with self.assertRaises(C.CastError):
                C.timer_snapshot(self.conf, source, dict(timer, **change))
        self.conf['timeToolsEnabled'] = False
        with self.assertRaises(C.CastError): C.timer_snapshot(self.conf, source, timer)

    def test_stopwatch_session_and_updates(self):
        job, token = self.launch('stopwatch')
        self.assertAlmostEqual(job['expiresAt']-time.time(), 8*86400, delta=3)
        self.assertEqual(self.manager.receiver(token)['timer']['kind'], 'stopwatch')
        self.manager.update({'sessionId': job['id'], 'clientId': 'fixture-client',
            'timer': {'status': 'paused', 'elapsedMs': 70000, 'laps': [10000, 60000]}})
        timer = self.manager.receiver(token)['timer']
        self.assertEqual(timer['elapsedMs'], 70000)
        self.assertIsNone(timer['startedAt'])
        self.assertEqual(timer['laps'], [10000, 60000])
        self.manager.update({'sessionId': job['id'], 'clientId': 'fixture-client',
            'timer': {'status': 'idle', 'elapsedMs': 0, 'laps': []}})
        self.assertEqual(self.manager.receiver(token)['timer']['elapsedMs'], 0)
        self.conf['timeToolsEnabled'] = False
        self.assertIsNone(self.manager.receiver(token))

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
