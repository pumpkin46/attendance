"""Tests for the camera attendance event consumer (Tier-1 persistence fix)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.engine.attendance_generator import (
    AttendanceEventType,
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
        # Mirror the service: a real write reports its action via last_action.
        return SimpleNamespace(last_action=kwargs.get("intent") or "check_in")

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
        assert calls[0]["intent"] == "check_in"
        assert calls[0]["organization_id"] is None  # camera 3 is not registered
        assert session.commits == 2
        assert generator.stats["pending_events"] == 0

    @pytest.mark.asyncio
    async def test_check_out_event_maps_to_check_out_intent(
        self, generator, fake_persistence
    ):
        _, calls = fake_persistence
        # An exit camera (direction="out") produces a CHECK_OUT-typed event.
        generator.generate_event("11", camera_id=1, direction="out")

        await AttendanceEventConsumer().drain_once()

        assert calls[0]["intent"] == "check_out"

    @pytest.mark.asyncio
    async def test_break_events_are_skipped(self, generator, fake_persistence):
        session, calls = fake_persistence
        generator.generate_event(
            "11", camera_id=1, event_type=AttendanceEventType.BREAK_START
        )

        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 0
        assert calls == []
        assert session.commits == 0

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
            return SimpleNamespace(last_action="check_in")

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
    async def test_noop_outcome_is_not_counted_persisted(
        self, generator, fake_persistence, monkeypatch
    ):
        _, calls = fake_persistence

        async def noop_process_recognition(db, employee_id, **kwargs):
            calls.append({"employee_id": employee_id, **kwargs})
            return SimpleNamespace(last_action="already_checked_in")

        monkeypatch.setattr(
            "app.services.attendance_service.process_recognition",
            noop_process_recognition,
        )
        generator.generate_event("11", camera_id=1)

        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 0  # processed, but no ledger row was written
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_org_resolved_from_registered_stream(
        self, generator, fake_persistence
    ):
        from app.engine.stream_manager import get_stream_manager

        _, calls = fake_persistence
        manager = get_stream_manager()
        manager.add_stream(9, "rtsp://example/cam", organization_id=5)
        try:
            generator.generate_event("11", camera_id=9)
            await AttendanceEventConsumer().drain_once()
        finally:
            manager.remove_stream(9)

        assert calls[0]["organization_id"] == 5

    @pytest.mark.asyncio
    async def test_inline_event_is_never_queued(self, generator, fake_persistence):
        """The API path generates with enqueue=False: nothing reaches the
        consumer, so its inline write is the event's only writer."""
        _, calls = fake_persistence
        event = generator.generate_event("11", camera_id=1, enqueue=False)

        assert event is not None
        assert generator.stats["pending_events"] == 0
        persisted = await AttendanceEventConsumer().drain_once()

        assert persisted == 0
        assert calls == []


