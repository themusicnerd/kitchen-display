#!/usr/bin/env python3
"""Regenerate the private loopback RTSP bridge. Dry-run unless --apply is given."""
import argparse
import camera_config as cameras

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--restart', action='store_true')
args = parser.parse_args()
with cameras.LOCK:
    configured = cameras.validate(cameras.load(), cameras.load())
    print(f'{len(configured)} camera(s); credentials will not be printed.')
    if args.apply:
        cameras.write_private(cameras.BRIDGE, cameras.bridge_config(configured))
        if args.restart:
            cameras.restart_bridge()
        print('Private bridge configuration saved.')
    else:
        print('Dry-run: no files changed. Use --apply, optionally --restart.')
