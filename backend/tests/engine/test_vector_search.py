"""Tests for FAISS vector search engine."""

import numpy as np

from app.engine.config import engine_config
from app.engine.vector_search import MatchAction, SearchMatch, VectorSearchEngine


def test_search_empty_index(temp_faiss_paths, sample_embedding):
    engine = VectorSearchEngine()
    result = engine.search(sample_embedding)

    assert result.action == MatchAction.UNKNOWN
    assert result.top_match is None
    assert result.index_size == 0


def test_determine_action_thresholds():
    engine = VectorSearchEngine()
    # Calibrated for ArcFace: auto-accept >= 0.5, review [0.4, 0.5), unknown < 0.4.
    assert engine._determine_action(SearchMatch("1", 0.62, 1)) == MatchAction.AUTO_ACCEPT
    assert engine._determine_action(SearchMatch("1", 0.45, 1)) == MatchAction.REVIEW
    assert engine._determine_action(SearchMatch("1", 0.30, 1)) == MatchAction.UNKNOWN
    assert engine._determine_action(None) == MatchAction.UNKNOWN


def test_search_finds_enrolled_employee(temp_faiss_paths, sample_embedding):
    engine = VectorSearchEngine()
    engine.add_embedding("EMP001", sample_embedding)

    result = engine.search(sample_embedding)

    assert result.action == MatchAction.AUTO_ACCEPT
    assert result.employee_id == "EMP001"
    assert result.confidence >= engine_config.search.auto_accept_threshold
    assert result.matched is True


def test_search_review_band(temp_faiss_paths, sample_embedding, second_embedding):
    engine = VectorSearchEngine()
    engine.add_embedding("EMP001", sample_embedding)

    original = engine_config.search.auto_accept_threshold
    engine_config.search.auto_accept_threshold = 0.999

    try:
        result = engine.search(second_embedding)
        assert result.action in (MatchAction.REVIEW, MatchAction.UNKNOWN)
    finally:
        engine_config.search.auto_accept_threshold = original


def test_remove_employee(temp_faiss_paths, sample_embedding):
    engine = VectorSearchEngine()
    engine.add_embedding("EMP001", sample_embedding)
    engine.remove_employee("EMP001")

    stats = engine.get_stats()
    assert stats["total_embeddings"] == 0
    assert stats["total_employees"] == 0


def test_search_result_to_dict(temp_faiss_paths, sample_embedding):
    engine = VectorSearchEngine()
    engine.add_embedding("EMP001", sample_embedding)
    payload = engine.search(sample_embedding).to_dict()

    assert payload["matched"] is True
    assert payload["employee_id"] == "EMP001"
    assert "top_matches" in payload
    assert payload["search_ms"] >= 0
