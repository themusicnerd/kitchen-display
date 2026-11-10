"""Private, vendor-neutral RTSP camera configuration for the local bridge."""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import threading
from urllib.parse import quote

PRIVATE = Path.home() / '.config/kitchen-display'
CAMERAS = PRIVATE / 'cameras.json'
BRIDGE = PRIVATE / 'go2rtc.yaml'
LOCK = threading.RLock()


class CameraConflict(ValueError):
    pass


def write_private(path, data):
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(path.parent, 0o700)
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(data, handle, indent=2)
    os.replace(temporary, path)


def load():
    cameras = json.loads(CAMERAS.read_text()) if CAMERAS.exists() else []
    return [dict(c, port=c.get('port', 554), path=c.get('path', '/Streaming/Channels/102'),
                 enabled=c.get('enabled', True)) for c in cameras]


def revision(cameras):
    return hashlib.sha256(json.dumps(cameras, sort_keys=True).encode()).hexdigest()


def public():
    with LOCK:
        cameras = load()
        return {'revision': revision(cameras), 'cameras': [
            {**{key: c.get(key, '') for key in ('id', 'name', 'host', 'port', 'enabled', 'username')},
             'path': c['path'] if '?' not in c['path'] else '',
             'pathConfigured': True, 'hasPassword': bool(c.get('password'))} for c in cameras]}


def validate(items, previous):
    if not isinstance(items, list) or len(items) > 4:
        raise ValueError('Use up to four cameras.')
    result, ids = [], set()
    existing = {c['id']: c for c in previous}
    for item in items:
        camera_id = str(item.get('id', ''))
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', camera_id) or camera_id in ids:
            raise ValueError('Each camera needs a unique ID.')
        ids.add(camera_id)
        old = existing.get(camera_id, {})
        host = str(item.get('host', '')).strip().strip('[]')
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if len(host) > 253 or not all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', part) for part in host.split('.')):
                raise ValueError('Enter a camera IP address or hostname, without a URL.') from None
        port = int(item.get('port', 554))
        if not 1 <= port <= 65535:
            raise ValueError('RTSP port must be between 1 and 65535.')
        path = str(item.get('path', '')).strip() or old.get('path', '')
        if not path.startswith('/') or len(path) > 2048 or '#' in path or any(ord(c) < 32 for c in path):
            raise ValueError('Enter an RTSP path starting with /, without a fragment.')
        username = str(item.get('username', ''))
        password = str(item.get('password', '')) or old.get('password', '')
        if item.get('clearPassword'):
            password = ''
        if len(username) > 256 or len(password) > 1024 or any(ord(c) < 32 for c in username + password):
            raise ValueError('Invalid camera credentials.')
        result.append({'id': camera_id, 'name': str(item.get('name', '')).strip()[:60] or 'Camera',
                       'host': host, 'port': port, 'path': path, 'username': username,
                       'password': password, 'enabled': bool(item.get('enabled', True))})
    return result


def bridge_config(cameras):
    streams = {}
    for camera in cameras:
        if not camera['enabled']:
            continue
        host = camera['host']
        if ':' in host:
            host = '[' + host + ']'
        credentials = ''
        if camera['username'] or camera['password']:
            credentials = quote(camera['username'], safe='') + ':' + quote(camera['password'], safe='') + '@'
        streams[camera['id']] = f"rtsp://{credentials}{host}:{camera['port']}{camera['path']}#backchannel=0#media=video"
    return {'api': {'listen': '127.0.0.1:1984'}, 'rtsp': {'listen': '127.0.0.1:8554'},
            'webrtc': {'listen': ''}, 'srt': {'listen': ''}, 'streams': streams, 'log': {'level': 'error'}}


def restart_bridge():
    subprocess.run(['systemctl', '--user', 'restart', 'kitchen-cameras.service'],
                   check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def save(data):
    with LOCK:
        previous = load()
        if data.get('revision') != revision(previous):
            raise CameraConflict('Cameras changed elsewhere. Reload settings before saving.')
        cameras = validate(data.get('cameras'), previous)
        old_bridge = json.loads(BRIDGE.read_text()) if BRIDGE.exists() else bridge_config(previous)
        # Keep the last working setup privately; never back up credentials in the repository.
        write_private(PRIVATE / 'cameras.before-settings.json', previous)
        write_private(PRIVATE / 'go2rtc.before-settings.json', old_bridge)
        try:
            write_private(CAMERAS, cameras)
            write_private(BRIDGE, bridge_config(cameras))
            restart_bridge()
        except (subprocess.SubprocessError, OSError):
            write_private(CAMERAS, previous)
            write_private(BRIDGE, old_bridge)
            try:
                restart_bridge()
            except (subprocess.SubprocessError, OSError):
                pass
            raise ValueError('Camera service could not restart. Previous settings restored; check kitchen-cameras.service.') from None
        return public()
