import base64
import io

import cv2
import numpy as np
from PIL import Image


def check_liveness(image_b64: str) -> tuple[bool, float]:
    """
    Lightweight liveness heuristic: blur variance + face size ratio.
    Production deployments should replace with a dedicated anti-spoof model.
    """
    img = _decode_image(image_b64)
    if img is None:
        return False, 0.0

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()

    h, w = gray.shape
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    faces = face_cascade.detectMultiScale(gray, 1.1, 4, minSize=(80, 80))

    if len(faces) == 0:
        return False, 0.0

    x, y, fw, fh = faces[0]
    face_ratio = (fw * fh) / (w * h)
    score = min(1.0, (laplacian_var / 100.0) * 0.5 + min(face_ratio * 10, 0.5))

    passed = laplacian_var > 50 and face_ratio > 0.02 and len(faces) == 1
    return passed, float(score)


def _decode_image(image_b64: str) -> np.ndarray | None:
    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        data = base64.b64decode(image_b64)
        pil = Image.open(io.BytesIO(data)).convert("RGB")
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    except Exception:
        return None
