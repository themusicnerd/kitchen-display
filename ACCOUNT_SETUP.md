# Google and Microsoft account sign-in

The settings page supports multiple accounts, provider sign-in, choosing calendars,
removing calendars and disconnecting accounts. Each provider needs one application
registration for this dashboard first. Account passwords are entered only on
Google/Microsoft's own websites. Access is read-only.

Create your own provider registrations using the instructions below. Credentials
and account-specific registration records must stay outside the public repository.

Use **http://localhost:8090/settings on the NUC** for app setup and account sign-in.
The OAuth callback is localhost: opening the sign-in flow from a different LAN
device would send the callback to that other device. Layout and existing calendar
selections can still be managed from the authenticated LAN settings page.

## Google (one registration for all Gmail/Workspace accounts)

1. Open https://console.cloud.google.com/ and create/select a project.
2. Enable **Google Calendar API** under APIs & Services > Library.
3. Configure Google Auth Platform branding, audience and consent. Use External
   for personal Gmail accounts. During testing, add every intended Google account
   as a test user.
4. Configure data access for `openid`, `email` and
   `https://www.googleapis.com/auth/calendar.readonly`.
5. Create an OAuth client with application type **Web application**.
6. Add this exact authorised redirect URI:

   `http://localhost:8090/auth/google/callback`

7. In dashboard Settings > Calendar accounts > Provider app setup, enter Google's
   **Client ID** and **Client secret**, then Save provider setup.
8. Select Google, optionally enter an email address, and choose Sign in. Complete
   Google consent, then Select calendars for the connected account.

Google's External apps in Testing generally issue refresh tokens lasting seven
days when calendar scopes are requested. For unattended long-term operation,
review Google's publishing/verification requirements rather than leaving the app
in Testing indefinitely. This implementation requests offline access and refreshes
tokens automatically while provider access remains valid.

## Microsoft (one registration for permitted Microsoft accounts)

1. Open https://entra.microsoft.com/ > Identity > Applications > App registrations.
2. Register a new application. For multiple work tenants plus personal Outlook
   accounts, select **Accounts in any organizational directory and personal
   Microsoft accounts**.
3. Under Authentication, add **Mobile and desktop applications** and register:

   `http://localhost:8090/auth/microsoft/callback`

4. Add Microsoft Graph **Delegated** permissions `User.Read` and `Calendars.Read`.
   The sign-in flow also requests `offline_access` for token renewal.
5. Enter the **Application (client) ID** in dashboard Provider app setup. With the
   native/mobile-and-desktop registration, leave Client secret blank. PKCE is used.
6. Save, choose Microsoft 365 / Outlook, and Sign in. Select calendars afterward.

A confidential **Web** registration is also supported if you use the same redirect
URI and supply its client secret. Do not use the SPA platform type for this server
flow. Some work tenants require an administrator to approve app registration or
delegated consent; that approval must come from the organisation.

## Calendar selection and migration

An account can supply several calendars. Connect each account once, choose its
calendars, and repeat for additional accounts. Unchecking a calendar removes it
from this display; it does not delete the provider's calendar or events. The trash
icon beside an account removes its locally stored tokens and selected calendars.
Provider-side consent can be revoked separately on the provider's account page.

After selecting account calendars, their rows appear in Settings > Calendars.
Change each display name, colour or icon there and Save. Provider account/calendar
identifiers remain intact when these display preferences change. An older open
settings form must be reloaded if another page has updated the configuration.

Private/confidential events are hidden by default using provider privacy metadata;
the filtering is performed before events are sent to the display browser.

Matching provider/name placeholders may be reused when possible, preserving their
colour. Remove unmatched duplicate placeholders using their row's trash icon.

Private iCalendar URLs remain available as an alternative to sign-in.

## Token storage and verification

App secrets and tokens live only in `~/.config/kitchen-display/oauth-apps.json` and
`oauth-accounts.json`, with mode 600 inside a mode-700 directory. API responses
never contain access tokens, refresh tokens or client secrets. OAuth uses PKCE,
expiring state and a browser-bound HttpOnly/SameSite cookie. Provider setup and
new sign-in are limited to localhost. Calendar API access is read-only.

Local tests cover PKCE/state binding, rejection of stale/replayed callbacks,
token renewal, safe public account metadata, pagination and timezone conversion.
Live Google and Microsoft sign-ins, calendar listing and event retrieval have also
been verified on the original deployment.

References:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0
