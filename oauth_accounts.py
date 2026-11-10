"""Read-only Google/Microsoft calendar accounts with server-side OAuth tokens."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import threading
import time
from datetime import datetime, time as day_time, timezone
from urllib.parse import quote, urlsplit

from authlib.integrations.requests_client import OAuth2Session
import requests

PRIVATE = Path.home() / '.config/kitchen-display'
APPS = PRIVATE / 'oauth-apps.json'
ACCOUNTS = PRIVATE / 'oauth-accounts.json'
LOCK = threading.RLock()
PENDING = {}
PROVIDERS = {
    'google': {
        'authorize': 'https://accounts.google.com/o/oauth2/v2/auth',
        'token': 'https://oauth2.googleapis.com/token',
        'scope': 'openid email https://www.googleapis.com/auth/calendar.readonly',
    },
    'microsoft': {
        'authorize': 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        'token': 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        'scope': 'offline_access https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read',
    },
}


def load(path):
    return json.loads(path.read_text()) if path.exists() else {}


def store(path, data):
    PRIVATE.mkdir(parents=True, mode=0o700, exist_ok=True)
    fd = os.open(path.with_suffix('.tmp'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(data, handle, indent=2)
    os.replace(path.with_suffix('.tmp'), path)


def redirect_uri(provider):
    return f'http://localhost:8090/auth/{provider}/callback'


def public_apps():
    with LOCK:
        apps = load(APPS)
        return {p: {'clientId': apps.get(p, {}).get('clientId', ''),
                    'hasSecret': bool(apps.get(p, {}).get('clientSecret')),
                    'configured': bool(apps.get(p, {}).get('clientId')) and (p != 'google' or bool(apps.get(p, {}).get('clientSecret'))),
                    'redirectUri': redirect_uri(p)} for p in PROVIDERS}


def save_apps(data):
    with LOCK:
        apps = load(APPS)
        for provider in PROVIDERS:
            if provider not in data:
                continue
            item = data[provider]
            client_id = str(item.get('clientId', '')).strip()
            secret = str(item.get('clientSecret', '')).strip()
            if len(client_id) > 1024 or len(secret) > 4096:
                raise ValueError('Invalid application credentials')
            if not secret and client_id == apps.get(provider, {}).get('clientId'):
                secret = apps.get(provider, {}).get('clientSecret', '')
            apps[provider] = {'clientId': client_id, 'clientSecret': secret}
        store(APPS, apps)


def public_accounts():
    with LOCK:
        return [{k: account[k] for k in ('id', 'provider', 'email', 'name')}
                for account in load(ACCOUNTS).values()]


def connected(account_id):
    with LOCK:
        return account_id in load(ACCOUNTS)


def client(provider, app, **kwargs):
    return OAuth2Session(app['clientId'], client_secret=app.get('clientSecret') or None,
                         token_endpoint_auth_method='client_secret_post' if app.get('clientSecret') else 'none',
                         code_challenge_method='S256', **kwargs)


def begin(provider, hint=''):
    if provider not in PROVIDERS:
        raise ValueError('Choose Google or Microsoft 365.')
    with LOCK:
        app = load(APPS).get(provider, {})
        if not app.get('clientId') or (provider == 'google' and not app.get('clientSecret')):
            raise ValueError('Complete the one-time provider setup first.')
        verifier = secrets.token_urlsafe(48)
        browser_nonce = secrets.token_urlsafe(32)
        session = client(provider, app, redirect_uri=redirect_uri(provider), scope=PROVIDERS[provider]['scope'])
        options = {'prompt': 'select_account'}
        if provider == 'google':
            options.update(access_type='offline', prompt='consent select_account')
        if hint.strip():
            options['login_hint'] = hint.strip()[:254]
        url, state = session.create_authorization_url(PROVIDERS[provider]['authorize'], code_verifier=verifier, **options)
        now = time.time()
        for key, entry in list(PENDING.items()):
            if now - entry['created'] > 600:
                del PENDING[key]
        if len(PENDING) >= 20:
            raise ValueError('Too many pending sign-ins. Try again later.')
        PENDING[state] = {'provider': provider, 'verifier': verifier, 'browser': browser_nonce,
                          'created': now, 'app': app}
        return url, browser_nonce


def complete(provider, query, browser_nonce):
    state = query.get('state', [''])[0]
    with LOCK:
        pending = PENDING.get(state)
        if (not pending or pending['provider'] != provider or time.time()-pending['created'] > 600 or
                not hmac.compare_digest(pending['browser'], browser_nonce or '')):
            raise ValueError('Sign-in expired or belongs to another browser.')
        del PENDING[state]
    if query.get('error') or not query.get('code'):
        raise ValueError('Provider sign-in was cancelled.')
    session = client(provider, pending['app'], redirect_uri=redirect_uri(provider), scope=PROVIDERS[provider]['scope'])
    token = dict(session.fetch_token(PROVIDERS[provider]['token'], code=query['code'][0],
                                     code_verifier=pending['verifier'], timeout=20))
    if provider == 'google':
        response = session.get('https://openidconnect.googleapis.com/v1/userinfo', timeout=20)
        response.raise_for_status()
        profile = response.json()
        identity, email = profile['sub'], profile.get('email', '')
        name = profile.get('name') or email
    else:
        response = session.get('https://graph.microsoft.com/v1.0/me',
                               params={'$select': 'id,displayName,mail,userPrincipalName'}, timeout=20)
        response.raise_for_status()
        profile = response.json()
        identity = profile['id']
        email = profile.get('mail') or profile.get('userPrincipalName', '')
        name = profile.get('displayName') or email
    account_id = hashlib.sha256((provider + ':' + identity).encode()).hexdigest()[:24]
    with LOCK:
        accounts = load(ACCOUNTS)
        previous = accounts.get(account_id, {})
        if not token.get('refresh_token') and previous.get('token', {}).get('refresh_token'):
            token['refresh_token'] = previous['token']['refresh_token']
        accounts[account_id] = {'id': account_id, 'provider': provider, 'email': email,
                                 'name': name, 'token': token}
        store(ACCOUNTS, accounts)
    return account_id


def access_token(account_id, force=False):
    # Serialize refresh token rotation so simultaneous calendar requests cannot race.
    with LOCK:
        accounts = load(ACCOUNTS)
        account = accounts[account_id]
        token = account['token']
        if force or token.get('expires_at', 0) < time.time()+60:
            if not token.get('refresh_token'):
                raise ValueError('Reconnect this account to renew access.')
            provider = account['provider']
            app = load(APPS)[provider]
            session = client(provider, app, token=token)
            updated = dict(session.refresh_token(PROVIDERS[provider]['token'], refresh_token=token['refresh_token'], timeout=20))
            updated.setdefault('refresh_token', token['refresh_token'])
            account['token'] = updated
            store(ACCOUNTS, accounts)
            token = updated
        return token['access_token']


def api_get(account_id, url, params=None):
    # Provider pagination URLs are checked before attaching a bearer token.
    with LOCK:
        provider = load(ACCOUNTS)[account_id]['provider']
    expected = 'www.googleapis.com' if provider == 'google' else 'graph.microsoft.com'
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != expected:
        raise ValueError('Unexpected calendar API host')
    for attempt in range(2):
        response = requests.get(url, params=params, headers={
            'Authorization': 'Bearer ' + access_token(account_id, force=bool(attempt)),
            'Prefer': 'outlook.timezone="UTC"',
        }, timeout=(8, 25), allow_redirects=False)
        if response.status_code == 401 and attempt == 0:
            continue
        response.raise_for_status()
        if response.is_redirect:
            raise ValueError('Unexpected calendar API redirect')
        return response.json()
    raise ValueError('Account needs to be reconnected')


def available_calendars(account_id):
    with LOCK:
        provider = load(ACCOUNTS)[account_id]['provider']
    result = []
    url = ('https://www.googleapis.com/calendar/v3/users/me/calendarList' if provider == 'google'
           else 'https://graph.microsoft.com/v1.0/me/calendars')
    params = {'maxResults': 250} if provider == 'google' else {'$top': 100}
    for _ in range(20):
        data = api_get(account_id, url, params)
        for item in data.get('items' if provider == 'google' else 'value', []):
            result.append({'id': item['id'], 'name': item.get('summaryOverride') or item.get('summary') or item.get('name', 'Calendar'),
                           'color': item.get('backgroundColor') or item.get('hexColor') or '#d99a62'})
        if provider == 'google' and data.get('nextPageToken'):
            params['pageToken'] = data['nextPageToken']
        elif provider == 'microsoft' and data.get('@odata.nextLink'):
            url, params = data['@odata.nextLink'], None
        else:
            return result
    raise ValueError('Too many calendars')


def remove_account(account_id):
    with LOCK:
        accounts = load(ACCOUNTS)
        accounts.pop(account_id, None)
        store(ACCOUNTS, accounts)


def event_window(source, first, last, tz, hide_private=True):
    account_id = source['accountId']
    with LOCK:
        provider = load(ACCOUNTS)[account_id]['provider']
    calendar_id = quote(source['calendarId'], safe='')
    start = datetime.combine(first, day_time.min, tzinfo=tz).isoformat()
    end = datetime.combine(last, day_time.min, tzinfo=tz).isoformat()
    if provider == 'google':
        url = f'https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events'
        params = {'timeMin': start, 'timeMax': end, 'singleEvents': 'true', 'orderBy': 'startTime', 'maxResults': 2500}
    else:
        url = f'https://graph.microsoft.com/v1.0/me/calendars/{calendar_id}/calendarView'
        params = {'startDateTime': start, 'endDateTime': end, '$top': 1000,
                  '$select': 'id,subject,start,end,isAllDay,isCancelled,location,sensitivity'}
    events = []
    for _ in range(30):
        data = api_get(account_id, url, params)
        for event in data.get('items' if provider == 'google' else 'value', []):
            if event.get('status') == 'cancelled' or event.get('isCancelled'):
                continue
            private = str(event.get('visibility' if provider == 'google' else 'sensitivity', '')).lower() in ('private', 'confidential')
            if hide_private and private:
                continue
            if provider == 'google':
                all_day = 'date' in event['start']
                a = event['start'].get('date') or event['start']['dateTime']
                b = event['end'].get('date') or event['end']['dateTime']
                title, location = event.get('summary', 'Busy'), event.get('location', '')
            else:
                all_day = event.get('isAllDay', False)
                def graph_time(value):
                    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
                    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
                a, b = graph_time(event['start']['dateTime']), graph_time(event['end']['dateTime'])
                a, b = (a.astimezone(tz).date().isoformat(), b.astimezone(tz).date().isoformat()) if all_day else (a.isoformat(), b.isoformat())
                title, location = event.get('subject', 'Busy'), (event.get('location') or {}).get('displayName', '')
            events.append({'id': source['id'] + ':' + event['id'], 'sourceId': source['id'],
                           'source': source['name'], 'color': source['color'], 'title': title,
                           'location': location, 'start': a, 'end': b, 'allDay': all_day, 'isPrivate': private})
        if len(events) > 20000:
            raise ValueError('Too many events')
        if provider == 'google' and data.get('nextPageToken'):
            params['pageToken'] = data['nextPageToken']
        elif provider == 'microsoft' and data.get('@odata.nextLink'):
            url, params = data['@odata.nextLink'], None
        else:
            return events
    raise ValueError('Calendar event pagination limit reached')
