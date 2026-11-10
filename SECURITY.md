# Security

This application is for a trusted home LAN with a trusted local desktop user.
It is not suitable for internet exposure, untrusted tenants or shared public PCs.
Loopback access trusts local users; LAN access uses HTTP Basic authentication.
HTTP does not encrypt credentials or displayed calendar/camera data. Use a secure
network and do not port-forward dashboard or camera ports.

Use read-only camera credentials and read-only calendar permissions. RTSP traffic
to the camera is not encrypted by this app. The editor deliberately accepts only
RTSP connection fields, not arbitrary go2rtc/FFmpeg commands. Camera and provider
credential changes are localhost-only. Saving camera settings can interrupt all
feeds briefly while the bridge restarts. A successful save does not verify a
camera is reachable; the live indicator reports playback progress.

Cast receivers can load only an explicit generic asset allowlist without Basic
authentication, and a random bearer capability retrieves only its selected timer.
Timer links are revocable and expire; server restarts end them. The fragment is
not logged by the HTTP server. HTTP is still plaintext on the LAN, and the external
DashCast bootstrap / Google receiver framework are trusted third-party code.
Do not cast sensitive timer names on an untrusted network or shared screen.

The private directory may contain family events, tokens, feed URLs and camera
passwords. Do not attach it, screenshots, logs containing event content, or browser
profiles to issues. Rotate credentials with their provider if accidentally exposed.
The public repository contains no working camera credentials or OAuth apps.

For suspected vulnerabilities, contact the repository owner privately through
their GitHub profile rather than opening an issue containing secrets.
