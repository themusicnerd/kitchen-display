import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import requests
from authlib.integrations.base_client.errors import OAuthError
import server


class CalendarStatusTests(unittest.TestCase):
    def test_live_cached_auth_and_disabled_status_without_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory)/'settings.json'
            source = {'id': 'fixture', 'name': 'Calendar', 'color': '#123456', 'enabled': True,
                      'accountId': 'account', 'calendarId': 'private-calendar-id', 'url': ''}
            conf = copy.deepcopy(server.DEFAULT); conf['calendars'] = [source]
            server.private_json(config, conf)
            with patch.object(server, 'CONFIG', config), patch.object(server, 'CACHE', Path(directory)/'cache.json'), \
                 patch.object(server, 'SOURCE_CACHE', {}), patch.object(server, 'STATE', {'events': [], 'sources': [], 'updated': None}):
                with patch.object(server.accounts, 'event_window', return_value=[]): server.refresh_calendars()
                status = server.calendar_connection_status()['sources'][0]
                self.assertEqual(status['state'], 'ready'); self.assertLess(time.time()-status['lastSuccess'], 5)
                for error, issue in ((OAuthError(error='invalid_grant', description='private-token-value'), 'auth'),
                                     (OAuthError(error='invalid_client'), 'setup'), (requests.Timeout('private-url'), 'network')):
                    with patch.object(server.accounts, 'event_window', side_effect=error): server.refresh_calendars()
                    public = server.calendar_connection_status(); status = public['sources'][0]
                    self.assertEqual(status['issue'], issue); self.assertEqual(status['state'], 'offline - cached events')
                    self.assertNotIn('private', json.dumps(public))
                source['enabled'] = False; server.private_json(config, conf)
                self.assertEqual(server.calendar_connection_status()['sources'][0], {'id': 'fixture', 'accountId': 'account', 'state': 'disabled'})

    def test_reconnect_endpoint_uses_existing_identity_and_stays_local(self):
        remote = {'value': False}
        class Handler(server.Handler):
            def setup(self):
                super().setup()
                if remote['value']: self.client_address = ('192.168.1.10', self.client_address[1])
        with tempfile.TemporaryDirectory() as directory:
            password=Path(directory)/'password'; password.write_text('test-password')
            account={'id':'existing','provider':'google','email':'person@example.com','name':'Person'}
            with patch.object(server, 'ACCESS', password), \
                 patch.object(server.accounts, 'public_accounts', return_value=[account]), \
                 patch.object(server.accounts, 'begin', return_value=('https://accounts.example/authorize', 'fixture-nonce')) as begin:
                http=server.ThreadingHTTPServer(('127.0.0.1',0), Handler);worker=threading.Thread(target=http.serve_forever,daemon=True);worker.start()
                base=f'http://127.0.0.1:{http.server_port}'
                headers={'Host':'localhost:8090','Content-Type':'application/json','X-Kitchen-Request':'1'}
                try:
                    response=requests.post(base+'/api/accounts/connect',headers=headers,json={'accountId':'existing','provider':'microsoft'},timeout=3)
                    self.assertEqual(response.status_code,200); begin.assert_called_once_with('google','',reconnect_id='existing')
                    self.assertEqual(requests.post(base+'/api/accounts/connect',headers=headers,json={'accountId':'missing'},timeout=3).status_code,404)
                    remote['value']=True
                    self.assertEqual(requests.post(base+'/api/accounts/connect',auth=('kitchen','test-password'),headers=headers,json={'accountId':'existing'},timeout=3).status_code,403)
                    begin.assert_called_once()
                finally:
                    http.shutdown();http.server_close();worker.join(timeout=3)
