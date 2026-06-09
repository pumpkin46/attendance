"""Celery application — Redis-backed broker/result backend + Beat schedule.

Run a worker:
    celery -A app.celery_app.celery_app worker --loglevel=info
Run the periodic scheduler:
    celery -A app.celery_app.celery_app beat --loglevel=info

Tasks live in ``app/tasks`` and reuse the app's async services via
``app.tasks.base.run_async``.
"""

from __future__ import annotations

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "attendance",
    broker=settings.effective_celery_broker,
    backend=settings.effective_celery_backend,
    include=["app.tasks.maintenance"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.celery_timezone,
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_max_tasks_per_child=200,
    beat_schedule={
        "expire-visitors": {
            "task": "maintenance.expire_visitors",
            "schedule": float(settings.beat_visitor_expiry_seconds),
        },
        "detect-anomalies": {
            "task": "maintenance.detect_anomalies",
            "schedule": float(settings.beat_anomaly_detection_seconds),
        },
        "purge-retention": {
            "task": "maintenance.purge_retention",
            "schedule": float(settings.beat_retention_purge_seconds),
        },
        "purge-snapshots": {
            "task": "maintenance.purge_snapshots",
            "schedule": float(settings.beat_retention_purge_seconds),
        },
    },
)
