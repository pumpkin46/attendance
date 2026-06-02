#!/usr/bin/env python3
"""
Edge AI camera agent — runs on-site (Jetson, NUC, Raspberry Pi, etc.).

Captures frames locally, runs face recognition via local ai-service,
and reports match results to the central Laravel API (no images uploaded).
"""

from __future__ import annotations

import logging
import os
import time

from backend_client import BackendClient, SOFTWARE_VERSION
from local_ai import LocalAiClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("edge-agent")

BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000")
DEVICE_TOKEN = os.environ.get("EDGE_DEVICE_TOKEN", "")
LOCAL_AI_URL = os.environ.get("LOCAL_AI_URL", "http://127.0.0.1:8001")
STREAM_URL = os.environ.get("STREAM_URL", "")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
SYNC_INTERVAL = float(os.environ.get("SYNC_INTERVAL_SECONDS", "300"))


def sync_embeddings(backend: BackendClient, local_ai: LocalAiClient, current_version: str | None) -> str | None:
    bundle = backend.get_embeddings(current_version)

    if bundle.get("unchanged"):
        log.info("Embeddings unchanged (version=%s)", bundle.get("version"))
        return bundle.get("version")

    if not bundle.get("index_b64"):
        log.warning("No embeddings to sync yet")
        return bundle.get("version")

    log.info(
        "Syncing %s embeddings (version=%s)",
        bundle.get("embedding_count", 0),
        bundle.get("version"),
    )
    local_ai.import_embeddings(bundle["index_b64"], bundle.get("metadata", {}))
    backend.sync_ack(bundle["version"], int(bundle.get("embedding_count", 0)))
    log.info("Embedding sync complete")
    return bundle.get("version")


def run_cycle(
    backend: BackendClient,
    local_ai: LocalAiClient,
    config: dict,
    threshold: float,
) -> float | None:
    stream_url = config.get("stream_url") or STREAM_URL
    if not stream_url:
        log.warning("No stream_url configured — skipping capture")
        return None

    require_liveness = bool(config.get("require_liveness", False))
    threshold = float(config.get("recognition_threshold") or threshold)

    t0 = time.perf_counter()
    capture = local_ai.capture_stream(stream_url)
    if not capture.get("success", True) or not capture.get("image"):
        log.error("Stream capture failed")
        return None

    identify = local_ai.identify(capture["image"], require_liveness=require_liveness)
    processing_ms = int(identify.get("processing_ms") or (time.perf_counter() - t0) * 1000)

    employee_id = identify.get("employee_id")
    confidence = float(identify.get("confidence") or 0)
    liveness_passed = bool(identify.get("liveness_passed", True))
    matched = employee_id is not None and confidence >= threshold and liveness_passed

    if require_liveness and not liveness_passed:
        log.info("Liveness failed (%.3f ms)", processing_ms)
        backend.report(
            matched=False,
            confidence=confidence,
            liveness_passed=False,
            processing_ms=processing_ms,
            reason=identify.get("liveness_reason", "liveness_failed"),
        )
        return time.perf_counter() - t0

    if matched:
        result = backend.report(
            matched=True,
            confidence=confidence,
            employee_id=int(employee_id),
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
        )
        action = (result.get("attendance") or {}).get("action", "ok")
        emp = result.get("employee", {})
        name = f"{emp.get('first_name', '')} {emp.get('last_name', '')}".strip()
        log.info("Matched %s confidence=%.3f action=%s (%dms)", name, confidence, action, processing_ms)
    else:
        reason = "unknown" if not employee_id else "low_confidence"
        backend.report(
            matched=False,
            confidence=confidence,
            employee_id=int(employee_id) if employee_id else None,
            liveness_passed=liveness_passed,
            processing_ms=processing_ms,
            reason=reason,
        )
        log.info("No match (%s, confidence=%.3f, %dms)", reason, confidence, processing_ms)

    return time.perf_counter() - t0


def main() -> None:
    if not DEVICE_TOKEN:
        raise SystemExit("EDGE_DEVICE_TOKEN is required")

    backend = BackendClient(BACKEND_URL, DEVICE_TOKEN)
    local_ai = LocalAiClient(LOCAL_AI_URL)

    log.info("Edge agent v%s starting", SOFTWARE_VERSION)
    log.info("Backend: %s | Local AI: %s", BACKEND_URL, LOCAL_AI_URL)

    health = local_ai.health()
    log.info("Local AI status: %s (insightface=%s)", health.get("status"), health.get("insightface_loaded"))

    config = backend.get_config()
    sync_version = config.get("sync_version")
    threshold = float(config.get("recognition_threshold", 0.95))
    poll_interval = float(config.get("poll_interval_seconds") or POLL_INTERVAL)

    sync_version = sync_embeddings(backend, local_ai, sync_version)
    backend.heartbeat()

    last_sync = time.time()
    last_heartbeat = time.time()

    while True:
        try:
            if time.time() - last_sync >= SYNC_INTERVAL:
                config = backend.get_config()
                sync_version = sync_embeddings(backend, local_ai, sync_version)
                last_sync = time.time()

            elapsed = run_cycle(backend, local_ai, config, threshold)
            fps = round(1 / elapsed, 2) if elapsed and elapsed > 0 else None

            if time.time() - last_heartbeat >= 30:
                backend.heartbeat(frame_rate_fps=fps)
                last_heartbeat = time.time()

        except KeyboardInterrupt:
            log.info("Shutting down")
            break
        except Exception as exc:
            log.exception("Cycle error: %s", exc)

        time.sleep(poll_interval)


if __name__ == "__main__":
    main()
