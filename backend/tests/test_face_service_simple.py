"""Tests for face_service.enroll_simple — the lenient quick-register path."""

from __future__ import annotations

import base64
from unittest.mock import MagicMock

import cv2
import numpy as np
import pytest

from app.services import face_service


def _img_b64(seed: int = 1) -> str:
    rng = np.random.default_rng(seed)
    img = rng.integers(80, 200, size=(480, 640, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode("ascii")


@pytest.fixture
def mock_index(monkeypatch):
    index = MagicMock()
    index.add_batch.side_effect = lambda emp, embs: list(range(len(embs)))
    monkeypatch.setattr(face_service, "get_index", lambda: index)
    return index


@pytest.fixture
def mock_mode(monkeypatch):
    """Force mock mode: no InsightFace, so every decodable image yields one face."""
    monkeypatch.setattr(face_service, "_get_face_app", lambda: None)


def test_face_embedding_accepts_save_enrollment_kwargs():
    """Guards against model/API drift: _save_enrollment builds FaceEmbedding with
    these kwargs (incl. is_active). A missing column here 500s every enroll-* route.
    """
    from app.models.face import FaceEmbedding

    record = FaceEmbedding(
        employee_id=1,
        faiss_id="1",
        pose_type=None,
        quality_score=0.9,
        is_active=True,
    )
    assert record.is_active is True


def test_enroll_simple_rejects_empty():
    result = face_service.enroll_simple("7", [])
    assert result["success"] is False
    assert "No images" in result["error"]


def test_enroll_simple_stores_one_embedding_per_image(mock_mode, mock_index):
    images = [_img_b64(i) for i in range(3)]
    result = face_service.enroll_simple("7", images)

    assert result["success"] is True
    assert result["embeddings_stored"] == 3
    assert result["accepted_count"] == 3
    assert result["rejected_count"] == 0
    assert len(result["faiss_ids"]) == 3
    mock_index.add_batch.assert_called_once()


def test_enroll_simple_single_image_ok(mock_mode, mock_index):
    result = face_service.enroll_simple("7", [_img_b64()])
    assert result["success"] is True
    assert result["embeddings_stored"] == 1


def test_enroll_simple_no_face_when_undetectable(monkeypatch, mock_index):
    # No face in any image -> failure with per-image rejection reasons.
    monkeypatch.setattr(
        face_service,
        "_analyze_image",
        lambda image_b64, employee_id=None: (None, None, 0.0, 0, True, None),
    )
    result = face_service.enroll_simple("7", [_img_b64(), _img_b64(2)])

    assert result["success"] is False
    assert result["rejected_count"] == 2
    assert all(r["reason"] == "no_face" for r in result["rejected"])
    mock_index.add_batch.assert_not_called()


def test_enroll_simple_skips_multiface_keeps_good(monkeypatch, mock_index):
    # First image has two faces (rejected), second is a clean single face (kept).
    calls = {"n": 0}

    def fake_analyze(image_b64, employee_id=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return (None, np.ones(512, dtype=np.float32), 0.9, 2, True, None)
        return (None, np.ones(512, dtype=np.float32), 0.9, 1, True, None)

    monkeypatch.setattr(face_service, "_analyze_image", fake_analyze)
    result = face_service.enroll_simple("7", [_img_b64(), _img_b64(2)])

    assert result["success"] is True
    assert result["embeddings_stored"] == 1
    assert result["accepted_count"] == 1
    assert result["rejected_count"] == 1
    assert result["rejected"][0]["reason"] == "multiple_faces"
