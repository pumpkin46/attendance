"""Capture a single JPEG frame from an RTSP/RTMP/HTTP IP camera stream."""

from __future__ import annotations

import base64
import ipaddress
import logging
import socket
import time
from urllib.parse import urlparse

import cv2

logger = logging.getLogger(__name__)

ALLOWED_STREAM_SCHEMES = frozenset({"rtsp", "rtsps", "rtmp", "rtmps", "http", "https"})

# URL prefixes cv2 opens over the network (via FFmpeg). These captures must
# get explicit open/read timeouts: a dead host otherwise blocks
# VideoCapture.read() indefinitely in a worker thread.
NETWORK_STREAM_PREFIXES = (
    "rtsp://",
    "rtsps://",
    "rtmp://",
    "rtmps://",
    "http://",
    "https://",
)

# Default FFmpeg open/read timeouts (ms) for standalone captures. The engine
# passes its configured StreamConfig values instead of these.
DEFAULT_OPEN_TIMEOUT_MS = 5000
DEFAULT_READ_TIMEOUT_MS = 5000


def is_network_stream_url(url: object) -> bool:
    """True when url is a string with a network stream scheme."""
    return isinstance(url, str) and url.lower().startswith(NETWORK_STREAM_PREFIXES)


def open_network_capture(
    url: str,
    open_timeout_ms: int = DEFAULT_OPEN_TIMEOUT_MS,
    read_timeout_ms: int = DEFAULT_READ_TIMEOUT_MS,
):
    """Open a network stream URL with FFmpeg open/read timeouts.

    The timeouts are open-time parameters: cap.set() after construction
    returns False and leaves no timeout in effect, so they must be passed to
    the constructor. An untimed open is attempted only when this OpenCV build
    rejects the params constructor itself; a timed capture that merely fails
    to open is returned as-is (isOpened() False) for the caller to handle --
    retrying it untimed would just hang on the same dead host.
    """
    params = [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, open_timeout_ms,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC, read_timeout_ms,
    ]
    try:
        return cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)
    except (TypeError, cv2.error, SystemError):
        # Scheme only: stream URLs may embed credentials.
        logger.warning(
            "OpenCV build rejects the timeout-params VideoCapture constructor; "
            "opening %s stream without timeouts",
            url.split("://", 1)[0],
        )
        return cv2.VideoCapture(url)


def validate_stream_url(stream_url: str) -> str | None:
    """Validate a client-supplied stream URL; returns an error message or None.

    cv2.VideoCapture happily opens file paths and arbitrary URLs, which turns
    a raw ``stream_url`` parameter into a blind SSRF/file-read primitive.
    Cameras legitimately live on private (RFC1918) IPv4 LAN addresses, so
    those stay allowed; loopback, link-local (incl. the 169.254.169.254 cloud
    metadata endpoint), multicast, reserved ranges and non-global private
    IPv6 (ULA fc00::/7, incl. the fd00:ec2::254 AWS IPv6 metadata endpoint)
    are rejected. DNS is resolved here at validation time — combine with
    permission gating (these endpoints require cameras.manage), not as the
    sole control.
    """
    try:
        parsed = urlparse(stream_url)
        host = parsed.hostname
    except ValueError:
        # e.g. unmatched bracket ("http://[::1") or bad IPv6 literal.
        return "Invalid stream URL"
    if parsed.scheme.lower() not in ALLOWED_STREAM_SCHEMES:
        return "Unsupported stream scheme - use rtsp(s)://, rtmp(s):// or http(s)://"
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
            or (ip.version == 6 and ip.is_private and not ip.is_global)
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

    # Validation guarantees a network scheme, so the capture is always timed.
    cap = open_network_capture(stream_url)

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
