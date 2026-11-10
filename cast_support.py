"""LAN Cast discovery and revocable, single-timer receiver sessions."""
import hashlib
import ipaddress
import logging
import math
import re
import secrets
import socket
import threading
import time
from datetime import datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo


class CastError(ValueError):
    pass


def private_address(host):
    try:
        address = ipaddress.ip_address(host)
        return address.is_private and not (address.is_loopback or address.is_unspecified or address.is_multicast)
    except ValueError:
        return False


def validate_options(data):
    hosts = data.get('castKnownHosts', [])
    if not isinstance(hosts, list) or len(hosts) > 16 or any(not isinstance(h, str) or not private_address(h) for h in hosts):
        raise ValueError('Cast hosts must be private LAN IP addresses (maximum 16).')
    origin = str(data.get('castBaseUrl', '')).strip().rstrip('/')
    if origin:
        parsed = urlsplit(origin)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or
                parsed.path or parsed.query or parsed.fragment or not parsed.port and parsed.netloc.endswith(':')):
            raise ValueError('Enter a LAN HTTP/HTTPS origin without a path or credentials.')
        if not (private_address(parsed.hostname) or re.fullmatch(r'[A-Za-z0-9.-]+\.local', parsed.hostname)):
            raise ValueError('Cast server URL must use a private IP or .local hostname.')
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError('Invalid Cast server port.')
    return {'castEnabled': bool(data.get('castEnabled', True)), 'castKnownHosts': hosts, 'castBaseUrl': origin}


def clean_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value):
        raise CastError('Invalid timer or client identifier.')
    return value


def finite_number(value, maximum):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 <= value <= maximum:
        raise CastError('Invalid timer duration.')
    return float(value)


def timer_snapshot(conf, source, timer=None):
    kind, source_id = source.get('kind'), clean_id(source.get('id'))
    now = time.time() * 1000
    if kind == 'activity':
        if not conf.get('visualTimersEnabled', True):
            raise CastError('Activity countdowns are disabled.')
        item = next((t for t in conf.get('visualTimers', []) if t['id'] == source_id and t['enabled']), None)
        if item is None:
            raise CastError('This activity timer is no longer enabled.')
        deadline = finite_number(source.get('at'), now + 8*86400000)
        tz = ZoneInfo(conf['timezone'])
        target = datetime.fromtimestamp(deadline/1000, tz)
        if ((target.weekday()+1) % 7 not in item['days'] or target.strftime('%H:%M') != item['time'] or
                target.second != 0 or target.microsecond != 0 or deadline < now-86400000):
            raise CastError('The selected activity occurrence is no longer valid.')
        return {'name': item['name'], 'status': 'running', 'endAt': deadline, 'remainingMs': max(0, deadline-now), 'kind': kind}
    if kind != 'countdown' or not conf.get('timeToolsEnabled', True) or not isinstance(timer, dict):
        raise CastError('Select a countdown or activity timer.')
    status = timer.get('status')
    if status not in ('idle', 'running', 'paused', 'finished'):
        raise CastError('Invalid timer state.')
    remaining = finite_number(timer.get('remainingMs'), 100*3600000)
    return {'name': str(timer.get('name', 'Timer')).strip()[:60] or 'Timer', 'status': status,
            'endAt': now+remaining if status == 'running' else None,
            'remainingMs': remaining, 'kind': kind}


