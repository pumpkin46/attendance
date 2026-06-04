"""Shared fixtures for recognition engine unit tests."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.engine.face_detector import DetectedFace


def _normalize(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    if norm <= 0:
        return vec.astype(np.float32)
    return (vec / norm).astype(np.float32)


@pytest.fixture
def sample_embedding() -> np.ndarray:
    rng = np.random.default_rng(42)
    return _normalize(rng.standard_normal(512).astype(np.float32))


@pytest.fixture
def second_embedding() -> np.ndarray:
    rng = np.random.default_rng(99)
    return _normalize(rng.standard_normal(512).astype(np.float32))


@pytest.fixture
def sample_frame() -> np.ndarray:
    """BGR frame with a textured bright region resembling a face crop."""
    rng = np.random.default_rng(7)
    frame = np.zeros((240, 320, 3), dtype=np.uint8)
    patch = rng.integers(90, 210, size=(120, 120, 3), dtype=np.uint8)
    frame[60:180, 100:220] = patch
    return frame


@pytest.fixture
def make_face():
    def _make(
        *,
        x: float = 100.0,
        y: float = 60.0,
        width: float = 120.0,
        height: float = 120.0,
        confidence: float = 0.95,
        face_id: str = "temp-001",
        embedding: np.ndarray | None = None,
        landmarks: np.ndarray | None = None,
    ) -> DetectedFace:
        if landmarks is None:
            landmarks = np.array(
                [
                    [x + width * 0.3, y + height * 0.35],
                    [x + width * 0.7, y + height * 0.35],
                    [x + width * 0.5, y + height * 0.55],
                    [x + width * 0.35, y + height * 0.75],
                    [x + width * 0.65, y + height * 0.75],
                ],
                dtype=np.float32,
            )
        return DetectedFace(
            face_id=face_id,
            bounding_box={"x": x, "y": y, "width": width, "height": height},
            confidence=confidence,
            landmarks=landmarks,
            embedding=embedding,
        )

    return _make


@pytest.fixture
def temp_faiss_paths(tmp_path, monkeypatch):
    """Isolate FAISS index files per test."""
    index_path = tmp_path / "faiss.index"
    metadata_path = tmp_path / "metadata.json"
    monkeypatch.setattr("app.core.config.settings.index_path", str(index_path))
    monkeypatch.setattr("app.core.config.settings.metadata_path", str(metadata_path))
    return index_path, metadata_path


@pytest.fixture(autouse=True)
def reset_engine_singletons():
    """Reset module-level singletons so tests do not leak state."""
    import app.engine.attendance_generator as attendance_mod
    import app.engine.embedding_generator as embedding_mod
    import app.engine.face_detector as detector_mod
    import app.engine.face_tracker as tracker_mod
    import app.engine.identity_verifier as verifier_mod
    import app.engine.liveness_detector as liveness_mod
    import app.engine.metrics as metrics_mod
    import app.engine.quality_assessor as quality_mod
    import app.engine.recognition_engine as engine_mod
    import app.engine.stream_manager as stream_mod
    import app.engine.unknown_detector as unknown_mod
    import app.engine.vector_search as search_mod

    singleton_attrs = [
        (attendance_mod, "_generator"),
        (embedding_mod, "_generator"),
        (detector_mod, "_detector"),
        (tracker_mod, "_tracker"),
        (verifier_mod, "_verifier"),
        (liveness_mod, "_detector"),
        (metrics_mod, "_metrics"),
        (quality_mod, "_assessor"),
        (engine_mod, "_engine"),
        (stream_mod, "_stream_manager"),
        (unknown_mod, "_detector"),
        (search_mod, "_engine"),
    ]

    originals = {mod: getattr(mod, attr) for mod, attr in singleton_attrs}
    for mod, attr in singleton_attrs:
        setattr(mod, attr, None)

    yield

    for mod, attr in singleton_attrs:
        setattr(mod, attr, originals[mod])
