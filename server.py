#!/usr/bin/env python3
"""Local kitchen calendar and authenticated RTSP/HLS camera proxy."""
import base64
import copy
import hmac
import hashlib
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import secrets
import socket
import threading
import time
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from urllib.parse import urlsplit, parse_qs, urlencode
from zoneinfo import ZoneInfo

import icalendar
import recurring_ical_events
import requests
import oauth_accounts as accounts
import camera_config

ROOT = Path(__file__).resolve().parent
PRIVATE = Path.home() / '.config/kitchen-display'
CONFIG = PRIVATE / 'settings.json'
CAMERA = PRIVATE / 'camera.json'
CAMERAS = PRIVATE / 'cameras.json'
ACCESS = PRIVATE / 'lan-password'
LOCK = threading.RLock()
WAKE = threading.Event()
STATE = {'events': [], 'sources': [], 'updated': None}
SOURCE_CACHE = {}
DEFAULT = {
    'title': 'Our week', 'timezone': 'Australia/Sydney', 'upcomingWeeks': 3,
    'weekHeight': 640, 'cameraHeight': 230, 'fontWeight': 460,
    'theme': 'dark', 'paperTexture': True, 'showCamera': True, 'cameraFit': 'contain', 'hidePrivateEvents': True,
    'nightEnabled': True, 'nightStart': '22:00', 'nightEnd': '06:30', 'nightBrightness': 25,
    'calendars': []
}
CALENDAR_ICONS = {'calendar-days', 'user-round', 'users-round', 'briefcase-business', 'house',
                  'graduation-cap', 'heart', 'stethoscope', 'party-popper', 'plane', 'dumbbell',
                  'music', 'utensils', 'car', 'baby', 'clapperboard', 'wrench', 'sun'}


class SettingsConflict(ValueError):
    pass


def private_json(path, data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(data, handle, indent=2)
    os.replace(temporary, path)


def settings():
    with LOCK:
        conf = {**copy.deepcopy(DEFAULT), **json.loads(CONFIG.read_text())}
        for source in conf['calendars']:
            source.setdefault('icon', 'calendar-days')
        return conf


def settings_revision(conf):
    return hashlib.sha256(json.dumps(conf, sort_keys=True).encode()).hexdigest()


def public_settings():
    conf = settings()
    conf['revision'] = settings_revision(conf)
    account_labels = {a['id']: a['email'] or a['name'] for a in accounts.public_accounts()}
    for source in conf['calendars']:
        source['configured'] = bool(source.pop('url', '')) or source.get('accountId') in account_labels
        if source.get('accountId'):
            source['accountLabel'] = account_labels.get(source['accountId'], 'Account disconnected')
    conf['cameras'] = public_cameras()
    return conf


def public_cameras():
    with camera_config.LOCK:
        return [{'id': c['id'], 'name': c['name']} for c in camera_config.load() if c['enabled']]


def check_feed_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Calendar feeds must use an HTTPS URL without a username or password.')
    if parsed.port not in (None, 443):
        raise ValueError('Calendar feeds must use HTTPS port 443.')
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Calendar feeds must be hosted on a public calendar service.')
    return value


def fetch_feed(url):
    # Validate each redirect before requesting it, including the initial URL.
    for _ in range(5):
        check_feed_url(url)
        with requests.get(url, timeout=(8, 20), allow_redirects=False, stream=True) as response:
            if response.is_redirect:
                from urllib.parse import urljoin
                url = urljoin(url, response.headers['Location'])
                continue
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_content(65536):
                content.extend(chunk)
                if len(content) > 8 * 1024 * 1024:
                    raise ValueError('Calendar feed exceeds 8 MB.')
            return bytes(content)
    raise ValueError('Too many calendar feed redirects.')


def expand_events(raw, source, first, last, timezone, hide_private=True):
    calendar = icalendar.Calendar.from_ical(raw)
    result = []
    for event in recurring_ical_events.of(calendar).between(first, last):
        if str(event.get('STATUS', '')).upper() == 'CANCELLED':
            continue
        private = str(event.get('CLASS', '')).upper() in ('PRIVATE', 'CONFIDENTIAL')
        if hide_private and private:
            continue
        start = event.decoded('DTSTART')
        end = event.decoded('DTEND')
        all_day = not isinstance(start, datetime)
        if not all_day:
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone)
        result.append({
            'id': str(event.get('UID', '')) + ':' + start.isoformat(),
            'sourceId': source['id'], 'source': source['name'], 'color': source['color'],
            'title': str(event.get('SUMMARY', 'Busy')), 'location': str(event.get('LOCATION', '')),
            'start': start.isoformat(), 'end': end.isoformat(), 'allDay': all_day, 'isPrivate': private,
        })
        if len(result) > 5000:
            raise ValueError('Too many events in this calendar window.')
    return result


