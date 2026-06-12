"""Timezone-correctness tests for work_date derivation and lateness.

Guards the Tier-1 fix: work_date and "today" must be derived from
settings.app_timezone (not UTC, not the server OS zone), and lateness must
compare local wall-clock times. Exercises punches near midnight and
shift-start boundaries in zones east and west of UTC.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest

import app.core.timeutil as timeutil
from app.core.timeutil import local_date, local_day_bounds_utc, to_local
from app.services.attendance_service import _resolve_status


@pytest.fixture
def set_app_tz(monkeypatch):
    def _set(name: str) -> None:
        monkeypatch.setattr("app.core.config.settings.app_timezone", name)
        timeutil._tz_cache.clear()

    yield _set
    timeutil._tz_cache.clear()


class TestLocalDate:
    def test_evening_punch_east_of_utc_stays_on_local_day(self, set_app_tz):
        # 22:30 UTC on Jan 1 is already 01:30 Jan 2 in Riyadh (UTC+3) — but a
        # punch at 22:30 *local* must land on the local calendar day.
        set_app_tz("Asia/Riyadh")
        punch_local_2230 = datetime(2026, 1, 1, 19, 30, tzinfo=timezone.utc)
        assert local_date(punch_local_2230) == date(2026, 1, 1)

    def test_utc_date_rollover_does_not_split_local_day_east(self, set_app_tz):
        # Old bug: deriving from UTC put a 21:05-UTC punch (00:05 local, +3)
        # correctly, but a 20:55-UTC punch (23:55 local) on the *previous* UTC
        # date — splitting one local evening across two work_dates.
        set_app_tz("Asia/Riyadh")
        before_local_midnight = datetime(2026, 1, 1, 20, 55, tzinfo=timezone.utc)
        after_local_midnight = datetime(2026, 1, 1, 21, 5, tzinfo=timezone.utc)
        assert local_date(before_local_midnight) == date(2026, 1, 1)
        assert local_date(after_local_midnight) == date(2026, 1, 2)

    def test_evening_punch_west_of_utc_stays_on_local_day(self, set_app_tz):
        # 18:00 Jan 1 in Los Angeles (UTC-8) is 02:00 Jan 2 UTC. The old
        # UTC-derived work_date opened a record on "tomorrow".
        set_app_tz("America/Los_Angeles")
        punch = datetime(2026, 1, 2, 2, 0, tzinfo=timezone.utc)
        assert local_date(punch) == date(2026, 1, 1)

    def test_naive_datetime_treated_as_utc(self, set_app_tz):
        set_app_tz("Asia/Riyadh")
        assert local_date(datetime(2026, 1, 1, 22, 0)) == date(2026, 1, 2)

    def test_invalid_timezone_falls_back_to_utc(self, set_app_tz):
        set_app_tz("Not/AZone")
        punch = datetime(2026, 1, 1, 23, 0, tzinfo=timezone.utc)
        assert local_date(punch) == date(2026, 1, 1)


class TestLocalDayBounds:
    def test_bounds_cover_exactly_the_local_day(self, set_app_tz):
        set_app_tz("Asia/Riyadh")
        start, end = local_day_bounds_utc(date(2026, 1, 1))
        assert start == datetime(2025, 12, 31, 21, 0, tzinfo=timezone.utc)
        assert end == datetime(2026, 1, 1, 21, 0, tzinfo=timezone.utc)

    def test_every_instant_maps_back_to_the_same_day(self, set_app_tz):
        set_app_tz("America/Los_Angeles")
        day = date(2026, 6, 15)
        start, end = local_day_bounds_utc(day)
        assert local_date(start) == day
        assert local_date(end) == day + (date(2026, 6, 16) - date(2026, 6, 15))
        assert to_local(end - (end - start) / 2).date() == day


class _Shift:
    def __init__(self, start: time, grace: int = 15):
        self.start_time = start
        self.grace_minutes = grace


class TestResolveStatusLocalWallClock:
    def test_on_time_east_of_utc_is_present(self, set_app_tz):
        # Shift starts 09:00 local (Riyadh). Check-in 09:10 local = 06:10 UTC.
        # Old code compared 06:10 against 09:00 — never late east of UTC.
        set_app_tz("Asia/Riyadh")
        check_in = datetime(2026, 1, 5, 6, 10, tzinfo=timezone.utc)
        assert _resolve_status(check_in, _Shift(time(9, 0)), None) == "present"

    def test_late_east_of_utc_is_late(self, set_app_tz):
        set_app_tz("Asia/Riyadh")
        check_in = datetime(2026, 1, 5, 6, 20, tzinfo=timezone.utc)  # 09:20 local
        assert _resolve_status(check_in, _Shift(time(9, 0)), None) == "late"

    def test_on_time_west_of_utc_is_present(self, set_app_tz):
        # Shift starts 09:00 local (LA). Check-in 09:00 local = 17:00 UTC.
        # Old code compared 17:00 against 09:00 — everyone "late" west of UTC.
        set_app_tz("America/Los_Angeles")
        check_in = datetime(2026, 1, 5, 17, 0, tzinfo=timezone.utc)
        assert _resolve_status(check_in, _Shift(time(9, 0)), None) == "present"

    def test_grace_boundary_exactly_at_limit_is_present(self, set_app_tz):
        set_app_tz("America/Los_Angeles")
        check_in = datetime(2026, 1, 5, 17, 15, tzinfo=timezone.utc)  # 09:15 local
        assert _resolve_status(check_in, _Shift(time(9, 0), grace=15), None) == "present"

    def test_one_minute_past_grace_is_late(self, set_app_tz):
        set_app_tz("America/Los_Angeles")
        check_in = datetime(2026, 1, 5, 17, 16, tzinfo=timezone.utc)  # 09:16 local
        assert _resolve_status(check_in, _Shift(time(9, 0), grace=15), None) == "late"
