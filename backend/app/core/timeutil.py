"""Single timezone authority for all wall-clock decisions.

Timestamps are stored in UTC (DateTime(timezone=True) columns), but *calendar*
decisions — which work_date a punch belongs to, whether a check-in is late
relative to a shift's wall-clock start_time, what "today" means in queries —
must be made in the organization's local timezone (``settings.app_timezone``),
not UTC and not the server's OS timezone. Deriving work_date from UTC puts an
evening punch on tomorrow's date for any deployment east of UTC; using the OS
local date makes reads disagree with writes. Every caller goes through here so
the two can never diverge.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone, tzinfo

from app.core.config import settings

logger = logging.getLogger(__name__)

_tz_cache: dict[str, tzinfo] = {}


def app_tz() -> tzinfo:
    """The configured application timezone (falls back to UTC with a warning)."""
    name = settings.app_timezone
    cached = _tz_cache.get(name)
    if cached is not None:
        return cached
    try:
        from zoneinfo import ZoneInfo

        tz: tzinfo = ZoneInfo(name)
    except Exception:  # ZoneInfoNotFoundError, or tzdata missing entirely
        logger.warning(
            "APP_TIMEZONE=%r is not a valid IANA timezone (is the 'tzdata' "
            "package installed?); falling back to UTC",
            name,
        )
        tz = timezone.utc
    _tz_cache[name] = tz
    return tz


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_local(dt: datetime) -> datetime:
    """Convert a (UTC-naive or aware) datetime to the application timezone."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(app_tz())


def local_date(dt: datetime | None = None) -> date:
    """The calendar date (work_date / "today") in the application timezone."""
    return to_local(dt if dt is not None else now_utc()).date()


def local_day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """UTC half-open interval [start, end) covering the local calendar day.

    Use this to filter UTC timestamp columns by local day with a range query
    instead of ``func.date(col) == day`` (which compares the UTC date).
    """
    start_local = datetime(day.year, day.month, day.day, tzinfo=app_tz())
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)
