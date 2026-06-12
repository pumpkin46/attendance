import json
import os
import threading
from pathlib import Path

import faiss
import numpy as np

from app.core.config import settings


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
        if self.index_path.exists():
            self.index = faiss.read_index(str(self.index_path))
            if self.metadata_path.exists():
                meta = json.loads(self.metadata_path.read_text())
                self.id_to_employee = {int(k): v for k, v in meta.get("id_to_employee", {}).items()}
                self.employee_to_ids = meta.get("employee_to_ids", {})
        else:
            self.index = faiss.IndexFlatIP(self.dim)

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
            self._remove_employee_locked(employee_id, save=False)
            if not embeddings:
                self._save()
                return []

            arr = np.vstack([e.astype(np.float32).reshape(1, -1) for e in embeddings])
            faiss.normalize_L2(arr)
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

        if self.index.ntotal == 0:
            if save:
                self._save()
            return

        vectors = []
        new_id_to_employee: dict[int, str] = {}
        new_employee_to_ids: dict[str, list[int]] = {}

        for old_idx in range(self.index.ntotal):
            emp = self.id_to_employee.get(old_idx)
            if emp is None:
                continue
            vec = self.index.reconstruct(old_idx)
            new_idx = len(vectors)
            vectors.append(vec)
            new_id_to_employee[new_idx] = emp
            new_employee_to_ids.setdefault(emp, []).append(new_idx)

        new_index = faiss.IndexFlatIP(self.dim)
        if vectors:
            arr = np.vstack(vectors).astype(np.float32)
            new_index.add(arr)

        self.index = new_index
        self.id_to_employee = new_id_to_employee
        self.employee_to_ids = new_employee_to_ids
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
            os.replace(tmp_index, self.index_path)
            self.index = faiss.read_index(str(self.index_path))
            self.id_to_employee = {int(k): v for k, v in metadata.get("id_to_employee", {}).items()}
            self.employee_to_ids = metadata.get("employee_to_ids", {})
            tmp_meta = self.metadata_path.with_suffix(self.metadata_path.suffix + ".tmp")
            tmp_meta.write_text(
                json.dumps({
                    "id_to_employee": self.id_to_employee,
                    "employee_to_ids": self.employee_to_ids,
                })
            )
            os.replace(tmp_meta, self.metadata_path)

    def reload(self) -> None:
        with self._lock:
            self._load()
