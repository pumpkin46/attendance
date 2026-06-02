"""HTTP client for the central attendance API (edge device endpoints)."""

from __future__ import annotations

import platform
import sys
from typing import Any

import requests

SOFTWARE_VERSION = "1.0.0"


class BackendClient:
    def __init__(self, base_url: str, token: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )
        self.timeout = timeout

    def get_config(self) -> dict[str, Any]:
        return self._get("/api/v1/edge/config")

    def get_embeddings(self, version: str | None = None) -> dict[str, Any]:
        params = {"version": version} if version else None
        return self._get("/api/v1/edge/embeddings", params=params)

    def sync_ack(self, version: str, embedding_count: int) -> dict[str, Any]:
        return self._post(
            "/api/v1/edge/sync-ack",
            {"version": version, "embedding_count": embedding_count},
        )

    def heartbeat(self, frame_rate_fps: float | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "software_version": SOFTWARE_VERSION,
            "metadata": {
                "host": platform.node(),
                "python": sys.version.split()[0],
                "platform": platform.platform(),
            },
        }
        if frame_rate_fps is not None:
            payload["frame_rate_fps"] = round(frame_rate_fps, 2)
        return self._post("/api/v1/edge/heartbeat", payload)

    def report(
        self,
        *,
        matched: bool,
        confidence: float,
        employee_id: int | None = None,
        liveness_passed: bool = True,
        processing_ms: int = 0,
        reason: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "matched": matched,
            "confidence": confidence,
            "liveness_passed": liveness_passed,
            "processing_ms": processing_ms,
        }
        if employee_id is not None:
            payload["employee_id"] = employee_id
        if reason:
            payload["reason"] = reason
        return self._post("/api/v1/edge/report", payload)

    def _get(self, path: str, params: dict | None = None) -> dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}{path}",
            params=params,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}{path}",
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()
