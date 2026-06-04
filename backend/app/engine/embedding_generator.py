"""
Stage 6: Face Embedding Generation.

Converts detected faces into 512-dimensional normalized feature vectors.

Model: InsightFace (ArcFace backbone)
Output: 512-dimensional normalized embedding (unique face signature)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import numpy as np

from app.engine.config import engine_config
from app.engine.face_detector import DetectedFace

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingResult:
    embedding: np.ndarray
    dimension: int
    normalized: bool
    generation_ms: int
    model: str = "arcface"

    def to_dict(self) -> dict:
        return {
            "dimension": self.dimension,
            "normalized": self.normalized,
            "generation_ms": self.generation_ms,
            "model": self.model,
        }


class EmbeddingGenerator:
    """Generate 512-dimensional face embeddings using ArcFace/InsightFace."""

    def __init__(self) -> None:
        self._dim = engine_config.search.embedding_dim

    def generate(self, face: DetectedFace) -> EmbeddingResult | None:
        """Generate embedding from a detected face."""
        t0 = time.perf_counter()

        if face.embedding is not None:
            embedding = face.embedding.astype(np.float32)
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            return EmbeddingResult(
                embedding=embedding,
                dimension=int(embedding.shape[0]),
                normalized=True,
                generation_ms=int((time.perf_counter() - t0) * 1000),
                model="insightface_arcface",
            )

        if face._raw_face is not None and hasattr(face._raw_face, "embedding"):
            raw_emb = face._raw_face.embedding
            embedding = np.array(raw_emb, dtype=np.float32)
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            return EmbeddingResult(
                embedding=embedding,
                dimension=int(embedding.shape[0]),
                normalized=True,
                generation_ms=int((time.perf_counter() - t0) * 1000),
                model="insightface_arcface",
            )

        return None

    def generate_mock(self, seed: str) -> EmbeddingResult:
        """Generate a deterministic mock embedding for testing."""
        t0 = time.perf_counter()
        rng = np.random.default_rng(abs(hash(seed)) % (2**32))
        vec = rng.standard_normal(self._dim).astype(np.float32)
        embedding = vec / np.linalg.norm(vec)

        return EmbeddingResult(
            embedding=embedding,
            dimension=self._dim,
            normalized=True,
            generation_ms=int((time.perf_counter() - t0) * 1000),
            model="mock",
        )

    def cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two embeddings."""
        a_norm = a / (np.linalg.norm(a) + 1e-8)
        b_norm = b / (np.linalg.norm(b) + 1e-8)
        return float(np.dot(a_norm, b_norm))


_generator: EmbeddingGenerator | None = None


def get_embedding_generator() -> EmbeddingGenerator:
    global _generator
    if _generator is None:
        _generator = EmbeddingGenerator()
    return _generator
