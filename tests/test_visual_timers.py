import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import server


class VisualTimerTests(unittest.TestCase):
    def test_public_defaults_do_not_include_family_routines(self):
        self.assertEqual(server.DEFAULT['visualTimers'], [])

    def test_round_trip_and_invalid_timers(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory)/'settings.json'
            config.write_text(json.dumps(copy.deepcopy(server.DEFAULT)))
            timer = {'id': 'example', 'name': 'Example', 'group': 'Activities', 'time': '09:00',
                     'days': [1, 2, 3, 4, 5], 'variant': 'any', 'icon': 'clock', 'enabled': True}
            with patch.object(server, 'CONFIG', config), patch.object(server, 'STATE', {'events': []}):
                old = server.settings()
                server.save_settings(dict(old, revision=server.settings_revision(old), visualTimers=[timer]))
                saved = server.settings()
                self.assertEqual(saved['visualTimers'], [timer])
                for changes in [{'time': '25:00'}, {'days': []}, {'days': [7]}, {'variant': 'unknown'}, {'icon': 'invalid'}]:
                    with self.subTest(changes=changes), self.assertRaises(ValueError):
                        server.save_settings(dict(saved, revision=server.settings_revision(saved), visualTimers=[dict(timer, **changes)]))
                    self.assertEqual(server.settings(), saved)
                server.save_settings(dict(saved, revision=server.settings_revision(saved), visualTimers=[], visualTimersEnabled=False))
                self.assertEqual(server.settings()['visualTimers'], [])
                self.assertFalse(server.settings()['visualTimersEnabled'])
