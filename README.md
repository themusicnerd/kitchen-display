# Kitchen Display

A touch-friendly household calendar and live-camera dashboard for a Linux display.
Large current week, smaller scrollable upcoming weeks, a clock with seconds,
Google Sans Flex, dark/light themes, and scheduled night dimming. Works without
cameras or cloud accounts; add only the connections you need.

## Install

Tested on Ubuntu 24.04, Python 3.12, Linux x86_64 with Firefox and user systemd.
The installer also supports the official Linux arm64 go2rtc build; that target
has not been tested on hardware. A desktop login session is required.

```bash
sudo apt install python3 python3-venv curl firefox
git clone https://github.com/themusicnerd/kitchen-display.git
cd kitchen-display
python3 install.py                 # preview only
python3 install.py --apply         # installs and starts user services
# Optional desktop-login kiosk:
python3 install.py --apply --kiosk
```

The installer downloads go2rtc 1.9.15 from its official release, verifies its pinned
SHA-256 checksum, and installs Python dependencies in `.venv`. Existing settings
are retained. Run as your desktop user, not root. It does not change automatic
login, sleep settings, firewall rules, camera firmware or camera encoding.

Open **http://localhost:8090/settings** on the display. The dashboard is at
http://localhost:8090/. Services start at user login, not before a login session.

## Cameras

In Settings > Cameras, add up to four cameras. Each has a name, enabled switch,
IP/hostname, RTSP port, path, username and password. Use a read-only camera account
and an H.264 substream for efficient browser playback. A common Hikvision path is
`/Streaming/Channels/102`; check your camera's documentation for other models.
Audio is disabled. H.265 decoding/transcoding is not configured automatically.

**Apply camera connections** saves cameras independently of calendar/layout
settings and restarts the private streaming bridge. A blank password retains the
saved password; use Clear saved password to remove it. Removing a row only removes
it from this dashboard. Cameras are never reconfigured or rebooted by the editor.
Connection editing is localhost-only, so camera passwords are not sent over LAN
HTTP. Query-string RTSP paths are treated as private and not returned to the form.

go2rtc bridges RTSP to HLS with a small playback delay. Expand opens all enabled
cameras stacked; X or Escape returns. Each refresh icon reconnects its own player.
A green dot means playback is advancing, not a guarantee of camera health.
Bridge API port 1984 and RTSP port 8554 bind only to loopback. Never expose the
dashboard or cameras to the public internet.

## Night Mode

Settings > Night mode has an enabled switch, start/end time inputs, a brightness
slider and a four-second preview. Overnight schedules use the selected display
timezone, including daylight saving. Start is inclusive; end is exclusive.
Night mode dims the dashboard and expanded cameras with a black overlay; it
does **not** change the physical monitor backlight or suspend the computer.
Settings stays at normal brightness so it can always be adjusted.

On the dashboard, the moon/sun button forces night mode on or off immediately.
The clock button returns to the automatic schedule. Manual overrides use the
saved dimming level and persist across reloads in that browser until cleared
with the clock button; they do not change the schedule or other devices.

The sun/moon theme button switches light/dark appearance with a smooth fade,
independently of brightness. Settings > Layout > Paper texture in light mode
enables a locally served neutral paper background, or turns it off for a plain
background. The theme shortcut persists in this browser; changing the default
Appearance in Settings takes precedence when that change reaches the display.

## Calendars

Connect multiple Google and Microsoft accounts, select their calendars, then
customise names, colours and icons under Calendars. Account access is read-only.
Each installation needs its own provider app registrations; see
[ACCOUNT_SETUP.md](ACCOUNT_SETUP.md). Microsoft supports multiple tenants and
personal accounts where their consent policies permit it. New OAuth sign-ins
must be completed on the display at `http://localhost:8090/settings`.

Private HTTPS iCalendar feeds are also supported. Private/confidential events
are hidden by default before reaching the browser, based on provider flags.
Calendars refresh every five minutes and include 26 upcoming weeks. Swipe the
Coming up area to browse ahead. Timed events show start and end times.

Touch a calendar name in the display legend to show/hide its events. Hidden
calendars remain in the legend, faded out; eye/eye-off buttons show or hide all
enabled calendars. Filters apply to current/upcoming weeks and event details,
persist in this browser and never disconnect accounts or change provider data.
The Calendar heading setting can be blank; the week itself remains visible.

## Security and Data

Private state is stored outside the checkout in `~/.config/kitchen-display/`:
`settings.json`, `cameras.json`, `go2rtc.yaml`, OAuth apps/tokens and `lan-password`.
The directory uses mode 700, secret files mode 600. Passwords and provider tokens
are never returned by settings APIs. Never upload this directory, browser
profiles, real screenshots, network captures or personalised backups.

LAN access requires username `kitchen`; read the generated password locally:

```bash
cat ~/.config/kitchen-display/lan-password
```

Localhost access trusts the desktop user. LAN HTTP Basic authentication and
calendar content are not encrypted: use only a trusted home LAN. This is not a
multi-user internet service. Do not port-forward it. Camera/provider credential
setup is restricted to localhost. Selected calendar names/events are intentionally
visible to authenticated display users. See [SECURITY.md](SECURITY.md).

## Services and Recovery

```bash
systemctl --user restart kitchen-display kitchen-cameras
journalctl --user -u kitchen-display -n 50
systemctl --user disable --now kitchen-display kitchen-cameras
```

If installed, disable kiosk startup by renaming
`~/.config/autostart/kitchen-display.desktop` to `.desktop.disabled`.
Private camera backups are `cameras.before-settings.json` and
`go2rtc.before-settings.json`. To restore the last setup, stop the services, copy
these over `cameras.json` and `go2rtc.yaml`, keep mode 600, then restart services.
Back up the entire private directory securely before reinstalling or migrating.

Blank video: check the camera uses H.264, RTSP path/login are correct, and
`kitchen-cameras.service` is running. Do not paste go2rtc configuration or camera
URLs into public issues. Blank page: check `kitchen-display.service`, reload the
browser and check its console without publishing private event content.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -v
node tests/night-mode.cjs
```

`tests/settings-browser.cjs` uses mocked data and Playwright for UI regression
tests. Install Playwright separately and set `PLAYWRIGHT_PATH` if needed. With
Snap Chromium set `CHROMIUM_PATH=/snap/bin/chromium` and `CHROMIUM_PROFILE` to a
dedicated writable folder under `~/snap/chromium/common/`. Never use your normal
browser profile. Browser screenshots stay in ignored `test-results/`.

## Credits

Original application code is available under the [MIT licence](LICENSE).

Google Sans Flex (OFL), Lucide 0.468.0 (ISC), HLS.js 1.5.18 (Apache-2.0),
go2rtc 1.9.15 (MIT), and the Python dependencies listed in `requirements.lock`.
Third-party licence notices are included in `static/assets/` and `NOTICE.md`.
