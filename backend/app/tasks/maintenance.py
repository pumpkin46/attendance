"""Periodic maintenance tasks (scheduled via Celery Beat)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.celery_app import celery_app
from app.core.config import settings
from app.services import visitor_service
from app.services.anomaly_service import run_anomaly_detection
from app.tasks.base import run_async

logger = logging.getLogger(__name__)


@celery_app.task(name="maintenance.expire_visitors")
def expire_visitors_task() -> dict:
    """Expire visitors past their visit/face window and revoke temporary access."""

    async def _impl(session: AsyncSession) -> dict:
        count = await visitor_service.expire_visitors(session)
        await session.commit()
        return {"expired": count}

    result = run_async(_impl)
    if result["expired"]:
        logger.info("Expired %d visitor(s)", result["expired"])
    return result


@celery_app.task(name="maintenance.detect_anomalies")
def detect_anomalies_task() -> dict:
    """Run attendance anomaly detection across all tenants."""
    if not settings.anomaly_detection_enabled:
        return {"skipped": "anomaly_detection_disabled"}

    async def _impl(session: AsyncSession) -> dict:
        result = await run_anomaly_detection(session)
        await session.commit()
        return result

    result = run_async(_impl)
    logger.info(
        "Anomaly detection: analyzed %s record(s), detected %s",
        result.get("records_analyzed"),
        result.get("anomalies_detected"),
    )
    return result


@celery_app.task(name="maintenance.purge_snapshots")
def purge_snapshots_task() -> dict:
    """Delete recognition snapshot files older than the retention window."""
    from app.services import recognition_service

    removed = recognition_service.purge_old_snapshots()
    if removed:
        logger.info("Purged %d old snapshot file(s)", removed)
    return {"removed": removed}


@celery_app.task(name="maintenance.purge_retention")
def purge_retention_task() -> dict:
    """Delete data older than the configured GDPR retention windows."""
    if not settings.gdpr_enabled:
        return {"skipped": "gdpr_disabled"}

    async def _impl(session: AsyncSession) -> dict:
        from app.models.audit import AuditLog
        from app.models.notification import Notification
        from app.models.recognition import RecognitionEvent

        now = datetime.now(timezone.utc)
        counts: dict[str, int] = {}

        audit_cutoff = now - timedelta(days=settings.retention_audit_logs_days)
        counts["audit_logs"] = (
            await session.execute(delete(AuditLog).where(AuditLog.created_at < audit_cutoff))
        ).rowcount

        rec_cutoff = now - timedelta(days=settings.retention_recognition_events_days)
        counts["recognition_events"] = (
            await session.execute(
                delete(RecognitionEvent).where(RecognitionEvent.recognized_at < rec_cutoff)
            )
        ).rowcount

        notif_cutoff = now - timedelta(days=settings.retention_notifications_days)
        counts["notifications"] = (
            await session.execute(
                delete(Notification).where(Notification.created_at < notif_cutoff)
            )
        ).rowcount

        await session.commit()
        return counts

    result = run_async(_impl)
    logger.info("Retention purge removed: %s", result)
    return result