class TestRetry:
    @pytest.mark.asyncio
    async def test_failed_event_is_retried_on_next_drain(
        self, generator, fake_persistence, monkeypatch
    ):
        session, calls = fake_persistence
        attempts = {"count": 0}

        async def flaky_once(db, employee_id, **kwargs):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RuntimeError("transient db hiccup")
            calls.append({"employee_id": employee_id, **kwargs})
            return SimpleNamespace(last_action="check_in")

        monkeypatch.setattr(
            "app.services.attendance_service.process_recognition", flaky_once
        )
        generator.generate_event("11", camera_id=1)
        consumer = AttendanceEventConsumer()

        assert await consumer.drain_once() == 0
        assert session.rollbacks == 1
        assert calls == []

        # The same event is replayed (not dropped) and now persists.
        assert await consumer.drain_once() == 1
        assert [c["employee_id"] for c in calls] == [11]
        assert consumer._retry == []

    @pytest.mark.asyncio
    async def test_commit_failure_clears_dup_marker_so_retry_persists(
        self, generator, db_session, monkeypatch
    ):
        """A commit failure after the service armed the duplicate fast-path
        must unarm it, or the retried event reads as duplicate_ignored and
        the check-in is silently lost for the whole window."""
        from sqlalchemy import select

        import app.services.attendance_service as att
        from app.models.attendance import AttendanceRecord
        from app.models.employee import Employee
        from app.models.organization import Organization

        org = Organization(id=1, name="Org 1", code="ORG1")
        db_session.add(org)
        await db_session.flush()
        emp = Employee(
            organization_id=1,
            employee_code="EMP-RETRY",
            first_name="Test",
            last_name="Person",
            is_active=True,
        )
        db_session.add(emp)
        await db_session.flush()
        # Commit the fixtures: the consumer's rollback on the failed event
        # must only undo the attendance write, not the employee row. Keep the
        # PK as a plain int: the rollback expires the ORM instance.
        emp_id = emp.id
        await db_session.commit()

        @asynccontextmanager
        async def session_cm():
            yield db_session

        monkeypatch.setattr("app.core.database.async_session_factory", session_cm)

        real_commit = db_session.commit
        commits = {"count": 0}

        async def commit_fails_once():
            commits["count"] += 1
            if commits["count"] == 1:
                raise RuntimeError("commit lost")
            await real_commit()

        monkeypatch.setattr(db_session, "commit", commit_fails_once)

        consumer = AttendanceEventConsumer()
        generator.generate_event(str(emp_id), camera_id=1, confidence=0.9)

        assert await consumer.drain_once() == 0
        # Redis is disabled in tests: the local-cache marker must be unarmed.
        assert f"face:{emp_id}" not in att._dup_cache

        # The retried event persists instead of reading as duplicate_ignored.
        assert await consumer.drain_once() == 1
        records = (
            (
                await db_session.execute(
                    select(AttendanceRecord).where(
                        AttendanceRecord.employee_id == emp_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(records) == 1
        assert records[0].check_in_at is not None

    @pytest.mark.asyncio
    async def test_stale_retried_event_is_discarded(
        self, generator, fake_persistence, monkeypatch
    ):
        session, _ = fake_persistence

        async def always_fail(db, employee_id, **kwargs):
            raise RuntimeError("db down")

        monkeypatch.setattr(
            "app.services.attendance_service.process_recognition", always_fail
        )
        event = generator.generate_event("11", camera_id=1)
        consumer = AttendanceEventConsumer()

        assert await consumer.drain_once() == 0
        assert session.rollbacks == 1

        # Once past the max-age guard the retried event is dropped for good.
        event.timestamp = datetime.now(timezone.utc) - timedelta(hours=2)
        assert await consumer.drain_once() == 0
        assert session.rollbacks == 1  # never reached process_recognition again
        assert consumer._retry == []


class TestConsumerEndToEnd:
    @pytest.mark.asyncio
    async def test_repeated_check_in_does_not_toggle_check_out(
        self, generator, db_session, monkeypatch
    ):
        """Regression for the always-on-camera corruption bug: a person who
        stays in view re-emits CHECK_IN events outside the attendance dup
        window; the second must report already_checked_in, never check them
        out (which used to leave the day half_day + already_complete)."""
        from sqlalchemy import select

        from app.models.attendance import AttendanceRecord
        from app.models.employee import Employee
        from app.models.organization import Organization

        org = Organization(id=1, name="Org 1", code="ORG1")
        db_session.add(org)
        await db_session.flush()
        emp = Employee(
            organization_id=1,
            employee_code="EMP-E2E",
            first_name="Test",
            last_name="Person",
            is_active=True,
        )
        db_session.add(emp)
        await db_session.flush()

        # Outside the attendance dup window (and the generator's own tracker,
        # which re-emits for a continuously visible person in production).
        monkeypatch.setattr(
            "app.core.config.settings.face_duplicate_window_seconds", 0
        )
        monkeypatch.setattr(
            generator._duplicate_tracker, "is_duplicate", lambda *a: False
        )

        @asynccontextmanager
        async def session_cm():
            yield db_session

        monkeypatch.setattr(
            "app.core.database.async_session_factory", session_cm
        )

        # Spy on the real state machine: last_action is a transient attribute,
        # so capture it per call rather than from a re-selected row.
        from app.services.attendance_service import process_recognition

        actions: list[str | None] = []

        async def spy(db, employee_id, **kwargs):
            record = await process_recognition(db, employee_id, **kwargs)
            actions.append(record.last_action if record else None)
            return record

        monkeypatch.setattr(
            "app.services.attendance_service.process_recognition", spy
        )

        consumer = AttendanceEventConsumer()
        generator.generate_event(str(emp.id), camera_id=1, confidence=0.9)
        assert await consumer.drain_once() == 1

        generator.generate_event(str(emp.id), camera_id=1, confidence=0.9)
        # The re-sighting is a no-op (already_checked_in), not a real write.
        assert await consumer.drain_once() == 0

        records = (
            (
                await db_session.execute(
                    select(AttendanceRecord).where(
                        AttendanceRecord.employee_id == emp.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(records) == 1
        record = records[0]
        assert record.check_in_at is not None
        assert record.check_out_at is None
        assert actions == ["check_in", "already_checked_in"]


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
