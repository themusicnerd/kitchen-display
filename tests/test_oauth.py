from datetime import date
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import oauth_accounts as oauth


class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patches = [patch.object(oauth, 'PRIVATE', self.root),
                        patch.object(oauth, 'APPS', self.root/'apps.json'),
                        patch.object(oauth, 'ACCOUNTS', self.root/'accounts.json'),
                        patch.object(oauth, 'PENDING', {})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def test_pkce_and_browser_state_binding(self):
        oauth.save_apps({'google': {'clientId': 'example-client', 'clientSecret': 'test-secret'}})
        url, nonce = oauth.begin('google', 'person@example.com')
        params = parse_qs(urlsplit(url).query)
        self.assertEqual(params['code_challenge_method'], ['S256'])
        self.assertEqual(params['redirect_uri'], [oauth.redirect_uri('google')])
        self.assertNotIn('test-secret', url)
        state = params['state'][0]
        with self.assertRaises(ValueError):
            oauth.complete('google', {'state': [state], 'code': ['fake']}, 'wrong-browser')
        fake = MagicMock()
        fake.fetch_token.return_value = {'access_token': 'private-access', 'refresh_token': 'private-refresh', 'expires_at': time.time()+3600}
        fake.get.return_value.json.return_value = {'sub': 'user-1', 'email': 'person@example.com'}
        with patch.object(oauth, 'client', return_value=fake):
            account_id = oauth.complete('google', {'state': [state], 'code': ['fake']}, nonce)
        self.assertTrue(oauth.connected(account_id))
        self.assertNotIn('private-access', json.dumps(oauth.public_accounts()))
        self.assertNotIn('test-secret', json.dumps(oauth.public_apps()))
        self.assertEqual((self.root/'accounts.json').stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError):
            oauth.complete('google', {'state': [state], 'code': ['fake']}, nonce)

    def test_expired_state_rejected(self):
        oauth.PENDING['expired'] = {'provider': 'google', 'browser': 'nonce', 'created': time.time()-601}
        with self.assertRaises(ValueError):
            oauth.complete('google', {'state': ['expired']}, 'nonce')

    def test_refresh_retains_refresh_token_and_stays_private(self):
        oauth.save_apps({'microsoft': {'clientId': 'native-client'}})
        oauth.store(oauth.ACCOUNTS, {'a': {'id': 'a', 'provider': 'microsoft', 'email': 'a@example.com', 'name': 'A',
                                        'token': {'access_token': 'old', 'refresh_token': 'rotation-token', 'expires_at': 0}}})
        fake = MagicMock()
        fake.refresh_token.return_value = {'access_token': 'renewed', 'expires_at': time.time()+3600}
        with patch.object(oauth, 'client', return_value=fake):
            self.assertEqual(oauth.access_token('a'), 'renewed')
        self.assertEqual(oauth.load(oauth.ACCOUNTS)['a']['token']['refresh_token'], 'rotation-token')
        self.assertNotIn('rotation-token', json.dumps(oauth.public_accounts()))

    def test_google_pagination_and_all_day_events(self):
        oauth.store(oauth.ACCOUNTS, {'a': {'provider': 'google'}})
        source = {'id': 's', 'accountId': 'a', 'calendarId': 'private@group.calendar.google.com', 'name': 'Family', 'color': '#d99a62'}
        responses = [{'items': [{'id': '1', 'summary': 'Holiday', 'start': {'date': '2026-11-10'}, 'end': {'date': '2026-11-12'}}], 'nextPageToken': 'next'},
                     {'items': [{'id': '2', 'status': 'cancelled'}]}]
        with patch.object(oauth, 'api_get', side_effect=responses) as api:
            events = oauth.event_window(source, date(2026,11,9), date(2026,12,1), ZoneInfo('Australia/Sydney'))
            self.assertEqual(api.call_count, 2)
        self.assertEqual(len(events), 1)
        self.assertTrue(events[0]['allDay'])
        self.assertEqual(events[0]['end'], '2026-11-12')

    def test_microsoft_all_day_timezone(self):
        oauth.store(oauth.ACCOUNTS, {'a': {'provider': 'microsoft'}})
        source = {'id': 's', 'accountId': 'a', 'calendarId': 'cal', 'name': 'Family', 'color': '#d99a62'}
        data = {'value': [{'id': '1', 'subject': 'Holiday', 'isAllDay': True,
                           'start': {'dateTime': '2026-11-09T13:00:00.0000000', 'timeZone': 'UTC'},
                           'end': {'dateTime': '2026-11-10T13:00:00.0000000', 'timeZone': 'UTC'}}]}
        with patch.object(oauth, 'api_get', return_value=data):
            events = oauth.event_window(source, date(2026,11,9), date(2026,12,1), ZoneInfo('Australia/Sydney'))
        self.assertEqual(events[0]['start'], '2026-11-10')
        self.assertEqual(events[0]['end'], '2026-11-11')

    def test_untrusted_api_pagination_host_rejected(self):
        oauth.store(oauth.ACCOUNTS, {'a': {'provider': 'microsoft'}})
        with self.assertRaises(ValueError):
            oauth.api_get('a', 'https://untrusted.example/v1.0/me')

    def test_google_private_events_filtered_before_return(self):
        oauth.store(oauth.ACCOUNTS, {'a': {'provider': 'google'}})
        source = {'id': 's', 'accountId': 'a', 'calendarId': 'cal', 'name': 'Family', 'color': '#d99a62'}
        data = {'items': [{'id': v, 'summary': v, 'visibility': v,
                           'start': {'date': '2026-11-10'}, 'end': {'date': '2026-11-11'}}
                          for v in ('default', 'public', 'private', 'confidential')]}
        args = (source, date(2026,11,9), date(2026,12,1), ZoneInfo('Australia/Sydney'))
        with patch.object(oauth, 'api_get', return_value=data):
            self.assertEqual([e['title'] for e in oauth.event_window(*args)], ['default','public'])
            self.assertEqual(len(oauth.event_window(*args, hide_private=False)),4)

    def test_microsoft_sensitivity_filter(self):
        oauth.store(oauth.ACCOUNTS, {'a': {'provider': 'microsoft'}})
        source = {'id': 's', 'accountId': 'a', 'calendarId': 'cal', 'name': 'Family', 'color': '#d99a62'}
        data = {'value': [{'id': v, 'subject': v, 'sensitivity': v,
                           'start': {'dateTime': '2026-11-10T00:00:00'}, 'end': {'dateTime': '2026-11-10T01:00:00'}}
                          for v in ('normal','personal','private','confidential')]}
        args = (source, date(2026,11,9), date(2026,12,1), ZoneInfo('Australia/Sydney'))
        with patch.object(oauth, 'api_get', return_value=data) as api:
            self.assertEqual([e['title'] for e in oauth.event_window(*args)],['normal','personal'])
            self.assertIn('sensitivity',api.call_args.args[2]['$select'])
            self.assertEqual(len(oauth.event_window(*args, hide_private=False)),4)


if __name__ == '__main__':
    unittest.main()