class CastManager:
    def __init__(self, get_settings):
        self.get_settings = get_settings
        self.lock = threading.RLock()
        self.scan_lock = threading.Lock()
        self.devices = {}
        self.jobs = {}
        self.tokens = {}
        self.last_scan = 0

    def enabled(self):
        if not self.get_settings().get('castEnabled', True):
            raise CastError('Casting is disabled in Settings.')

    def discover(self, refresh=False):
        self.enabled()
        with self.scan_lock:
            if refresh or time.time()-self.last_scan > 45:
                try:
                    import pychromecast
                    from zeroconf import Zeroconf
                    # Library errors can contain the receiver's capability URL.
                    logger = logging.getLogger('pychromecast')
                    logger.addHandler(logging.NullHandler()) if not logger.handlers else None
                    logger.propagate = False
                    zconf = Zeroconf()
                    found, browser = pychromecast.discovery.discover_chromecasts(
                        timeout=6, zeroconf_instance=zconf, known_hosts=self.get_settings().get('castKnownHosts') or None)
                    try:
                        devices = {str(info.uuid): info for info in found if
                                   info.cast_type not in ('audio', 'group') and private_address(info.host)}
                    finally:
                        browser.stop_discovery()
                    with self.lock:
                        self.devices = devices
                        self.last_scan = time.time()
                except ImportError:
                    raise CastError('Install the locked Python requirements to enable Google Cast.') from None
                except Exception:
                    raise CastError('Cast discovery failed. Check the LAN connection and multicast settings.') from None
        with self.lock:
            return [{'id': key, 'name': info.friendly_name, 'model': info.model_name or 'Cast screen'}
                    for key, info in sorted(self.devices.items(), key=lambda pair: pair[1].friendly_name.casefold())]

    def _origin(self, host, port):
        configured = self.get_settings().get('castBaseUrl', '')
        if configured:
            return configured
        family = socket.AF_INET6 if ':' in host else socket.AF_INET
        with socket.socket(family, socket.SOCK_DGRAM) as connection:
            connection.connect((host, 8009))
            address = connection.getsockname()[0]
        if not private_address(address):
            raise CastError('No private LAN address is available for the receiver.')
        return f'http://[{address}]:{port}' if ':' in address else f'http://{address}:{port}'

    def _prune(self):
        now = time.time()
        for job_id, job in list(self.jobs.items()):
            if job['expiresAt'] <= now:
                self.tokens.pop(job['tokenHash'], None)
                self.jobs.pop(job_id, None)

    def public_job(self, job):
        return {key: job[key] for key in ('id', 'deviceName', 'source', 'clientId', 'startedAt', 'lastSeen', 'expiresAt')}

    def status(self, client_id):
        clean_id(client_id)
        with self.lock:
            self._prune()
            return {'sessions': [self.public_job(job) for job in self.jobs.values() if job['clientId'] == client_id]}

    def start(self, body, port):
        self.enabled()
        client_id = clean_id(body.get('clientId'))
        source = body.get('source')
        if not isinstance(source, dict):
            raise CastError('Select a timer to cast.')
        conf = self.get_settings()
        timer = timer_snapshot(conf, source, body.get('timer'))
        source = {key: source[key] for key in ('kind', 'id', 'at') if key in source}
        self.discover()
        with self.lock:
            self._prune()
            info = self.devices.get(body.get('deviceId'))
            if info is None:
                raise CastError('Choose a discovered Cast screen, then try again.')
            if len(self.jobs) >= 8:
                raise CastError('Stop an existing cast before starting another.')
        token = secrets.token_urlsafe(32)
        job_id, digest = secrets.token_hex(16), hashlib.sha256(token.encode()).hexdigest()
        now = time.time()
        job = {'id': job_id, 'deviceName': info.friendly_name, 'deviceId': str(info.uuid), 'source': dict(source),
               'clientId': client_id, 'timer': timer, 'tokenHash': digest, 'startedAt': now, 'lastSeen': None,
               'expiresAt': min(now+8*86400, max(now+600, (timer['endAt'] or now*1000)/1000+900)),
               'theme': 'light' if body.get('theme') == 'light' else 'dark', 'paperTexture': bool(body.get('paperTexture')),
               'timezone': conf['timezone']}
        url = self._origin(info.host, port)+'/cast/timer#'+token
        with self.lock:
            self.jobs[job_id] = job
            self.tokens[digest] = job_id
        try:
            import pychromecast
            from zeroconf import Zeroconf
            from pychromecast.controllers.dashcast import DashCastController
            # Discovery closes its own resolver; each launch needs a live resolver.
            resolver = Zeroconf()
            cast = None
            try:
                cast = pychromecast.get_chromecast_from_cast_info(info, resolver, tries=1, retry_wait=1, timeout=6)
                cast.wait(timeout=10)
                controller = DashCastController()
                cast.register_handler(controller)
                complete = threading.Event()
                result = []
                def callback(success, response=None):
                    result.append(success)
                    complete.set()
                if cast.status.app_id == controller.supporting_app_id:
                    cast.quit_app(timeout=8)
                # A previous timer navigated away from DashCast's message bus.
                # Relaunch its bootstrap before sending another timer URL.
                controller.launch(force_launch=True, callback_function=callback)
                if not complete.wait(35) or not result or not result[0]:
                    raise CastError('The screen did not launch DashCast. Check it is awake and online.')
                ready_until = time.monotonic()+10
                while not controller.is_active and time.monotonic() < ready_until:
                    time.sleep(.1)
                if not controller.is_active:
                    raise CastError('DashCast is not ready. Check the screen has internet access.')
                controller.load_url(url, force=True)
                # DashCast does not always acknowledge custom messages. An HTTP
                # receiver poll is stronger evidence than a protocol callback.
                until = time.monotonic()+10
                while time.monotonic() < until:
                    with self.lock:
                        connected = job['lastSeen'] is not None
                    if connected:
                        break
                    time.sleep(.2)
                active = getattr(cast.status, 'app_id', None) == controller.supporting_app_id
                if not (connected or active):
                    raise CastError('The screen did not accept the timer. Try refreshing the device list.')
            finally:
                try:
                    if cast is not None:
                        cast.disconnect(timeout=3)
                finally:
                    resolver.close()
        except CastError:
            with self.lock:
                self.tokens.pop(digest, None)
                self.jobs.pop(job_id, None)
            raise
        except Exception:
            with self.lock:
                self.tokens.pop(digest, None)
                self.jobs.pop(job_id, None)
            raise CastError('Unable to launch the timer on that screen. Check it is awake and reachable.') from None
        with self.lock:
            # Revoke older links only after launch, so their closing receiver
            # cannot cancel this app launch while the old page is still active.
            for previous_id, previous in list(self.jobs.items()):
                if previous_id != job_id and previous['deviceId'] == job['deviceId']:
                    self.tokens.pop(previous['tokenHash'], None)
                    self.jobs.pop(previous_id, None)
        return self.public_job(job)

    def update(self, body):
        self.enabled()
        with self.lock:
            self._prune()
            job = self.jobs.get(body.get('sessionId'))
            if job is None or job['clientId'] != body.get('clientId'):
                raise CastError('This Cast session has ended.')
            job['timer'] = timer_snapshot(self.get_settings(), job['source'], body.get('timer'))
            job['theme'] = 'light' if body.get('theme') == 'light' else 'dark'
            job['paperTexture'] = bool(body.get('paperTexture'))
            if job['timer']['endAt']:
                job['expiresAt'] = min(job['startedAt']+8*86400, max(time.time()+600, job['timer']['endAt']/1000+900))
            return self.public_job(job)

    def stop(self, body):
        with self.lock:
            job = self.jobs.get(body.get('sessionId'))
            if job and job['clientId'] != body.get('clientId'):
                raise CastError('This Cast session belongs to another browser.')
            if job:
                self.tokens.pop(job['tokenHash'], None)
                self.jobs.pop(job['id'], None)
            return {'ok': True}

    def receiver(self, token):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            return None
        with self.lock:
            self._prune()
            job = self.jobs.get(self.tokens.get(hashlib.sha256(token.encode()).hexdigest()))
            if job is None or not self.get_settings().get('castEnabled', True):
                return None
            if job['source']['kind'] == 'activity':
                try:
                    job['timer'] = timer_snapshot(self.get_settings(), job['source'])
                except CastError:
                    return None
            job['lastSeen'] = time.time()
            return {'timer': dict(job['timer']), 'theme': job['theme'], 'paperTexture': job['paperTexture'],
                    'timezone': job['timezone'], 'serverNow': time.time()*1000}
