"""Anti-spoof model supply-chain guard: the auto-downloaded ONNX model is
verified against a pinned SHA-256 before it is ever loaded/executed."""

from __future__ import annotations

import hashlib

from app.services.antispoof import AntiSpoofVerifier


def _verifier(monkeypatch) -> AntiSpoofVerifier:
    # antispoof_enabled=False keeps __init__ from downloading/loading the real
    # model so we can exercise _verify_checksum in isolation.
    monkeypatch.setattr("app.core.config.settings.antispoof_enabled", False)
    return AntiSpoofVerifier()


def test_checksum_rejects_tampered_model(tmp_path, monkeypatch):
    v = _verifier(monkeypatch)
    blob = b"not the real model"
    monkeypatch.setattr("app.core.config.settings.antispoof_model_sha256", "0" * 64)
    bad = tmp_path / "m.onnx"
    bad.write_bytes(blob)
    assert v._verify_checksum(bad) is False


def test_checksum_accepts_matching_model(tmp_path, monkeypatch):
    v = _verifier(monkeypatch)
    blob = b"trusted bytes"
    digest = hashlib.sha256(blob).hexdigest()
    monkeypatch.setattr("app.core.config.settings.antispoof_model_sha256", digest)
    good = tmp_path / "m.onnx"
    good.write_bytes(blob)
    assert v._verify_checksum(good) is True


def test_empty_pinned_hash_disables_verification(tmp_path, monkeypatch):
    v = _verifier(monkeypatch)
    monkeypatch.setattr("app.core.config.settings.antispoof_model_sha256", "")
    any_file = tmp_path / "m.onnx"
    any_file.write_bytes(b"whatever")
    assert v._verify_checksum(any_file) is True
