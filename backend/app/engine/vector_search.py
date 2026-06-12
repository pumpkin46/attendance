"""
Stage 7: Vector Search — Identity matching via FAISS.

Search Process:
  Embedding → Vector Search → Top 5 Matches → Confidence Ranking

Match Thresholds:
  >= 0.90: Auto Accept
  0.80–0.89: Review Rule
  < 0.80: Unknown Person

Engine: FAISS (Facebook AI Similarity Search)
Alternative: pgvector, Milvus, Qdrant
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum

import numpy as np

from app.engine.config import engine_config
from app.services.faiss_index import FaissIndex

logger = logging.getLogger(__name__)


class MatchAction(Enum):
    AUTO_ACCEPT = "auto_accept"
    REVIEW = "review"
    UNKNOWN = "unknown"


@dataclass
class SearchMatch:
    employee_id: str
    confidence: float
    rank: int

    def to_dict(self) -> dict:
        return {
            "employee_id": self.employee_id,
            "confidence": round(self.confidence, 4),
            "rank": self.rank,
        }


@dataclass
class SearchResult:
    top_match: SearchMatch | None
    matches: list[SearchMatch]
    action: MatchAction
    search_ms: int
    index_size: int

    @property
    def matched(self) -> bool:
        return self.action == MatchAction.AUTO_ACCEPT

    @property
    def employee_id(self) -> str | None:
        return self.top_match.employee_id if self.top_match else None

    @property
    def confidence(self) -> float:
        return self.top_match.confidence if self.top_match else 0.0

    def to_dict(self) -> dict:
        return {
            "matched": self.matched,
            "action": self.action.value,
            "employee_id": self.employee_id,
            "confidence": round(self.confidence, 4),
            "top_matches": [m.to_dict() for m in self.matches],
            "search_ms": self.search_ms,
            "index_size": self.index_size,
        }


class VectorSearchEngine:
    """FAISS-based vector search for face identity matching.

    Reuses the single ``face_service`` index instance rather than opening its
    own. Enrollment writes through ``face_service.get_index()``; if the engine
    held a separate FaissIndex, freshly enrolled employees stayed UNKNOWN on
    the live camera path until a manual /engine/index/reload. Sharing the one
    (now lock-guarded) instance keeps both paths consistent.
    """

    @property
    def index(self) -> FaissIndex:
        from app.services.face_service import get_index

        return get_index()

    def search(self, embedding: np.ndarray) -> SearchResult:
        """Search for matching identity in the FAISS index."""
        t0 = time.perf_counter()
        cfg = engine_config.search
        idx = self.index

        index_size = idx.count()
        if index_size == 0:
            return SearchResult(
                top_match=None,
                matches=[],
                action=MatchAction.UNKNOWN,
                search_ms=int((time.perf_counter() - t0) * 1000),
                index_size=0,
            )

        # Lock-guarded read (normalization + search + id mapping happen
        # atomically inside FaissIndex), so enrollment cannot swap the index
        # mid-search.
        ranked = idx.search_ranked(embedding, cfg.top_k)

        matches = [
            SearchMatch(employee_id=emp_id, confidence=score, rank=rank + 1)
            for rank, (emp_id, score) in enumerate(ranked)
        ]

        seen_employees: set[str] = set()
        unique_matches: list[SearchMatch] = []
        for m in matches:
            if m.employee_id not in seen_employees:
                seen_employees.add(m.employee_id)
                unique_matches.append(m)

        top_match = unique_matches[0] if unique_matches else None
        action = self._determine_action(top_match)

        return SearchResult(
            top_match=top_match,
            matches=unique_matches[:cfg.top_k],
            action=action,
            search_ms=int((time.perf_counter() - t0) * 1000),
            index_size=index_size,
        )

    def _determine_action(self, match: SearchMatch | None) -> MatchAction:
        cfg = engine_config.search
        if match is None:
            return MatchAction.UNKNOWN
        if match.confidence >= cfg.auto_accept_threshold:
            return MatchAction.AUTO_ACCEPT
        if match.confidence >= cfg.review_threshold:
            return MatchAction.REVIEW
        return MatchAction.UNKNOWN

    def add_embedding(self, employee_id: str, embedding: np.ndarray) -> int:
        return self.index.add(employee_id, embedding)

    def add_batch(self, employee_id: str, embeddings: list[np.ndarray]) -> list[int]:
        return self.index.add_batch(employee_id, embeddings)

    def remove_employee(self, employee_id: str) -> None:
        self.index.remove_employee(employee_id)

    def get_stats(self) -> dict:
        idx = self.index
        return {
            "total_embeddings": idx.count(),
            "total_employees": len(idx.employee_to_ids),
            "index_version": idx.version_hash(),
        }

    def reload(self) -> None:
        # Reload the shared face_service index from disk (e.g. after an
        # out-of-process import or a multi-worker peer wrote new embeddings).
        from app.services.face_service import reload_embeddings

        reload_embeddings()


_engine: VectorSearchEngine | None = None


def get_vector_search() -> VectorSearchEngine:
    global _engine
    if _engine is None:
        _engine = VectorSearchEngine()
    return _engine
