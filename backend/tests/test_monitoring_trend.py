"""Unit tests for monitoring_service.build_attendance_trend.

Exercises the data-shaping logic (status bucketing, gap-filling, oldest->newest
ordering, day-count clamp) on a fake session, matching the lightweight fake-DB
style used elsewhere in the suite. Tenant scoping reuses build_dashboard's
established join + apply_employee_tenant_filter pattern and is not re-asserted
here (the fake ignores the statement).
"""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.core.timeutil import local_date
from app.services.monitoring_service import build_attendance_trend


class _TrendSession:
    """Returns canned (work_date, status, count) rows from execute().all()."""

    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        rows = list(self._rows)
        return SimpleNamespace(all=lambda: rows)


@pytest.mark.asyncio
async def test_buckets_gap_fills_and_orders_oldest_to_newest():
    today = local_date()
    two_ago = today - timedelta(days=2)
    rows = [
        (today, "present", 5),
        (today, "late", 2),
        (two_ago, "present", 1),
        (today, "absent", 9),  # not a check-in -> ignored
        (today, "on_leave", 3),  # not a check-in -> ignored
    ]

    out = await build_attendance_trend(_TrendSession(rows), None, days=3)
    days = out["days"]

    assert len(days) == 3
    # Contiguous, oldest -> newest.
    assert days[0]["date"] == two_ago.isoformat()
    assert days[-1]["date"] == today.isoformat()

    # Oldest: only an on-time check-in.
    assert days[0] == {"date": two_ago.isoformat(), "on_time": 1, "late": 0, "total": 1}
    # Middle day had no rows -> gap-filled with zeros.
    assert days[1] == {
        "date": (today - timedelta(days=1)).isoformat(),
        "on_time": 0,
        "late": 0,
        "total": 0,
    }
    # Today: present -> on_time, late -> late, total = both; absent/on_leave excluded.
    assert days[2] == {"date": today.isoformat(), "on_time": 5, "late": 2, "total": 7}


@pytest.mark.asyncio
async def test_days_count_is_clamped():
    lo = await build_attendance_trend(_TrendSession([]), None, days=0)
    assert len(lo["days"]) == 1

    hi = await build_attendance_trend(_TrendSession([]), None, days=999)
    assert len(hi["days"]) == 31
