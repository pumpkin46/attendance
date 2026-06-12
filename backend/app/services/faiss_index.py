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
    """FAISS flat index with metadata, guarded for concurrent access.

    Recognition searches run on threadpool threads (FastAPI's run_in_threadpool
    / asyncio.to_thread) while enrollment mutates the index from request
    handlers. ``IndexFlat.add`` can reallocate storage and ``remove_employee``
    swaps ``self.index`` wholesale, either of which corrupts a concurrent
    ``search`` (segfault / misidentification). A single reentrant lock
    serializes every mutation, save, and search; saves are atomic (temp file +
    os.replace) so a crash mid-write can never leave the index and metadata
    files out of sync.
    """

    def __init__(self) -> None:
        self.dim = settings.embedding_dim
        self.index_path = Path(settings.index_path)
        self.metadata_path = Path(settings.metadata_path)
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.id_to_employee: dict[int, str] = {}
        self.employee_to_ids: dict[str, list[int]] = {}
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        """Parse and validate disk state into locals, then publish to self.

        reload() runs this over the live singleton, and the files it reads
        may be corrupt or mid-write - exactly the cases it exists to recover
        from. Nothing on ``self`` is assigned until the locals parsed below
        are fully validated, so any exception leaves the prior in-memory
        state untouched (a partial load would pair a populated index with
        empty mappings: every search returns None and the next _save would
        persist the empty mappings, orphaning all prior embeddings).
        """
        if not self.index_path.exists():
            self.index = faiss.IndexFlatIP(self.dim)
            self.id_to_employee = {}
            self.employee_to_ids = {}
            return

        index = faiss.read_index(str(self.index_path))
        id_to_employee: dict[int, str] = {}
        employee_to_ids: dict[str, list[int]] = {}
        if self.metadata_path.exists():
            meta = json.loads(self.metadata_path.read_text())
            id_to_employee = {int(k): v for k, v in meta.get("id_to_employee", {}).items()}
            employee_to_ids = meta.get("employee_to_ids", {})

        ntotal = index.ntotal
        if len(id_to_employee) > ntotal:
            logger.critical(
                "FAISS index and metadata out of sync: index has %d vectors "
                "but metadata maps %d rows (likely crash between the two "
                "atomic replaces; rows may be mismapped). Ignoring mapping "
                "entries with row id >= %d.",
                ntotal,
                len(id_to_employee),
                ntotal,
            )
            id_to_employee = {
                k: v for k, v in id_to_employee.items() if k < ntotal
            }
            employee_to_ids = {
                emp: kept
                for emp, ids in employee_to_ids.items()
                if (kept := [i for i in ids if i < ntotal])
            }
        elif len(id_to_employee) < ntotal:
            # Orphan vectors (rows with no mapping) stay searchable, and a
            # top-1 hit on an orphan returns employee_id=None even when the
            # true match is rank 2 - masking real matches. Rebuild the index
            # from the mapped rows only.
            logger.critical(
                "FAISS index and metadata out of sync: index has %d vectors "
                "but metadata maps only %d rows. Rebuilding index from the "
                "mapped rows and dropping %d orphan vector(s).",
                ntotal,
                len(id_to_employee),
                ntotal - len(id_to_employee),
            )
            index, id_to_employee, employee_to_ids = self._compact_mapped_rows(
                index, id_to_employee
            )

        self.index = index
        self.id_to_employee = id_to_employee
        self.employee_to_ids = employee_to_ids

    def _compact_mapped_rows(
        self, index: faiss.Index, id_to_employee: dict[int, str]
    ) -> tuple[faiss.Index, dict[int, str], dict[str, list[int]]]:
        """Rebuild a flat index keeping only the rows present in the mapping.

        Rows are renumbered compactly in original order. Operates purely on
        its arguments so _load can validate locals before publishing them.
        """
        vectors = []
        new_id_to_employee: dict[int, str] = {}
        new_employee_to_ids: dict[str, list[int]] = {}

        for old_idx in range(index.ntotal):
            emp = id_to_employee.get(old_idx)
            if emp is None:
                continue
            new_idx = len(vectors)
            vectors.append(index.reconstruct(old_idx))
            new_id_to_employee[new_idx] = emp
            new_employee_to_ids.setdefault(emp, []).append(new_idx)

        new_index = faiss.IndexFlatIP(self.dim)
        if vectors:
            new_index.add(np.vstack(vectors).astype(np.float32))
        return new_index, new_id_to_employee, new_employee_to_ids

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
                "id_to_employee": self.id_to_employee,
                "employee_to_ids": self.employee_to_ids,
            })
        )
        os.replace(tmp_meta, self.metadata_path)

    def add(self, employee_id: str, embedding: np.ndarray) -> int:
        with self._lock:
            embedding = embedding.astype(np.float32).reshape(1, -1)
            faiss.normalize_L2(embedding)
            idx = self.index.ntotal
            self.index.add(embedding)
            self.id_to_employee[idx] = employee_id
            self.employee_to_ids.setdefault(employee_id, []).append(idx)
            self._save()
            return idx

    def add_batch(self, employee_id: str, embeddings: list[np.ndarray]) -> list[int]:
        """Replace all embeddings for employee with a new batch.

        Adds the whole batch in one ``index.add`` and saves once, instead of
        one full index+metadata rewrite per embedding.
        """
        with self._lock:
            # Validate and stack the incoming batch BEFORE mutating anything:
            # a ragged or wrong-dimension batch must raise without silently
            # removing the employee's existing embeddings.
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

            start = self.index.ntotal
            self.index.add(arr)
            ids = list(range(start, start + len(embeddings)))
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

            best_idx = int(indices[0][0])
            confidence = float(scores[0][0])
            employee_id = self.id_to_employee.get(best_idx)

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
                faiss_idx = int(indices[0][rank])
                emp_id = self.id_to_employee.get(faiss_idx)
                if emp_id is not None:
                    out.append((emp_id, float(scores[0][rank])))
            return out

    def remove_employee(self, employee_id: str) -> None:
        with self._lock:
            self._remove_employee_locked(employee_id, save=True)

    def _remove_employee_locked(self, employee_id: str, *, save: bool) -> None:
        """Rebuild index without employee (FAISS flat index has no delete).

        Caller must hold self._lock. ``save=False`` lets add_batch reuse this
        without an extra full rewrite (it saves once at the end).
        """
        ids = self.employee_to_ids.pop(employee_id, [])
        if not ids:
            return

        for idx in ids:
            self.id_to_employee.pop(idx, None)

        if self.index.ntotal > 0:
            self.index, self.id_to_employee, self.employee_to_ids = (
                self._compact_mapped_rows(self.index, self.id_to_employee)
            )
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
                    "metadata": {"id_to_employee": {}, "employee_to_ids": {}},
                }

            return {
                "version": self.version_hash(),
                "embedding_count": self.index.ntotal,
                "index_b64": base64.b64encode(self.index_path.read_bytes()).decode("ascii"),
                "metadata": {
                    "id_to_employee": {str(k): v for k, v in self.id_to_employee.items()},
                    "employee_to_ids": self.employee_to_ids,
                },
            }

    def import_bundle(self, index_b64: str, metadata: dict) -> None:
        import base64

        with self._lock:
            index_bytes = base64.b64decode(index_b64)
            tmp_index = self.index_path.with_suffix(self.index_path.suffix + ".tmp")
            tmp_index.write_bytes(index_bytes)
            # Parse before replacing so a corrupt bundle cannot clobber a
            # good on-disk index.
            faiss.read_index(str(tmp_index))
            os.replace(tmp_index, self.index_path)

            tmp_meta = self.metadata_path.with_suffix(self.metadata_path.suffix + ".tmp")
            tmp_meta.write_text(
                json.dumps({
                    "id_to_employee": metadata.get("id_to_employee", {}),
                    "employee_to_ids": metadata.get("employee_to_ids", {}),
                })
            )
            os.replace(tmp_meta, self.metadata_path)
            # Install in memory through the validated load path so a
            # mismatched bundle is caught/normalized the same as a reload.
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