def refresh_calendars():
    conf = settings()
    tz = ZoneInfo(conf['timezone'])
    today = datetime.now(tz).date()
    first = today - timedelta(days=today.weekday())
    last = first + timedelta(weeks=27)
    events, statuses = [], []
    for source in conf['calendars']:
        if not source['enabled']:
            continue
        status = {'id': source['id'], 'name': source['name'], 'state': 'ready'}
        identity = source.get('url') or (source.get('accountId', '') + ':' + source.get('calendarId', ''))
        try:
            if source.get('accountId'):
                items = accounts.event_window(source, first, last, tz, hide_private=conf['hidePrivateEvents'])
                SOURCE_CACHE[source['id']] = (identity, items, time.time())
                events.extend(items)
            elif not source['url']:
                status['state'] = 'not connected'
            else:
                items = expand_events(fetch_feed(source['url']), source, first, last, tz, hide_private=conf['hidePrivateEvents'])
                SOURCE_CACHE[source['id']] = (identity, items, time.time())
                events.extend(items)
        except Exception:
            # Do not log exception strings: provider errors may contain secret feed URLs.
            status['state'] = 'refresh failed'
            cached = SOURCE_CACHE.get(source['id'])
            if cached and cached[0] == identity:
                events.extend([{**item, 'source': source['name'], 'color': source['color']} for item in cached[1]])
                status['state'] = 'offline - cached events'
                status['lastSuccess'] = cached[2]
        statuses.append(status)
    with LOCK:
        current = settings()
        active = {s['id']: s for s in current['calendars'] if s['enabled']}
        previous = {s['id']: s for s in conf['calendars']}
        valid = {key for key, source in active.items() if key in previous and
                 all(source.get(field) == previous[key].get(field) for field in ('accountId', 'calendarId', 'url'))}
        events = [{**e, 'source': active[e['sourceId']]['name'], 'color': active[e['sourceId']]['color']}
                  for e in events if e['sourceId'] in valid and not (current['hidePrivateEvents'] and e.get('isPrivate'))]
        STATE.update(events=events, sources=[s for s in statuses if s['id'] in valid], updated=time.time())


def calendar_worker():
    while True:
        WAKE.clear()
        try:
            refresh_calendars()
        except Exception:
            logging.error('Calendar refresh failed; previous data retained.')
        WAKE.wait(300)


