import unittest
from datetime import date
from zoneinfo import ZoneInfo
from server import expand_events

SOURCE = {'id': 'family', 'name': 'Family', 'color': '#167d8d'}


class CalendarTests(unittest.TestCase):
    def test_recurrence_exception_and_all_day_end(self):
        raw = b'''BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:weekly\r
DTSTART;TZID=Australia/Sydney:20261109T090000\r
DTEND;TZID=Australia/Sydney:20261109T100000\r
RRULE:FREQ=WEEKLY;COUNT=3\r
EXDATE;TZID=Australia/Sydney:20261116T090000\r
SUMMARY:School run\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holiday\r
DTSTART;VALUE=DATE:20261110\r
DTEND;VALUE=DATE:20261112\r
SUMMARY:Holiday\r
END:VEVENT\r
END:VCALENDAR\r
'''
        events = expand_events(raw, SOURCE, date(2026, 11, 9), date(2026, 12, 1), ZoneInfo('Australia/Sydney'))
        weekly = [e for e in events if e['title'] == 'School run']
        self.assertEqual(len(weekly), 2)
        self.assertTrue(all(e['start'].endswith('+11:00') for e in weekly))
        holiday = next(e for e in events if e['title'] == 'Holiday')
        self.assertTrue(holiday['allDay'])
        self.assertEqual(holiday['end'], '2026-11-12')

    def test_cancelled_event_hidden(self):
        raw = b'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:cancel\r\nDTSTART:20261110T000000Z\r\nDTEND:20261110T010000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
        self.assertEqual(expand_events(raw, SOURCE, date(2026, 11, 9), date(2026, 12, 1), ZoneInfo('Australia/Sydney')), [])

    def test_private_and_confidential_feed_events_hidden(self):
        events = ''.join(f'BEGIN:VEVENT\r\nUID:{kind}\r\nDTSTART:20261110T000000Z\r\nDTEND:20261110T010000Z\r\nCLASS:{kind}\r\nSUMMARY:{kind}\r\nEND:VEVENT\r\n'
                         for kind in ('PUBLIC', 'PRIVATE', 'CONFIDENTIAL'))
        raw = ('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+events+'END:VCALENDAR\r\n').encode()
        args = (raw, SOURCE, date(2026,11,9), date(2026,12,1), ZoneInfo('Australia/Sydney'))
        visible = expand_events(*args)
        self.assertEqual([e['title'] for e in visible], ['PUBLIC'])
        self.assertFalse(visible[0]['isPrivate'])
        self.assertEqual(len(expand_events(*args, hide_private=False)), 3)


if __name__ == '__main__':
    unittest.main()
