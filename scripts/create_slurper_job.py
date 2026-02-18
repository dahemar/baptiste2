#!/usr/bin/env python3
import json
import os
import sys
import urllib.request


def main() -> int:
    account_id = os.environ.get("CF_ACCOUNT_ID")
    token = os.environ.get("CF_API_TOKEN")
    if not account_id or not token:
        print("Missing CF_ACCOUNT_ID or CF_API_TOKEN", file=sys.stderr)
        return 2

    payload = {
        "overwrite": True,
        "source": {
            "vendor": os.environ.get("SLURPER_SOURCE_VENDOR", "r2"),
            "bucket": os.environ.get("SLURPER_SOURCE_BUCKET", "baptiste-videos"),
            "secret": {
                "accessKeyId": os.environ.get("SLURPER_SOURCE_KEY", ""),
                "secretAccessKey": os.environ.get("SLURPER_SOURCE_SECRET", ""),
            },
        },
        "target": {
            "vendor": os.environ.get("SLURPER_TARGET_VENDOR", "r2"),
            "bucket": os.environ.get("SLURPER_TARGET_BUCKET", "baptiste-videos"),
            "secret": {
                "accessKeyId": os.environ.get("SLURPER_TARGET_KEY", ""),
                "secretAccessKey": os.environ.get("SLURPER_TARGET_SECRET", ""),
            },
        },
    }

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/slurper/jobs"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            print(f"HTTP {response.status}")
            print(response.read().decode())
            return 0
    except Exception as error:
        print(error)
        if hasattr(error, "read"):
            print(error.read().decode())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