def save_settings(data):
    old = settings()
    if data.get('revision') != settings_revision(old):
        raise SettingsConflict('Settings changed elsewhere. Reload this page before saving.')
    conf = {key: data.get(key, old[key]) for key in DEFAULT}
    conf['title'] = str(conf['title']).strip()[:60]
    ZoneInfo(conf['timezone'])
    for key, low, high in [('upcomingWeeks', 1, 4), ('weekHeight', 380, 1000), ('cameraHeight', 140, 480), ('fontWeight', 300, 700)]:
        conf[key] = max(low, min(high, int(conf[key])))
    if conf['theme'] not in ('light', 'dark') or conf['cameraFit'] not in ('contain', 'cover'):
        raise ValueError('Invalid display option.')
    conf['showCamera'] = bool(conf['showCamera'])
    conf['paperTexture'] = bool(conf['paperTexture'])
    conf['hidePrivateEvents'] = bool(conf['hidePrivateEvents'])
    conf['nightEnabled'] = bool(conf['nightEnabled'])
    conf['nightBrightness'] = max(5, min(100, int(conf['nightBrightness'])))
    for key in ('nightStart', 'nightEnd'):
        if not isinstance(conf[key], str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', conf[key]):
            raise ValueError('Night mode needs valid start and end times.')
    if conf['nightEnabled'] and conf['nightStart'] == conf['nightEnd']:
        raise ValueError('Night mode start and end must differ.')
    existing = {s['id']: s for s in old['calendars']}
    sources, ids = [], set()
    if len(conf['calendars']) > 20:
        raise ValueError('Maximum 20 calendars.')
    for item in conf['calendars']:
        source_id = str(item.get('id', secrets.token_hex(8)))
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', source_id) or source_id in ids:
            raise ValueError('Invalid or duplicate calendar ID.')
        ids.add(source_id)
        url = str(item.get('url', '')).strip()
        if not url and item.get('configured'):
            url = existing.get(source_id, {}).get('url', '')
        if url:
            check_feed_url(url)
        color = item.get('color', '#167d8d')
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            raise ValueError('Invalid calendar colour.')
        provider = item.get('provider', existing.get(source_id, {}).get('provider', 'ical'))
        if provider not in ('ical', 'google', 'microsoft'):
            raise ValueError('Invalid calendar provider.')
        sources.append({'id': source_id, 'name': str(item.get('name', 'Calendar'))[:60],
                        'color': color, 'url': url, 'enabled': bool(item.get('enabled', True)),
                        'provider': provider})
        icon = str(item.get('icon', existing.get(source_id, {}).get('icon', 'calendar-days')))
        if icon not in CALENDAR_ICONS:
            raise ValueError('Invalid calendar icon.')
        sources[-1]['icon'] = icon
        account_id = item.get('accountId') or existing.get(source_id, {}).get('accountId')
        calendar_id = item.get('calendarId') or existing.get(source_id, {}).get('calendarId')
        if account_id:
            if not accounts.connected(account_id) or not calendar_id or len(str(calendar_id)) > 4096:
                raise ValueError('Account is not connected.')
            sources[-1].update(accountId=account_id, calendarId=str(calendar_id), url='')
    conf['calendars'] = sources
    with LOCK:
        if data['revision'] != settings_revision(settings()):
            raise SettingsConflict('Settings changed elsewhere. Reload this page before saving.')
        private_json(CONFIG, conf)
        # Removed calendars must disappear immediately, including during network failures.
        STATE['events'] = [e for e in STATE['events'] if e['sourceId'] in ids and not (conf['hidePrivateEvents'] and e.get('isPrivate'))]
    WAKE.set()


def select_account_calendars(data):
    import hashlib
    account_id = data['accountId']
    account = next(a for a in accounts.public_accounts() if a['id'] == account_id)
    available = {c['id']: c for c in accounts.available_calendars(account_id)}
    selected = set(data['selected'])
    if not selected.issubset(available):
        raise ValueError('Unknown calendar selection')
    with LOCK:
        conf = settings()
        existing = {s.get('calendarId'): s for s in conf['calendars'] if s.get('accountId') == account_id}
        sources = [s for s in conf['calendars'] if s.get('accountId') != account_id]
        for calendar_id in sorted(selected):
            calendar = available[calendar_id]
            previous = existing.get(calendar_id)
            if not previous:
                # Match a single unconnected DAKboard entry, preserving its chosen colour.
                previous = next((s for s in sources if not s.get('accountId') and not s.get('url')
                                 and s.get('provider') == account['provider']
                                 and s['name'].casefold() == calendar['name'].casefold()), None)
                if previous:
                    sources.remove(previous)
            color = (previous or {}).get('color') or calendar['color']
            if not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
                color = '#d99a62'
            sources.append({'id': (previous or {}).get('id') or 'oauth-' + hashlib.sha256((account_id+':'+calendar_id).encode()).hexdigest()[:20],
                            'name': (previous or {}).get('name') or calendar['name'], 'color': color,
                            'url': '', 'provider': account['provider'], 'enabled': True,
                            'accountId': account_id, 'calendarId': calendar_id,
                            'icon': (previous or {}).get('icon', 'calendar-days')})
        if len(sources) > 20:
            raise ValueError('Maximum 20 calendars.')
        conf['calendars'] = sources
        private_json(CONFIG, conf)
        active = {s['id'] for s in sources}
        STATE['events'] = [e for e in STATE['events'] if e['sourceId'] in active]
    WAKE.set()


def disconnect_account(account_id):
    accounts.remove_account(account_id)
    with LOCK:
        conf = settings()
        conf['calendars'] = [c for c in conf['calendars'] if c.get('accountId') != account_id]
        private_json(CONFIG, conf)
        active = {s['id'] for s in conf['calendars']}
        STATE['events'] = [e for e in STATE['events'] if e['sourceId'] in active]
    WAKE.set()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def allowed(self):
        if ipaddress.ip_address(self.client_address[0]).is_loopback:
            return True
        expected = 'Basic ' + base64.b64encode(('kitchen:' + ACCESS.read_text().strip()).encode()).decode()
        if hmac.compare_digest(self.headers.get('Authorization', ''), expected):
            return True
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="Kitchen display", charset="UTF-8"')
        self.end_headers()
        return False

    def send(self, body, kind='application/json', status=200, headers=None):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.allowed():
            return
        path = urlsplit(self.path).path
        if path.startswith('/auth/') and path.endswith('/callback'):
            provider = path.split('/')[2]
            if provider not in accounts.PROVIDERS or not ipaddress.ip_address(self.client_address[0]).is_loopback:
                return self.send({'error': 'Invalid callback'}, status=400)
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            cookie = cookies.get('kitchen_oauth_' + provider)
            try:
                accounts.complete(provider, parse_qs(urlsplit(self.path).query), cookie.value if cookie else '')
                destination = '/settings?auth=connected'
            except Exception:
                destination = '/settings?auth=failed'
            return self.send(b'', status=303, headers={'Location': destination,
                              'Set-Cookie': f'kitchen_oauth_{provider}=; Path=/auth/; HttpOnly; SameSite=Lax; Max-Age=0'})
        if path == '/api/oauth/config':
            return self.send(accounts.public_apps())
        if path == '/api/accounts':
            return self.send(accounts.public_accounts())
        if path == '/api/accounts/calendars':
            try:
                account_id = parse_qs(urlsplit(self.path).query).get('id', [''])[0]
                return self.send(accounts.available_calendars(account_id))
            except Exception:
                return self.send({'error': 'Unable to list calendars. Reconnect the account or check its permissions.'}, status=400)
        if path == '/api/settings':
            return self.send(public_settings())
        if path == '/api/cameras':
            if not ipaddress.ip_address(self.client_address[0]).is_loopback:
                return self.send({'error': 'Edit camera connections on this display at http://localhost:8090/settings.'}, status=403)
            return self.send(camera_config.public())
        if path == '/api/events':
            with LOCK:
                events = STATE['events']
                if settings()['hidePrivateEvents']:
                    events = [e for e in events if not e.get('isPrivate')]
                return self.send({**STATE, 'events': events})
        if path == '/api/status':
            return self.send({'cameras': public_cameras(), 'now': time.time()})
        if path == '/api/stream.m3u8' or path.startswith('/api/hls/'):
            return self.camera_stream(path)
        target = ROOT / 'static' / ('index.html' if path == '/' else 'settings.html' if path == '/settings' else path.lstrip('/'))
        try:
            target = target.resolve()
            if not target.is_relative_to(ROOT / 'static') or not target.is_file():
                return self.send({'error': 'Not found'}, status=404)
            import mimetypes
            return self.send(target.read_bytes(), mimetypes.guess_type(target)[0] or 'application/octet-stream')
        except OSError:
            return self.send({'error': 'Not found'}, status=404)

    def camera_stream(self, path):
        query = parse_qs(urlsplit(self.path).query)
        if path == '/api/stream.m3u8':
            source = query.get('src', [''])[0]
            if source not in {c['id'] for c in public_cameras()}:
                return self.send({'error': 'Unknown camera'}, status=404)
            query = {'src': source, 'video': 'h264'}
        elif path in {'/api/hls/playlist.m3u8', '/api/hls/init.mp4', '/api/hls/segment.m4s', '/api/hls/segment.ts'}:
            session = query.get('id', [''])[0]
            number = query.get('n', ['0'])[0]
            if not re.fullmatch(r'[A-Za-z0-9]{8}', session) or not re.fullmatch(r'[0-9]{1,12}', number):
                return self.send({'error': 'Invalid stream session'}, status=400)
            query = {'id': session, 'n': number}
        else:
            return self.send({'error': 'Not found'}, status=404)
        try:
            with requests.get('http://127.0.0.1:1984' + path, params=query, timeout=(3, 12),
                              allow_redirects=False, stream=True) as response:
                response.raise_for_status()
                data = bytearray()
                for chunk in response.iter_content(65536):
                    data.extend(chunk)
                    if len(data) > 8 * 1024 * 1024:
                        raise ValueError('Stream segment too large')
                if path.endswith('.m3u8') and not data.startswith(b'#EXTM3U'):
                    raise ValueError('Stream unavailable')
                return self.send(bytes(data), response.headers.get('Content-Type', 'application/octet-stream'))
        except (requests.RequestException, ValueError):
            return self.send({'error': 'Camera stream unavailable'}, status=503)

    def do_POST(self):
        if not self.allowed():
            return
        # Custom header + JSON and same-origin checks prevent cross-origin form writes.
        origin = self.headers.get('Origin')
        if (self.headers.get('X-Kitchen-Request') != '1' or
                self.headers.get('Content-Type') != 'application/json' or
                (origin and urlsplit(origin).netloc != self.headers.get('Host'))):
            return self.send({'error': 'Invalid request origin'}, status=403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 <= length <= 131072:
                raise ValueError('Request too large.')
            body = json.loads(self.rfile.read(length) or '{}')
            if self.path == '/api/cameras':
                if not ipaddress.ip_address(self.client_address[0]).is_loopback:
                    return self.send({'error': 'Edit camera connections on this display at http://localhost:8090/settings.'}, status=403)
                try:
                    return self.send(camera_config.save(body))
                except camera_config.CameraConflict as exc:
                    return self.send({'error': str(exc)}, status=409)
                except (ValueError, TypeError, KeyError):
                    return self.send({'error': 'Camera settings were not applied. Check the address, port and RTSP path, and that kitchen-cameras.service is installed.'}, status=400)
            if self.path in ('/api/oauth/config', '/api/accounts/connect'):
                if not ipaddress.ip_address(self.client_address[0]).is_loopback:
                    return self.send({'error': 'Complete provider setup and sign-in on the kitchen display at http://localhost:8090/settings.'}, status=403)
                if self.path == '/api/oauth/config':
                    accounts.save_apps(body)
                    return self.send(accounts.public_apps())
                if self.headers.get('Host') != 'localhost:8090':
                    return self.send({'error': 'Open http://localhost:8090/settings on the kitchen display to sign in.'}, status=400)
                provider = body['provider']
                url, nonce = accounts.begin(provider, str(body.get('hint', '')))
                return self.send({'url': url}, headers={'Set-Cookie': f'kitchen_oauth_{provider}={nonce}; Path=/auth/; HttpOnly; SameSite=Lax; Max-Age=600'})
            if self.path == '/api/accounts/select':
                select_account_calendars(body)
                return self.send(public_settings())
            if self.path == '/api/accounts/remove':
                disconnect_account(body['accountId'])
                return self.send({'ok': True})
            if self.path == '/api/settings':
                save_settings(body)
                return self.send(public_settings())
            if self.path == '/api/refresh':
                WAKE.set()
                return self.send({'ok': True})
            return self.send({'error': 'Not found'}, status=404)
        except SettingsConflict as exc:
            return self.send({'error': str(exc)}, status=409)
        except (ValueError, TypeError, KeyError, OSError, StopIteration):
            return self.send({'error': 'Settings could not be saved. Check the timezone, colours and HTTPS feed addresses.'}, status=400)
        except Exception:
            return self.send({'error': 'Account operation failed. Check the provider setup, sign in again, and retry.'}, status=400)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8090)
    parser.add_argument('--setup-camera', action='store_true')
    args = parser.parse_args()
    PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(PRIVATE, 0o700)
    if not CONFIG.exists():
        private_json(CONFIG, DEFAULT)
    if not ACCESS.exists():
        fd = os.open(ACCESS, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            handle.write(secrets.token_urlsafe(20))
    if args.setup_camera:
        import getpass
        host = input('Camera IP or hostname: ').strip()
        username = input('Username [admin]: ').strip() or 'admin'
        private_json(CAMERA, {'host': host, 'username': username, 'password': getpass.getpass('Camera password: ')})
        print('Camera credentials saved privately.')
        return
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    threading.Thread(target=calendar_worker, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    logging.info('Kitchen display listening on %s:%d', args.host, args.port)
    server.serve_forever()


if __name__ == '__main__':
    main()
