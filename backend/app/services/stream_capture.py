"""Capture a single JPEG frame from an RTSP/HTTP IP camera stream."""

from __future__ import annotations

import base64
import ipaddress
import socket
import time
from urllib.parse import urlparse

import cv2

ALLOWED_STREAM_SCHEMES = frozenset({"rtsp", "rtsps", "http", "https"})


def validate_stream_url(stream_url: str) -> str | None:
    """Validate a client-supplied stream URL; returns an error message or None.

    cv2.VideoCapture happily opens file paths and arbitrary URLs, which turns
    a raw ``stream_url`` parameter into a blind SSRF/file-read primitive.
    Cameras legitimately live on private (RFC1918) LAN addresses, so those
    stay allowed; loopback, link-local (incl. the 169.254.169.254 cloud
    metadata endpoint), multicast and reserved ranges are rejected. DNS is
    resolved here at validation time — combine with permission gating (these
    endpoints require cameras.manage), not as the sole control.
    """
    parsed = urlparse(stream_url)
    if parsed.scheme.lower() not in ALLOWED_STREAM_SCHEMES:
        return "Unsupported stream scheme - use rtsp(s):// or http(s)://"
    host = parsed.hostname
    if not host:
        return "Stream URL must include a host"
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return "Stream host could not be resolved"
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_unspecified
            or ip.is_reserved
        ):
            return "Stream host resolves to a disallowed address"
    return None


def capture_stream_frame(stream_url: str, warmup_frames: int = 5) -> dict:
    """
    Open stream_url (rtsp://, http://, etc.), grab one frame, return base64 JPEG.
    """
    started = time.perf_counter()

    error = validate_stream_url(stream_url)
    if error is not None:
        return {
            "success": False,
            "error": error,
            "processing_ms": int((time.perf_counter() - started) * 1000),
        }

    cap = cv2.VideoCapture(stream_url)

    if not cap.isOpened():
        return {
            "success": False,
            "error": "Cannot open stream — check URL and network access",
            "processing_ms": int((time.perf_counter() - started) * 1000),
        }

    try:
        for _ in range(max(warmup_frames, 1)):
            cap.grab()

        ok, frame = cap.read()
        if not ok or frame is None:
            return {
                "success": False,
                "error": "Failed to read frame from stream",
                "processing_ms": int((time.perf_counter() - started) * 1000),
            }

        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return {
                "success": False,
                "error": "Failed to encode frame",
                "processing_ms": int((time.perf_counter() - started) * 1000),
            }

        b64 = base64.b64encode(buf.tobytes()).decode("ascii")
        h, w = frame.shape[:2]

        return {
            "success": True,
            "image": f"data:image/jpeg;base64,{b64}",
            "image_width": w,
            "image_height": h,
            "processing_ms": int((time.perf_counter() - started) * 1000),
        }
    finally:
        cap.release()
