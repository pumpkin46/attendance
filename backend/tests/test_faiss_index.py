"""FaissIndex correctness tests (thread-safety / batched-save fix)."""

from __future__ import annotations

import json
import logging
import threading

import numpy as np
import pytest

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
    # EMP1's vectors are gone - its closest is now EMP2 (a different person).
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


def test_reload_embeddings_preserves_instance_identity(temp_faiss_paths):
    """reload must refresh the singleton in place, never swap it out."""
    from app.services import face_service

    idx = face_service.get_index()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])

    result = face_service.reload_embeddings()
    assert result["success"] is True
    assert result["embedding_count"] == 2

    assert face_service.get_index() is idx
    emp, conf = face_service.get_index().search(_vec(1))
    assert emp == "EMP1"
    assert conf > 0.99


def test_enrollment_service_sees_index_reload(temp_faiss_paths):
    """The enrollment service property must track the module singleton."""
    from app.services import face_service
    from app.services.enrollment_service import FaceEnrollmentService

    service = FaceEnrollmentService()
    idx = face_service.get_index()
    assert service.index is idx

    face_service.reload_embeddings()
    assert service.index is idx
    assert service.index is face_service.get_index()


def test_add_batch_bad_dimension_is_exception_safe(temp_faiss_paths):
    """A wrong-dimension batch raises and leaves prior enrollment intact."""
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])

    bad = np.ones(64, dtype=np.float32)
    with pytest.raises(ValueError):
        idx.add_batch("EMP1", [bad, bad])

    # Ragged batches must fail the same way (vstack raises before mutation).
    with pytest.raises(ValueError):
        idx.add_batch("EMP1", [_vec(3), bad])

    assert idx.count() == 2
    emp, conf = idx.search(_vec(1))
    assert emp == "EMP1"
    assert conf > 0.99


def test_load_warns_on_index_metadata_mismatch(temp_faiss_paths, caplog):
    """Metadata claiming more rows than ntotal logs CRITICAL, extras dropped."""
    index_path, metadata_path = temp_faiss_paths
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])

    # Simulate a crash between the two atomic replaces: metadata maps a third
    # row the index file never received.
    meta = json.loads(metadata_path.read_text())
    meta["id_to_employee"]["2"] = "EMP2"
    meta["employee_to_ids"]["EMP2"] = [2]
    metadata_path.write_text(json.dumps(meta))

    with caplog.at_level(logging.CRITICAL, logger="app.services.faiss_index"):
        reloaded = FaissIndex()

    assert any(
        r.levelno == logging.CRITICAL and "out of sync" in r.getMessage()
        for r in caplog.records
    )
    ntotal = reloaded.index.ntotal
    assert all(row < ntotal for row in reloaded.id_to_employee)
    assert "EMP2" not in reloaded.employee_to_ids
    assert reloaded.employee_to_ids["EMP1"] == [0, 1]


def test_load_rebuilds_index_with_orphan_rows(temp_faiss_paths, caplog):
    """Index rows without a mapping are dropped, not left searchable.

    An orphan vector winning rank 1 would return employee_id=None even when
    the true match is rank 2, masking real matches.
    """
    index_path, metadata_path = temp_faiss_paths
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])
    idx.add_batch("EMP2", [_vec(3)])

    # Strip EMP2's mapping: the index file keeps 3 rows, metadata maps 2.
    meta = json.loads(metadata_path.read_text())
    del meta["id_to_employee"]["2"]
    del meta["employee_to_ids"]["EMP2"]
    metadata_path.write_text(json.dumps(meta))

    with caplog.at_level(logging.CRITICAL, logger="app.services.faiss_index"):
        reloaded = FaissIndex()

    assert any(
        r.levelno == logging.CRITICAL and "orphan" in r.getMessage()
        for r in caplog.records
    )
    # The orphan row is gone; a search on its vector resolves to a mapped
    # employee instead of (None, high_score).
    assert reloaded.count() == 2
    assert reloaded.employee_to_ids == {"EMP1": [0, 1]}
    emp, _ = reloaded.search(_vec(3))
    assert emp == "EMP1"


def test_reload_corrupt_metadata_is_exception_safe(temp_faiss_paths):
    """A failed reload raises and leaves the live singleton untouched."""
    from app.services import face_service

    index_path, metadata_path = temp_faiss_paths
    idx = face_service.get_index()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])

    # Mid-write/corrupt metadata: truncated JSON.
    metadata_path.write_text('{"id_to_employee": {"0": "EMP1"')

    with pytest.raises(json.JSONDecodeError):
        face_service.reload_embeddings()

    # Prior in-memory state is intact: searches still resolve.
    assert idx.count() == 2
    assert idx.employee_to_ids == {"EMP1": [0, 1]}
    emp, conf = idx.search(_vec(1))
    assert emp == "EMP1"
    assert conf > 0.99

    # A subsequent save persists the intact mappings, so nothing is orphaned.
    idx.add("EMP2", _vec(3))
    fresh = FaissIndex()
    assert fresh.count() == 3
    assert fresh.search(_vec(1))[0] == "EMP1"
    assert fresh.search(_vec(3))[0] == "EMP2"


def test_reload_corrupt_index_file_is_exception_safe(temp_faiss_paths):
    """A corrupt index file makes reload raise without clearing mappings."""
    index_path, metadata_path = temp_faiss_paths
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])

    index_path.write_bytes(b"not a faiss index")

    with pytest.raises(RuntimeError):
        idx.reload()

    assert idx.count() == 2
    assert idx.employee_to_ids == {"EMP1": [0, 1]}
    emp, conf = idx.search(_vec(2))
    assert emp == "EMP1"
    assert conf > 0.99


def test_import_bundle_mismatched_metadata_is_validated(temp_faiss_paths, caplog):
    """A bundle whose metadata maps rows the index lacks is normalized."""
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])
    bundle = idx.export_bundle()

    tampered = {
        "id_to_employee": dict(bundle["metadata"]["id_to_employee"], **{"2": "GHOST"}),
        "employee_to_ids": dict(bundle["metadata"]["employee_to_ids"], GHOST=[2]),
    }

    with caplog.at_level(logging.CRITICAL, logger="app.services.faiss_index"):
        idx.import_bundle(bundle["index_b64"], tampered)

    assert any(
        r.levelno == logging.CRITICAL and "out of sync" in r.getMessage()
        for r in caplog.records
    )
    assert idx.count() == 2
    assert "GHOST" not in idx.employee_to_ids
    assert all(row < idx.index.ntotal for row in idx.id_to_employee)
    assert idx.search(_vec(1))[0] == "EMP1"


def test_import_bundle_corrupt_index_raises_and_keeps_state(temp_faiss_paths):
    """A corrupt bundle must neither install in memory nor clobber disk."""
    import base64

    index_path, metadata_path = temp_faiss_paths
    idx = FaissIndex()
    idx.add_batch("EMP1", [_vec(1), _vec(2)])

    with pytest.raises(RuntimeError):
        idx.import_bundle(
            base64.b64encode(b"garbage").decode("ascii"),
            {"id_to_employee": {}, "employee_to_ids": {}},
        )

    assert idx.count() == 2
    assert idx.search(_vec(1))[0] == "EMP1"
    # On-disk files still load cleanly.
    assert FaissIndex().count() == 2
