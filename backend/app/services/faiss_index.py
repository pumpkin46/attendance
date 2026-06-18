import json
import logging
import os
import threading
from pathlib import Path

import faiss
import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)


class FaissIndex:
    """FAISS index (IndexIDMap2 over IndexFlatIP) with metadata, guarded for
    concurrent access.

    Every embedding is stored under a stable, never-reused int64 id. Deleting or
    re-enrolling one employee removes only that employee's rows via
    ``remove_ids`` instead of reconstructing all N vectors. The previous flat
    index had no delete, so every mutation rebuilt the entire index in Python
    (``reconstruct`` per row + ``vstack``) under the lock — an O(total
    embeddings) stall on the recognition hot path during routine HR operations.

    Recognition searches run on threadpool threads (run_in_threadpool /
    asyncio.to_thread) while enrollment mutates the index from request handlers.
    A single reentrant lock serializes every mutation, save, and search; saves
    are atomic (temp file + os.replace) so a crash mid-write can never leave the
    index and metadata files out of sync.
    """

    def __init__(self) -> None:
        self.dim = settings.embedding_dim
        self.index_path = Path(settings.index_path)
        self.metadata_path = Path(settings.metadata_path)
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.id_to_employee: dict[int, str] = {}
        self.employee_to_ids: dict[str, list[int]] = {}
        # Monotonic id allocator. Ids are never reused (a stale search result
        # must never resolve to a different employee), so this only increases.
        self._next_id = 0
        self._lock = threading.RLock()
        self._load()

    def _new_index(self) -> faiss.Index:
        return faiss.IndexIDMap2(faiss.IndexFlatIP(self.dim))

    @staticmethod
    def _present_ids(index: faiss.Index) -> set[int]:
        """The set of ids currently stored in an IDMap index."""
        if index.ntotal == 0:
            return set()
        return {int(i) for i in faiss.vector_to_array(index.id_map)}

    def _wrap_legacy(self, flat: faiss.Index) -> faiss.Index:
        """Migrate a pre-IDMap flat index by wrapping it in an IndexIDMap2.

        Ids are assigned as the original row positions (0..ntotal-1) so the
        existing ``id_to_employee`` metadata (which keyed on row position) stays
        valid. One-time O(N) cost on the first load after the upgrade.
        """
        new = self._new_index()
        n = flat.ntotal
        if n > 0:
            vectors = np.ascontiguousarray(flat.reconstruct_n(0, n), dtype=np.float32)
            ids = np.arange(n, dtype=np.int64)
            new.add_with_ids(vectors, ids)
        return new

    def _load(self) -> None:
        """Parse and validate disk state into locals, then publish to self.

        reload() runs this over the live singleton, and the files it reads may
        be corrupt or mid-write — exactly the cases it exists to recover from.
        Nothing on ``self`` is assigned until the parsed locals are validated,
        so any exception leaves the prior in-memory state untouched.
        """
        if not self.index_path.exists():
            self.index = self._new_index()
            self.id_to_employee = {}
            self.employee_to_ids = {}
            self._next_id = 0
            return

        index = faiss.read_index(str(self.index_path))
        id_to_employee: dict[int, str] = {}
        employee_to_ids: dict[str, list[int]] = {}
        persisted_next_id = 0
        if self.metadata_path.exists():
            meta = json.loads(self.metadata_path.read_text())
            id_to_employee = {int(k): v for k, v in meta.get("id_to_employee", {}).items()}
            employee_to_ids = {
                k: [int(i) for i in v] for k, v in meta.get("employee_to_ids", {}).items()
            }
            persisted_next_id = int(meta.get("next_id", 0))

        # Migrate a legacy plain-flat index (written before the IDMap switch).
        if not isinstance(index, faiss.IndexIDMap):
            index = self._wrap_legacy(index)

        present = self._present_ids(index)
        mapped = set(id_to_employee)

        # Metadata references ids the index does not contain (e.g. a crash
        # between the two atomic replaces): drop those mapping entries.
        missing = mapped - present
        if missing:
            logger.critical(
                "FAISS index and metadata out of sync: metadata maps %d id(s) "
                "absent from the index (e.g. %s); dropping them.",
                len(missing), sorted(missing)[:5],
            )
            id_to_employee = {k: v for k, v in id_to_employee.items() if k in present}
            employee_to_ids = {
                emp: kept
                for emp, ids in employee_to_ids.items()
                if (kept := [i for i in ids if i in present])
            }
            mapped = set(id_to_employee)

        # Index rows with no mapping (orphans) would win a search and return
        # employee_id=None, masking the true rank-2 match. Remove them.
        orphans = present - mapped
        if orphans:
            logger.critical(
                "FAISS index has %d orphan vector(s) with no metadata mapping "
                "(e.g. %s); removing them so they cannot mask a real match.",
                len(orphans), sorted(orphans)[:5],
            )
            index.remove_ids(faiss.IDSelectorBatch(np.array(sorted(orphans), dtype=np.int64)))

        self.index = index
        self.id_to_employee = id_to_employee
        self.employee_to_ids = employee_to_ids
        # Never hand out an id at or below any id ever seen (present, mapped, or
        # the persisted high-water mark) so removed ids are not reused.
        self._next_id = max([*present, *mapped, persisted_next_id - 1]) + 1

    def _save(self) -> None:
        """Persist index + metadata atomically (temp file + os.replace).

        Each file is written to a sibling temp path then renamed, so a reader
        always sees a complete file and the two never disagree after a crash.
        """
        tmp_index = self.index_path.with_suffix(self.index_path.suffix + ".tmp")
        faiss.write_index(self.index, str(tmp_index))
        os.replace(tmp_index, self.index_path)

        tmp_meta = self.metadata_path.with_suffix(self.metadata_path.suffix + ".tmp")
        tmp_meta.write_text(
            json.dumps({
                "id_to_employee": {str(k): v for k, v in self.id_to_employee.items()},
                "employee_to_ids": self.employee_to_ids,
                "next_id": self._next_id,
            })
        )
        os.replace(tmp_meta, self.metadata_path)

    def add(self, employee_id: str, embedding: np.ndarray) -> int:
        with self._lock:
            embedding = embedding.astype(np.float32).reshape(1, -1)
            faiss.normalize_L2(embedding)
            new_id = self._next_id
            self._next_id += 1
            self.index.add_with_ids(embedding, np.array([new_id], dtype=np.int64))
            self.id_to_employee[new_id] = employee_id
            self.employee_to_ids.setdefault(employee_id, []).append(new_id)
            self._save()
            return new_id

    def add_batch(self, employee_id: str, embeddings: list[np.ndarray]) -> list[int]:
        """Replace all embeddings for employee with a new batch.

        Removes the employee's existing rows via ``remove_ids`` (only their own
        vectors, not the whole index) then adds the new batch and saves once.
        """
        with self._lock:
            # Validate and stack the incoming batch BEFORE mutating anything: a
            # ragged or wrong-dimension batch must raise without first removing
            # the employee's existing embeddings.
            arr = None
            if embeddings:
                arr = np.vstack([e.astype(np.float32).reshape(1, -1) for e in embeddings])
                if arr.shape[1] != self.dim:
                    raise ValueError(
                        f"Embedding dimension {arr.shape[1]} does not match "
                        f"index dimension {self.dim}"
                    )
                faiss.normalize_L2(arr)

            self._remove_employee_locked(employee_id, save=False)
            if arr is None:
                self._save()
                return []

            ids = list(range(self._next_id, self._next_id + len(embeddings)))
            self._next_id += len(embeddings)
            self.index.add_with_ids(arr, np.array(ids, dtype=np.int64))
            for idx in ids:
                self.id_to_employee[idx] = employee_id
            self.employee_to_ids.setdefault(employee_id, []).extend(ids)
            self._save()
            return ids

    def search(self, embedding: np.ndarray, k: int = 1) -> tuple[str | None, float]:
        with self._lock:
            if self.index.ntotal == 0:
                return None, 0.0

            embedding = embedding.astype(np.float32).reshape(1, -1)
            faiss.normalize_L2(embedding)
            scores, indices = self.index.search(embedding, min(k, self.index.ntotal))

            best_id = int(indices[0][0])
            confidence = float(scores[0][0])
            employee_id = self.id_to_employee.get(best_id)

            return employee_id, confidence

    def search_ranked(self, embedding: np.ndarray, k: int) -> list[tuple[str, float]]:
        """Top-k (employee_id, confidence) under the lock, best first.

        The engine's vector search previously read ``self.index``/
        ``id_to_employee`` directly, bypassing the lock while enrollment could
        swap the index out from under it. Routing through here keeps that read
        serialized with mutations.
        """
        with self._lock:
            n = self.index.ntotal
            if n == 0:
                return []
            emb = embedding.astype(np.float32).reshape(1, -1)
            faiss.normalize_L2(emb)
            kk = min(k, n)
            scores, indices = self.index.search(emb, kk)
            out: list[tuple[str, float]] = []
            for rank in range(kk):
                faiss_id = int(indices[0][rank])
                emp_id = self.id_to_employee.get(faiss_id)
                if emp_id is not None:
                    out.append((emp_id, float(scores[0][rank])))
            return out

    def remove_employee(self, employee_id: str) -> None:
        with self._lock:
            self._remove_employee_locked(employee_id, save=True)

    def _remove_employee_locked(self, employee_id: str, *, save: bool) -> None:
        """Remove an employee's vectors by id (no whole-index rebuild).

        Caller must hold self._lock. ``save=False`` lets add_batch reuse this
        without an extra save (it saves once at the end).
        """
        ids = self.employee_to_ids.pop(employee_id, [])
        if not ids:
            return

        for idx in ids:
            self.id_to_employee.pop(idx, None)
        self.index.remove_ids(faiss.IDSelectorBatch(np.array(ids, dtype=np.int64)))
        if save:
            self._save()

    def count(self) -> int:
        with self._lock:
            return self.index.ntotal

    def version_hash(self) -> str:
        import hashlib

        with self._lock:
            if not self.index_path.exists():
                return hashlib.sha256(b"empty").hexdigest()[:16]

            digest = hashlib.sha256()
            digest.update(self.index_path.read_bytes())
            if self.metadata_path.exists():
                digest.update(self.metadata_path.read_bytes())
            return digest.hexdigest()[:16]

    def export_bundle(self) -> dict:
        import base64
        import hashlib

        with self._lock:
            if not self.index_path.exists() or self.index.ntotal == 0:
                return {
                    "version": hashlib.sha256(b"empty").hexdigest()[:16],
                    "embedding_count": 0,
                    "index_b64": None,
                    "metadata": {"id_to_employee": {}, "employee_to_ids": {}, "next_id": self._next_id},
                }

            return {
                "version": self.version_hash(),
                "embedding_count": self.index.ntotal,
                "index_b64": base64.b64encode(self.index_path.read_bytes()).decode("ascii"),
                "metadata": {
                    "id_to_employee": {str(k): v for k, v in self.id_to_employee.items()},
                    "employee_to_ids": self.employee_to_ids,
                    "next_id": self._next_id,
                },
            }

    def import_bundle(self, index_b64: str, metadata: dict) -> None:
        import base64

        with self._lock:
            index_bytes = base64.b64decode(index_b64)
            tmp_index = self.index_path.with_suffix(self.index_path.suffix + ".tmp")
            tmp_index.write_bytes(index_bytes)
            # Parse before replacing so a corrupt bundle cannot clobber a good
            # on-disk index.
            faiss.read_index(str(tmp_index))
            os.replace(tmp_index, self.index_path)

            tmp_meta = self.metadata_path.with_suffix(self.metadata_path.suffix + ".tmp")
            tmp_meta.write_text(
                json.dumps({
                    "id_to_employee": metadata.get("id_to_employee", {}),
                    "employee_to_ids": metadata.get("employee_to_ids", {}),
                    "next_id": metadata.get("next_id", 0),
                })
            )
            os.replace(tmp_meta, self.metadata_path)
            # Install in memory through the validated load path so a mismatched
            # bundle is caught/normalized the same as a reload.
            self._load()

    def reload(self) -> None:
        with self._lock:
            try:
                self._load()
            except Exception:
                logger.exception(
                    "FAISS reload failed; previous in-memory index state kept"
                )
                raise
