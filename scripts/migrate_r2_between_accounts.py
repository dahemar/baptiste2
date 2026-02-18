#!/usr/bin/env python3
import argparse
import mimetypes
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path


def upload_object(account_id: str, bucket: str, token: str, file_path: Path) -> None:
    key = file_path.name
    content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/r2/buckets/{bucket}/objects/{urllib.parse.quote(key)}"
    )

    data = file_path.read_bytes()
    request = urllib.request.Request(
        url,
        data=data,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": content_type,
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )

    with urllib.request.urlopen(request, timeout=180) as response:
        if response.status != 200:
            raise RuntimeError(f"Upload failed for {key} (HTTP {response.status})")


def delete_probe_if_exists(account_id: str, bucket: str, token: str) -> None:
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/r2/buckets/{bucket}/objects/test-upload.txt"
    )
    request = urllib.request.Request(
        url,
        method="DELETE",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        urllib.request.urlopen(request, timeout=30)
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate files to destination Cloudflare R2 bucket via API")
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--token-env", default="CF_API_TOKEN_DEST")
    args = parser.parse_args()

    token = os.environ.get(args.token_env)
    if not token:
        print(f"Missing env var: {args.token_env}", file=sys.stderr)
        return 2

    source_dir = Path(args.source_dir)
    if not source_dir.exists() or not source_dir.is_dir():
        print(f"Source dir not found: {source_dir}", file=sys.stderr)
        return 2

    files = sorted([path for path in source_dir.iterdir() if path.is_file()])
    print(f"Found {len(files)} files in {source_dir}")

    failures: list[tuple[str, str]] = []
    uploaded = 0
    for index, file_path in enumerate(files, start=1):
        try:
            upload_object(args.account_id, args.bucket, token, file_path)
            uploaded += 1
        except Exception as error:
            failures.append((file_path.name, str(error)))

        if index % 10 == 0 or index == len(files):
            print(f"Processed {index}/{len(files)} (uploaded={uploaded}, failed={len(failures)})")

    delete_probe_if_exists(args.account_id, args.bucket, token)
    print("Upload complete")
    if failures:
        print("Failed files:")
        for key, reason in failures:
            print(f" - {key}: {reason}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
