import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import camera_config as cameras


class CameraTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for key, value in [('PRIVATE', root), ('CAMERAS', root/'cameras.json'), ('BRIDGE', root/'go2rtc.yaml')]:
            patcher = patch.object(cameras, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.camera = {'id': 'example', 'name': 'Front', 'host': 'camera.local', 'username': 'viewer',
                       'password': 'test-only:p@ss', 'path': '/Streaming/Channels/102', 'port': 554, 'enabled': True}
        cameras.write_private(cameras.CAMERAS, [self.camera])
        cameras.write_private(cameras.BRIDGE, cameras.bridge_config([self.camera]))

    def test_password_redacted_preserved_and_cleared(self):
        public = cameras.public()
        self.assertNotIn('password', public['cameras'][0])
        self.assertTrue(public['cameras'][0]['hasPassword'])
        public['cameras'][0].update(name='Patio', password='')
        with patch.object(cameras, 'restart_bridge') as restart:
            cameras.save(public)
            restart.assert_called_once()
            self.assertEqual(cameras.load()[0]['password'], self.camera['password'])
            with self.assertRaises(cameras.CameraConflict):
                cameras.save(public)
            public = cameras.public()
            public['cameras'][0]['clearPassword'] = True
            cameras.save(public)
            self.assertEqual(cameras.load()[0]['password'], '')
        self.assertEqual(cameras.CAMERAS.stat().st_mode & 0o777, 0o600)
        self.assertEqual(cameras.PRIVATE.stat().st_mode & 0o777, 0o700)

    def test_bridge_validation_and_disabled(self):
        bridge = cameras.bridge_config([self.camera])
        self.assertIn('test-only%3Ap%40ss', bridge['streams']['example'])
        self.assertEqual(bridge['api']['listen'], '127.0.0.1:1984')
        self.assertEqual(cameras.bridge_config([dict(self.camera, enabled=False)])['streams'], {})
        for changes in [{'host': 'http://camera.local'}, {'path': '/foo#exec=bad'}, {'port': 0}, {'id': 'invalid/id'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                cameras.validate([dict(self.camera, **changes)], [])
        with self.assertRaises(ValueError):
            cameras.validate([self.camera, self.camera], [])

    def test_restart_failure_rolls_back_and_query_path_is_not_public(self):
        old = cameras.load()
        with patch.object(cameras, 'restart_bridge', side_effect=subprocess.CalledProcessError(1, 'systemctl')):
            public = cameras.public()
            public['cameras'][0]['host'] = 'changed.local'
            with self.assertRaises(ValueError):
                cameras.save(public)
        self.assertEqual(cameras.load(), old)
        cameras.write_private(cameras.CAMERAS, [dict(self.camera, path='/stream?token=test-secret')])
        public = cameras.public()
        self.assertEqual(public['cameras'][0]['path'], '')
        validated = cameras.validate(public['cameras'], cameras.load())
        self.assertEqual(validated[0]['path'], '/stream?token=test-secret')


if __name__ == '__main__':
    unittest.main()
