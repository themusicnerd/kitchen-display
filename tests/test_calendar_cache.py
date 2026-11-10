import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import server


class CalendarCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for key, value in [('CONFIG', root/'settings.json'), ('CACHE', root/'cache.json'),
                           ('SOURCE_CACHE', {}), ('STATE', {'events': [], 'sources': [], 'updated': None})]:
            p = patch.object(server, key, value)
            p.start()
            self.addCleanup(p.stop)
        self.conf = copy.deepcopy(server.DEFAULT)
        self.source = {'id': 'test', 'name': 'Calendar', 'color': '#d99a62', 'enabled': True,
                       'accountId': 'account', 'calendarId': 'calendar', 'url': '', 'provider': 'google'}
        self.conf['calendars'] = [self.source]
        server.private_json(server.CONFIG, self.conf)
        self.event = {'sourceId': 'test', 'source': 'Old name', 'color': '#ffffff', 'title': 'Fixture',
                      'isPrivate': False, 'allDay': True, 'start': '2026-11-10', 'end': '2026-11-11'}

    def cache(self, events=None, age=0):
        server.SOURCE_CACHE['test'] = (server.source_identity(self.source), events or [self.event], time.time()-age)
        server.persist_calendar_cache(self.conf)
        server.SOURCE_CACHE.clear()

    def test_restart_restores_private_cache_and_privacy_filter(self):
        self.cache([self.event, dict(self.event, isPrivate=True, title='Hidden fixture')])
        server.restore_calendar_cache()
        self.assertEqual(len(server.STATE['events']), 1)
        self.assertEqual(server.STATE['events'][0]['source'], 'Calendar')
        self.assertEqual(server.STATE['sources'][0]['state'], 'offline - cached events')
        self.assertEqual(server.CACHE.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('account:calendar', server.CACHE.read_text())
        self.assertEqual(server.calendar_poll_delay(), 15)

    def test_changed_identity_disabled_removed_and_stale_cache_not_restored(self):
        self.cache()
        for changes in [{'calendarId': 'changed'}, {'enabled': False}]:
            conf = dict(self.conf, calendars=[dict(self.source, **changes)])
            server.private_json(server.CONFIG, conf)
            server.restore_calendar_cache()
            self.assertEqual(server.STATE['events'], [])
        server.private_json(server.CONFIG, self.conf)
        self.cache(age=server.CACHE_MAX_AGE+1)
        server.restore_calendar_cache()
        self.assertEqual(server.STATE['events'], [])

    def test_bad_cache_and_failure_retry(self):
        for invalid in ['not json', '[]', '{"version":1,"sources":[]}']:
            server.CACHE.write_text(invalid)
            server.restore_calendar_cache()
        self.assertEqual(server.STATE['events'], [])
        self.assertEqual(server.calendar_poll_delay(), 300)
        server.STATE['sources'] = [{'state': 'refresh failed'}]
        self.assertEqual(server.calendar_poll_delay(30), 30)
        server.STATE['sources'] = [{'state': 'ready'}]
        self.assertEqual(server.calendar_poll_delay(), 300)

    def test_offline_refresh_reuses_cache(self):
        self.cache()
        server.restore_calendar_cache()
        with patch.object(server.accounts, 'event_window', side_effect=ConnectionError('not logged')):
            server.refresh_calendars()
        self.assertEqual(len(server.STATE['events']), 1)
        self.assertEqual(server.STATE['sources'][0]['state'], 'offline - cached events')

    def test_early_boot_clock_does_not_destroy_future_dated_snapshot(self):
        self.cache(age=-3600)
        original = server.CACHE.read_text()
        server.restore_calendar_cache()
        self.assertEqual(server.STATE['events'], [])
        server.persist_calendar_cache(self.conf)
        self.assertEqual(server.CACHE.read_text(), original)
        with patch.object(server.time, 'time', return_value=time.time()+3601):
            server.restore_calendar_cache()
        self.assertEqual(len(server.STATE['events']), 1)
