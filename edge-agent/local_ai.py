"""Local AI service client and embedding sync."""

from __future__ import annotations

from typing import Any

import requests


class LocalAiClient:
    def __init__(self, base_url: str, timeout: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def health(self) -> dict[str, Any]:
        response = requests.get(f"{self.base_url}/health", timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def identify(self, image_b64: str, require_liveness: bool = False) -> dict[str, Any]:
        response = requests.post(
            f"{self.base_url}/api/v1/identify",
            json={"image": image_b64, "require_liveness": require_liveness},
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def capture_stream(self, stream_url: str) -> dict[str, Any]:
        response = requests.post(
            f"{self.base_url}/api/v1/capture-stream",
            json={"stream_url": stream_url},
            timeout=max(self.timeout, 15),
        )
        response.raise_for_status()
        return response.json()

    def import_embeddings(self, index_b64: str, metadata: dict) -> dict[str, Any]:
        response = requests.post(
            f"{self.base_url}/api/v1/embeddings/import",
            json={"index_b64": index_b64, "metadata": metadata},
            timeout=max(self.timeout, 30),
        )
        response.raise_for_status()
        return response.json()

    def reload_embeddings(self) -> dict[str, Any]:
        response = requests.post(
            f"{self.base_url}/api/v1/embeddings/reload",
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()
