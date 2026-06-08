"""Manual driver: prove the enrollment capture fixes end-to-end.

Run:  venv/Scripts/python.exe scripts/verify_enrollment_capture.py

1. Drives the REAL FastAPI app over HTTP (TestClient) and POSTs images the size
   the frontend produces before/after the fix to /api/v1/enrollment/validate-image,
   showing the resolution gate no longer rejects native-res webcam frames.
2. Drives the REAL quality pipeline (validate_face_image) with a soft, webcam-like
   face crop to show the relaxed blur floor (0.25) accepts it where 0.35 rejected.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _jpeg_data_url(img: np.ndarray, quality: int) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def _textured_frame(w: int, h: int) -> np.ndarray:
    """A frame with a bright textured 'face' region (passes detection-free gates)."""
    rng = np.random.default_rng(7)
    frame = np.full((h, w, 3), 30, dtype=np.uint8)
    fw, fh = int(w * 0.35), int(h * 0.6)
    fx, fy = (w - fw) // 2, (h - fh) // 2
    patch = rng.integers(90, 210, size=(fh, fw, 3), dtype=np.uint8)
    frame[fy : fy + fh, fx : fx + fw] = patch
    return frame


def http_resolution_check() -> None:
    print("\n=== 1. HTTP /enrollment/validate-image - resolution gate ===")
    from fastapi.testclient import TestClient

    from app.core.dependencies import get_current_user
    from main import app

    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=1, organization_id=1, is_active=True,
        has_role=lambda r: True, has_permission=lambda p: True,
    )
    try:
        with TestClient(app) as client:
            for label, (w, h, q) in {
                "OLD capture 640x360 @ q85": (640, 360, 85),
                "NEW capture 1280x720 @ q95": (1280, 720, 95),
            }.items():
                img = _textured_frame(w, h)
                resp = client.post(
                    "/api/v1/enrollment/validate-image",
                    json={"image": _jpeg_data_url(img, q), "expected_pose": "front"},
                )
                data = resp.json()
                print(
                    f"  {label:30s} -> HTTP {resp.status_code} "
                    f"reason={data.get('reason')!r} accepted={data.get('accepted')}"
                )
    finally:
        app.dependency_overrides.clear()


def blur_threshold_check() -> None:
    print("\n=== 2. Real validate_face_image - blur floor (0.35 -> 0.25) ===")
    from app.core.config import settings
    from app.services.face_metrics import blur_score
    from app.services.face_quality import validate_face_image

    # Build a 1280x720 frame with a softened (webcam-like) textured face crop.
    # Sharpness falls off steeply with blur, so sweep sigma to land the crop in
    # the realistic webcam band (blur_score ~0.30, between the 0.25 and 0.35 floors).
    rng = np.random.default_rng(11)
    fx, fy, fw, fh = 470, 160, 340, 400
    base = rng.integers(70, 200, size=(fh, fw, 3), dtype=np.uint8)

    img = None
    score = 0.0
    for sigma in [round(s, 2) for s in np.arange(0.6, 2.0, 0.05)]:
        patch = cv2.GaussianBlur(base, (0, 0), sigma)
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        score = blur_score(gray, settings.quality_blur_variance_ref)
        if score <= 0.33:
            img = np.full((720, 1280, 3), 30, dtype=np.uint8)
            img[fy : fy + fh, fx : fx + fw] = patch
            print(f"  soft face-crop blur_score = {score:.3f} "
                  f"(variance~{score * settings.quality_blur_variance_ref:.0f}, sigma={sigma})")
            break

    # Stub face: bbox + det_score + 5 landmarks the quality path reads.
    cx, cy = fx + fw / 2, fy + fh / 2
    kps = np.array(
        [[fx + fw * 0.32, fy + fh * 0.38], [fx + fw * 0.68, fy + fh * 0.38],
         [cx, cy], [fx + fw * 0.36, fy + fh * 0.72], [fx + fw * 0.64, fy + fh * 0.72]],
        dtype=np.float32,
    )
    face = SimpleNamespace(bbox=np.array([fx, fy, fx + fw, fy + fh], dtype=np.float32),
                           det_score=0.9, kps=kps)

    for thr in (0.35, 0.25):
        settings.quality_min_blur_score = thr
        res = validate_face_image(img, [face], expected_pose=None)
        verdict = "ACCEPTED" if res["accepted"] else f"REJECTED ({res['reason']})"
        print(f"  blur floor {thr:.2f} -> {verdict}")


if __name__ == "__main__":
    http_resolution_check()
    blur_threshold_check()
    print("\nDone.")
