#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


def cf_api_get_json(url: str, token: str) -> dict:
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Cloudflare API error {error.code} for {url}: {body[:500]}") from error


def find_account_id_for_bucket(bucket: str, token: str) -> str:
    accounts = cf_api_get_json("https://api.cloudflare.com/client/v4/accounts", token)
    if not accounts.get("success"):
        raise RuntimeError(f"Cloudflare /accounts request failed: {accounts}")

    results = accounts.get("result") or []
    if not results:
        raise RuntimeError("No Cloudflare accounts returned for this token")

    for account in results:
        account_id = account.get("id")
        if not account_id:
            continue

        try:
            buckets = cf_api_get_json(
                f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets",
                token,
            )
        except Exception:
            continue

        if not buckets.get("success"):
            continue

            # `result` may be a dict containing a `buckets` list, or directly a list.
            result = buckets.get("result")
            bucket_list = None
            if isinstance(result, dict) and "buckets" in result:
                bucket_list = result.get("buckets") or []
            elif isinstance(result, list):
                bucket_list = result
            else:
                # fallback: iterate over whatever `result` is
                bucket_list = result or []

            import re

            def _normalize_name(n: str) -> str:
                if not n:
                    return ""
                # lower, remove whitespace and any non-alphanumeric/hyphen
                return re.sub(r"[^0-9a-z-]", "", n.lower())

            target_norm = _normalize_name(bucket)
            for b in bucket_list:
                # if iterating keys accidentally, skip non-dict
                if not isinstance(b, dict):
                    continue
                name = b.get("name") or ""
                if _normalize_name(name) == target_norm:
                    return account_id

    raise RuntimeError(
        f"Could not find bucket '{bucket}' in any Cloudflare account accessible by this token"
    )


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True)


def aws_head_object(profile: str, endpoint: str, bucket: str, key: str) -> bool:
    result = run(
        [
            "aws",
            "s3api",
            "head-object",
            "--profile",
            profile,
            "--endpoint-url",
            endpoint,
            "--bucket",
            bucket,
            "--key",
            key,
        ]
    )
    return result.returncode == 0


def aws_upload_object(profile: str, endpoint: str, bucket: str, key: str, file_path: Path) -> None:
    result = subprocess.run(
        [
            "aws",
            "s3",
            "cp",
            str(file_path),
            f"s3://{bucket}/{key}",
            "--profile",
            profile,
            "--endpoint-url",
            endpoint,
            "--content-type",
            "video/mp4",
            "--cache-control",
            "public, max-age=31536000, immutable",
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(f"aws s3 cp failed with exit code {result.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Upload a large missing object to the destination R2 bucket using the correct account endpoint. "
            "Discovers the Cloudflare account id via CF API token, then uploads via awscli (multipart)."
        )
    )
    parser.add_argument("--bucket", default="baptiste-videos")
    parser.add_argument("--key", default="2.Organ.Vinyl.mp4")
    parser.add_argument("--source-dir", default="/tmp/baptiste-r2-migration/src")
    parser.add_argument("--aws-profile", default="r2-dest")
    parser.add_argument("--token-env", default="CF_API_TOKEN_DEST")
    parser.add_argument(
        "--public-base-url",
        default="https://pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev",
        help="Used only for the final verification HEAD request.",
    )
    args = parser.parse_args()

    token = os.environ.get(args.token_env)
    if not token:
        print(f"Missing env var: {args.token_env}", file=sys.stderr)
        return 2

    source_dir = Path(args.source_dir)
    file_path = source_dir / args.key
    if not file_path.exists():
        print(f"Missing source file: {file_path}", file=sys.stderr)
        return 2

    try:
        account_id = find_account_id_for_bucket(args.bucket, token)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 2

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    print(f"Destination account id: {account_id}")
    print(f"Destination endpoint: {endpoint}")

    if aws_head_object(args.aws_profile, endpoint, args.bucket, args.key):
        print("Object already exists in destination bucket")
    else:
        print(f"Uploading {args.key} ({file_path.stat().st_size} bytes)...")
        aws_upload_object(args.aws_profile, endpoint, args.bucket, args.key, file_path)

        if not aws_head_object(args.aws_profile, endpoint, args.bucket, args.key):
            print("Upload completed but head-object still fails", file=sys.stderr)
            return 1
        print("Upload verified via S3 head-object")

    public_url = f"{args.public_base_url.rstrip('/')}/{args.key}"
    head = run(["curl", "-I", "-sS", public_url])
    print("Public URL HEAD:")
    print(head.stdout.splitlines()[0] if head.stdout else head.stderr.strip())
    print(public_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
