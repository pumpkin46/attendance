import json
import os
from pathlib import Path

import faiss
import numpy as np

from app.core.config import settings


class FaissIndex:
    def __init__(self) -> None:
        self.dim = settings.embedding_dim
        self.index_path = Path(settings.index_path)
        self.metadata_path = Path(settings.metadata_path)
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.id_to_employee: dict[int, str] = {}
        self.employee_to_ids: dict[str, list[int]] = {}
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
        faiss.write_index(self.index, str(self.index_path))
        self.metadata_path.write_text(
            json.dumps({
                "id_to_employee": self.id_to_employee,
                "employee_to_ids": self.employee_to_ids,
            })
        )

    def add(self, employee_id: str, embedding: np.ndarray) -> int:
        embedding = embedding.astype(np.float32).reshape(1, -1)
        faiss.normalize_L2(embedding)
        idx = self.index.ntotal
        self.index.add(embedding)
        self.id_to_employee[idx] = employee_id
        self.employee_to_ids.setdefault(employee_id, []).append(idx)
        self._save()
        return idx

    def add_batch(self, employee_id: str, embeddings: list[np.ndarray]) -> list[int]:
        """Replace all embeddings for employee with a new batch."""
        self.remove_employee(employee_id)
        ids = []
        for emb in embeddings:
            ids.append(self.add(employee_id, emb))
        return ids

    def search(self, embedding: np.ndarray, k: int = 1) -> tuple[str | None, float]:
        if self.index.ntotal == 0:
            return None, 0.0

        embedding = embedding.astype(np.float32).reshape(1, -1)
        faiss.normalize_L2(embedding)
        scores, indices = self.index.search(embedding, min(k, self.index.ntotal))

        best_idx = int(indices[0][0])
        confidence = float(scores[0][0])
        employee_id = self.id_to_employee.get(best_idx)

        return employee_id, confidence

    def remove_employee(self, employee_id: str) -> None:
        """Rebuild index without employee (FAISS flat index does not support delete)."""
        ids = self.employee_to_ids.pop(employee_id, [])
        if not ids:
            return

        for idx in ids:
            self.id_to_employee.pop(idx, None)

        if self.index.ntotal == 0:
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

        self.index = faiss.IndexFlatIP(self.dim)
        if vectors:
            arr = np.vstack(vectors).astype(np.float32)
            self.index.add(arr)

        self.id_to_employee = new_id_to_employee
        self.employee_to_ids = new_employee_to_ids
        self._save()

    def count(self) -> int:
        return self.index.ntotal

    def version_hash(self) -> str:
        import hashlib

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

        index_bytes = base64.b64decode(index_b64)
        self.index_path.write_bytes(index_bytes)
        self.index = faiss.read_index(str(self.index_path))
        self.id_to_employee = {int(k): v for k, v in metadata.get("id_to_employee", {}).items()}
        self.employee_to_ids = metadata.get("employee_to_ids", {})
        self.metadata_path.write_text(
            json.dumps({
                "id_to_employee": self.id_to_employee,
                "employee_to_ids": self.employee_to_ids,
            })
        )

    def reload(self) -> None:
        self._load()
