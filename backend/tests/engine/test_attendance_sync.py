"""Tests for the camera attendance event consumer (Tier-1 persistence fix)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from app.engine.attendance_generator import (
    AttendanceGenerator,
    MAX_PENDING_EVENTS,
)
from app.engine.attendance_sync import (
    AttendanceEventConsumer,
    employee_pk_from_identity,
)
import app.engine.attendance_generator as generator_mod


class FakeSession:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def fake_persistence(monkeypatch):
    """Stub the DB session factory + process_recognition the consumer uses."""
    session = FakeSession()
    calls: list[dict] = []

    async def fake_process_recognition(db, employee_id, **kwargs):
        calls.append({"employee_id": employee_id, **kwargs})

    monkeypatch.setattr("app.core.database.async_session_factory", lambda: session)
    monkeypatch.setattr(
        "app.services.attendance_service.process_recognition",
        fake_process_recognition,
    )
    return session, calls


@pytest.fixture
def generator(monkeypatch):
    gen = AttendanceGenerator()
    monkeypatch.setattr(generator_mod, "_generator", gen)
    return gen


class TestIdentityMapping:
    def test_numeric_identity_maps_to_pk(self):
        assert employee_pk_from_identity("42") == 42

    def test_visitor_identity_is_skipped(self):
        assert employee_pk_from_identity("visitor-7") is None

    def test_non_numeric_and_empty_are_skipped(self):
        assert employee_pk_from_identity("EMP001") is None
        assert employee_pk_from_identity("") is None
        assert employee_pk_from_identity(None) is None


class TestDrainOnce:
    @pytest.mark.asyncio
    async def test_persists_employee_events_and_commits(self, generator, fake_persistence):
        session, calls = fake_persistence
        generator.generate_event("11", camera_id=3, confidence=0.9, liveness_score=0.8)
        generator.generate_event("22", camera_id=4, confidence=0.7)

        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 2
        assert [c["employee_id"] for c in calls] == [11, 22]
        assert calls[0]["camera_id"] == 3
        assert calls[0]["method"] == "face"
        assert session.commits == 2
        assert generator.stats["pending_events"] == 0

    @pytest.mark.asyncio
    async def test_skips_visitor_identities(self, generator, fake_persistence):
        _, calls = fake_persistence
        generator.generate_event("visitor-5", camera_id=1)

        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 0
        assert calls == []

    @pytest.mark.asyncio
    async def test_discards_stale_events(self, generator, fake_persistence):
        _, calls = fake_persistence
        event = generator.generate_event("11", camera_id=1)
        event.timestamp = datetime.now(timezone.utc) - timedelta(hours=2)

        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 0
        assert calls == []

    @pytest.mark.asyncio
    async def test_one_failure_does_not_poison_the_batch(
        self, generator, fake_persistence, monkeypatch
    ):
        session, calls = fake_persistence

        async def flaky_process_recognition(db, employee_id, **kwargs):
            if employee_id == 11:
                raise RuntimeError("boom")
            calls.append({"employee_id": employee_id, **kwargs})

        monkeypatch.setattr(
            "app.services.attendance_service.process_recognition",
            flaky_process_recognition,
        )
        generator.generate_event("11", camera_id=1)
        generator.generate_event("22", camera_id=2)

        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 1
        assert [c["employee_id"] for c in calls] == [22]
        assert session.rollbacks == 1

    @pytest.mark.asyncio
    async def test_consumed_event_is_not_double_processed(self, generator, fake_persistence):
        _, calls = fake_persistence
        event = generator.generate_event("11", camera_id=1)

        # The HTTP endpoint claims the event for its inline write...
        assert generator.consume(event) is True
        # ...so the background drain finds nothing.
        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 0
        assert calls == []
        # A second claim reports the event is gone.
        assert generator.consume(event) is False


class TestBoundedQueue:
    def test_queue_drops_oldest_beyond_max(self, generator, monkeypatch):
        # Disable duplicate suppression so each event enqueues.
        monkeypatch.setattr(
            generator._duplicate_tracker, "is_duplicate", lambda *a: False
        )
        for i in range(MAX_PENDING_EVENTS + 50):
            generator.generate_event(str(i))

        assert generator.stats["pending_events"] == MAX_PENDING_EVENTS
        events = generator.drain_events()
        # Oldest 50 were evicted, newest survive.
        assert events[0].employee_id == "50"
        assert events[-1].employee_id == str(MAX_PENDING_EVENTS + 49)
