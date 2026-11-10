import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import server


class NightSettingsTests(unittest.TestCase):
    def test_night_settings_save_and_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory)/'settings.json'
            config.write_text(json.dumps(copy.deepcopy(server.DEFAULT)))
            with patch.object(server, 'CONFIG', config), patch.object(server, 'STATE', {'events': []}):
                original = server.settings()
                for changes in [{'nightStart': '25:00'}, {'nightEnd': '6:30 PM'}, {'nightStart': '22:00', 'nightEnd': '22:00'}]:
                    payload = dict(original, revision=server.settings_revision(original), **changes)
                    with self.subTest(changes=changes), self.assertRaises(ValueError):
                        server.save_settings(payload)
                    self.assertEqual(server.settings(), original)
                server.save_settings(dict(original, revision=server.settings_revision(original),
                                          nightStart='22:00', nightEnd='18:30', nightBrightness=25))
                saved = server.settings()
                self.assertEqual(saved['nightEnd'], '18:30')
                self.assertEqual(saved['nightBrightness'], 25)
                self.assertTrue(saved['nightEnabled'])
                server.save_settings(dict(saved, revision=server.settings_revision(saved), nightEnabled=False))
                self.assertFalse(server.settings()['nightEnabled'])


if __name__ == '__main__':
    unittest.main()
