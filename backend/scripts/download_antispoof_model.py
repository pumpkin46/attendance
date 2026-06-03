#!/usr/bin/env python3
"""Download MiniFASNetV2 anti-spoof ONNX model."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.services.antispoof import AntiSpoofVerifier

if __name__ == "__main__":
    AntiSpoofVerifier()
    print(f"Model ready at: {settings.antispoof_model_path}")
