import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import server


class AccountSettingsTests(unittest.TestCase):
    def test_signed_in_calendar_survives_normal_settings_save_and_disconnect(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'settings.json'
            initial = copy.deepcopy(server.DEFAULT)
            initial['calendars'] = [{'id': 'imported', 'name': 'Family', 'provider': 'google',
                                     'color': '#d99a62', 'enabled': True, 'url': ''}]
            config.write_text(json.dumps(initial))
            account = {'id': 'account1', 'provider': 'google', 'email': 'test@example.com', 'name': 'Test'}
            available = [{'id': 'private-calendar-id', 'name': 'Family', 'color': '#ffffff'}]
            with patch.object(server, 'CONFIG', config), patch.object(server, 'STATE', {'events': []}), \
                 patch.object(server.accounts, 'public_accounts', return_value=[account]), \
                 patch.object(server.accounts, 'available_calendars', return_value=available), \
                 patch.object(server.accounts, 'connected', return_value=True), \
                 patch.object(server.accounts, 'remove_account') as remove:
                server.select_account_calendars({'accountId': 'account1', 'selected': ['private-calendar-id']})
                selected = server.settings()['calendars'][0]
                self.assertEqual(selected['id'], 'imported')
                self.assertEqual(selected['color'], '#d99a62')
                self.assertEqual(selected['accountId'], 'account1')
                public = server.public_settings()
                self.assertTrue(public['calendars'][0]['configured'])
                self.assertNotIn('url', public['calendars'][0])
                public['calendars'][0].update(icon='heart', name='Custom family', color='#d88691')
                # A legacy form cannot disconnect an account by omitting its connection fields.
                public['calendars'][0].update(accountId='', calendarId='')
                server.save_settings(public)
                self.assertEqual(server.settings()['calendars'][0]['calendarId'], 'private-calendar-id')
                self.assertEqual(server.settings()['calendars'][0]['icon'], 'heart')
                self.assertEqual(server.settings()['calendars'][0]['name'], 'Custom family')
                with self.assertRaises(server.SettingsConflict):
                    server.save_settings(public)
                with self.assertRaises(server.SettingsConflict):
                    server.save_settings({})
                server.disconnect_account('account1')
                remove.assert_called_once_with('account1')
                self.assertEqual(server.settings()['calendars'], [])


if __name__ == '__main__':
    unittest.main()
