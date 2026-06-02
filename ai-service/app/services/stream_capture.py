"""Capture a single JPEG frame from an RTSP/HTTP IP camera stream."""

from __future__ import annotations

import base64
import time

import cv2


def capture_stream_frame(stream_url: str, warmup_frames: int = 5) -> dict:
    """
    Open stream_url (rtsp://, http://, etc.), grab one frame, return base64 JPEG.
    """
    started = time.perf_counter()
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
