# Third-party notices

- Google Sans Flex: SIL Open Font License 1.1, `static/assets/OFL.txt`.
  Source: https://github.com/google/fonts/tree/main/ofl/googlesansflex
- Lucide 0.468.0: ISC, `static/assets/LUCIDE-LICENSE.txt`.
  Source: https://github.com/lucide-icons/lucide
- HLS.js 1.5.18: Apache-2.0, `static/assets/HLS-LICENSE.txt`.
  Source: https://github.com/video-dev/hls.js
- go2rtc 1.9.15: MIT, `static/assets/GO2RTC-LICENSE.txt`.
  Source: https://github.com/AlexxIT/go2rtc

The go2rtc executable is downloaded by the installer, not bundled in the source.
Python dependency versions are in requirements.lock; each retains its own licence.

Google Cast control uses PyChromecast 14.1.1:
https://github.com/home-assistant-libs/pychromecast
The published DashCast receiver is launched remotely, not bundled:
https://github.com/madmod/dashcast
The TV loads Google's hosted Cast Application Framework at runtime.
