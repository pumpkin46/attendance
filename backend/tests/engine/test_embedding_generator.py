"""Tests for embedding generation."""

import numpy as np
import pytest

from app.engine.embedding_generator import EmbeddingGenerator


def test_generate_from_face_embedding(make_face, sample_embedding):
    generator = EmbeddingGenerator()
    face = make_face(embedding=sample_embedding)

    result = generator.generate(face)

    assert result is not None
    assert result.dimension == 512
    assert result.normalized is True
    assert np.isclose(np.linalg.norm(result.embedding), 1.0, atol=1e-5)


def test_generate_returns_none_without_embedding(make_face):
    generator = EmbeddingGenerator()
    face = make_face(embedding=None)

    assert generator.generate(face) is None


def test_generate_mock_embedding():
    generator = EmbeddingGenerator()
    result = generator.generate_mock("employee-42")

    assert result.dimension == 512
    assert result.model == "mock"
    assert np.isclose(np.linalg.norm(result.embedding), 1.0, atol=1e-5)


def test_cosine_similarity_identical_vectors(sample_embedding):
    generator = EmbeddingGenerator()
    score = generator.cosine_similarity(sample_embedding, sample_embedding)
    assert score == pytest.approx(1.0, abs=1e-5)


def test_cosine_similarity_orthogonal_vectors():
    generator = EmbeddingGenerator()
    a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    b = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    score = generator.cosine_similarity(a, b)
    assert score == pytest.approx(0.0, abs=1e-5)
