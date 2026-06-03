#!/usr/bin/env python3
"""
Test face enrollment + recognition with a local image.

Usage:
  python scripts/test-face.py path/to/photo.jpg
  python scripts/test-face.py path/to/photo.jpg --employee-id 1

Requires: backend on http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

try:
    import urllib.request
    import urllib.error
except ImportError:
    pass

API_BASE = "http://127.0.0.1:8000/api/v1"
SERVICE_BASE = "http://127.0.0.1:8000"
EMAIL = "admin@attendance.local"
PASSWORD = "password"


def request(method: str, url: str, data: dict | None = None, token: str | None = None) -> dict:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"HTTP {e.code}: {err}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection failed: {e.reason}", file=sys.stderr)
        sys.exit(1)


def image_to_base64(path: Path) -> str:
    raw = path.read_bytes()
    b64 = base64.b64encode(raw).decode()
    ext = path.suffix.lower()
    mime = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp"}.get(ext, "jpeg")
    return f"data:image/{mime};base64,{b64}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Test face enroll + identify")
    parser.add_argument("image", type=Path, help="Path to face photo (jpg/png)")
    parser.add_argument("--employee-id", type=int, default=1, help="Employee ID (default: 1)")
    parser.add_argument("--ai-only", action="store_true", help="Test recognition endpoints only (no auth)")
    args = parser.parse_args()

    if not args.image.is_file():
        print(f"File not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    image_b64 = image_to_base64(args.image)
    emp_id = str(args.employee_id)

    print("1. Service health...")
    health = request("GET", f"{SERVICE_BASE}/health")
    print(f"   {json.dumps(health, indent=2)}")

    if args.ai_only:
        print("\n2. Enroll (AI direct)...")
        enroll = request("POST", f"{API_BASE}/enroll", {
            "employee_id": emp_id,
            "image": image_b64,
        })
        print(f"   {json.dumps(enroll, indent=2)}")

        print("\n3. Identify (AI direct)...")
        identify = request("POST", f"{API_BASE}/identify", {
            "image": image_b64,
            "require_liveness": True,
        })
        print(f"   {json.dumps(identify, indent=2)}")
        return

    print("\n2. Login...")
    login = request("POST", f"{API_BASE}/auth/login", {"email": EMAIL, "password": PASSWORD})
    token = login["token"]
    print(f"   Logged in as {login['user']['name']}")

    print("\n3. Enroll face (API → AI)...")
    enroll = request("POST", f"{API_BASE}/employees/{args.employee_id}/enroll-face", {
        "image": image_b64,
    }, token=token)
    print(f"   {json.dumps(enroll, indent=2)}")

    print("\n4. Face status...")
    status = request("GET", f"{API_BASE}/employees/{args.employee_id}/face-status", token=token)
    print(f"   {json.dumps(status, indent=2)}")

    print("\n5. Recognize + auto attendance...")
    identify = request("POST", f"{API_BASE}/recognition/identify", {
        "image": image_b64,
        "require_liveness": True,
    }, token=token)
    print(f"   {json.dumps(identify, indent=2)}")

    if identify.get("matched"):
        print("\n6. Today's attendance...")
        today = request("GET", f"{API_BASE}/attendance/today", token=token)
        print(f"   Present: {today.get('present')}, records: {len(today.get('records', []))}")
    else:
        print("\n   Tip: If liveness_failed, retry with a sharper photo or test AI with --ai-only")


if __name__ == "__main__":
    main()
