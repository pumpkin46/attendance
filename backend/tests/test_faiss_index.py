"""FaissIndex correctness tests (thread-safety / batched-save fix)."""

from __future__ import annotations

import threading

import numpy as np

from app.services.faiss_index import FaissIndex


def _vec(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(512).astype(np.float32)
    return v / np.linalg.norm(v)


def test_add_batch_replaces_and_persists(temp_faiss_paths):
    idx = FaissIndex()
    ids = idx.add_batch("EMP1", [_vec(1), _vec(2), _vec(3)])
    assert len(ids) == 3
    assert idx.count() == 3

    # Re-enroll replaces the old set rather than appending.
    ids2 = idx.add_batch("EMP1", [_vec(4), _vec(5)])
    assert len(ids2) == 2
    assert idx.count() == 2

    # Reload from disk: the single atomic save persisted index + metadata.
    reloaded = FaissIndex()
    assert reloaded.count() == 2
    emp, conf = reloaded.search(_vec(4))
    assert emp == "EMP1"
    assert conf > 0.99


def test_add_batch_empty_clears_employee(temp_faiss_paths):
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])
    idx.add_batch("EMP2", [_vec(3)])

    assert idx.add_batch("EMP1", []) == []
    assert idx.count() == 1
    emp, _ = idx.search(_vec(3))
    assert emp == "EMP2"


def test_remove_employee_reindexes(temp_faiss_paths):
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])
    idx.add_batch("EMP2", [_vec(3), _vec(4)])
    idx.remove_employee("EMP1")

    assert idx.count() == 2
    emp, conf = idx.search(_vec(3))
    assert emp == "EMP2"
    assert conf > 0.99
    # EMP1's vectors are gone — its closest is now EMP2 (a different person).
    emp_after, _ = idx.search(_vec(1))
    assert emp_after == "EMP2"


def test_concurrent_search_during_mutation_is_safe(temp_faiss_paths):
    """Searching from many threads while enrollment mutates must not crash."""
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(i) for i in range(10)])

    errors: list[Exception] = []
    stop = threading.Event()

    def searcher():
        while not stop.is_set():
            try:
                idx.search(_vec(99))
            except Exception as e:  # pragma: no cover - failure path
                errors.append(e)
                return

    threads = [threading.Thread(target=searcher) for _ in range(8)]
    for t in threads:
        t.start()
    try:
        for n in range(30):
            idx.add_batch(f"EMP{n % 5}", [_vec(100 + n), _vec(200 + n)])
            idx.remove_employee(f"EMP{(n + 1) % 5}")
    finally:
        stop.set()
        for t in threads:
            t.join(timeout=5)

    assert errors == []
