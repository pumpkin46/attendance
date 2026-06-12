"""AI security monitoring: alert generation, dashboard and triage transitions.

Alert generation hooks into the recognition flow (``recognition_service``
calls ``evaluate_matched`` / ``evaluate_unmatched`` after persisting each
event) and covers four detections:

- ``unknown_person``   — a real face was searched and nobody matched
- ``spoof_attempt``    — the liveness gate rejected the frame (photo/replay)
- ``after_hours_access`` — a successful match outside the configured hours
- ``tailgating``       — distinct identities at one camera within the window

Detection is best-effort by design: a failure here must never break the
attendance write it piggybacks on, and alerts are throttled per
(org, type, camera) by ``settings.security_alert_cooldown``.
"""

from __future__ import annotations

import logging
import time as time_mod
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.middleware.tenant import apply_tenant_filter
from app.models.employee import Employee
from app.models.organization import Organization
from app.models.recognition import RecognitionEvent
from app.models.security import AlertSeverity, AlertStatus, SecurityAlert
from app.realtime.hub import emit
from app.schemas.security_monitoring import (
    AlertTrendPoint,
    SecurityAlertOut,
    SecurityDashboard,
)

logger = logging.getLogger(__name__)

TREND_DAYS = 14

# Per-process throttle of the last alert per (org, type, camera), mirroring the
# unknown-event throttle in recognition_service. Best effort: a kiosk scanning
# continuously would otherwise raise one alert per frame.
_last_alert_at: dict[tuple[int | None, str, int | None], float] = {}


def _enum_value(v: object) -> object:
    """Plain string for an Enum member; group_by/status reads return members."""
    return getattr(v, "value", v)


def _alert_throttled(org_id: int | None, alert_type: str, camera_id: int | None) -> bool:
    window = settings.security_alert_cooldown
    if window <= 0:
        return False
    key = (org_id, alert_type, camera_id)
    now_ts = time_mod.time()
    last = _last_alert_at.get(key)
    if last is not None and (now_ts - last) < window:
        return True
    _last_alert_at[key] = now_ts
    return False


def _parse_hhmm(value: str) -> time | None:
    try:
        hour, minute = value.split(":", 1)
        return time(int(hour), int(minute))
    except (ValueError, AttributeError):
        return None


def _in_after_hours(t: time, start: time, end: time) -> bool:
    """Whether ``t`` falls in the after-hours window (which may cross midnight)."""
    if start == end:
        return False
    if start < end:
        return start <= t < end
    return t >= start or t < end


async def _org_local_time(
    db: AsyncSession, org_id: int | None, moment: datetime
) -> time:
    """``moment`` as wall-clock time in the organization's timezone.

    Falls back to the server's local timezone when the org (or its timezone
    string) is unknown — after-hours windows are wall-clock concepts.
    """
    tz_name = None
    if org_id is not None:
        tz_name = (
            await db.execute(select(Organization.timezone).where(Organization.id == org_id))
        ).scalar_one_or_none()
    try:
        tz = ZoneInfo(tz_name) if tz_name else None
    except Exception:
        tz = None
    local = moment.astimezone(tz) if tz else moment.astimezone()
    return local.time()


# ── Alert creation ───────────────────────────────────────────────────────────


async def create_alert(
    db: AsyncSession,
    *,
    organization_id: int | None,
    alert_type: str,
    severity: AlertSeverity,
    title: str,
    message: str,
    camera_id: int | None = None,
    employee_id: int | None = None,
    recognition_event_id: int | None = None,
    snapshot_path: str | None = None,
    meta: dict | None = None,
    occurred_at: datetime | None = None,
    throttle: bool = True,
) -> SecurityAlert | None:
    """Persist an alert and notify listeners; returns None when throttled."""
    if throttle and _alert_throttled(organization_id, alert_type, camera_id):
        return None

    alert = SecurityAlert(
        organization_id=organization_id,
        alert_type=alert_type,
        severity=severity,
        title=title,
        message=message,
        camera_id=camera_id,
        employee_id=employee_id,
        recognition_event_id=recognition_event_id,
        snapshot_path=snapshot_path,
        meta=meta,
        occurred_at=occurred_at or datetime.now(timezone.utc),
    )
    db.add(alert)
    await db.flush()
    await emit(
        organization_id,
        "security.changed",
        {
            "alert_id": alert.id,
            "alert_type": alert_type,
            "severity": severity.value,
            "title": title,
        },
    )
    return alert


# ── Detection rules (called from recognition_service) ────────────────────────


async def evaluate_matched(
    db: AsyncSession,
    *,
    employee: Employee | None,
    event: RecognitionEvent,
    org_id: int | None,
    camera_id: int | None,
    snapshot_path: str | None,
) -> None:
    """After-hours + tailgating checks for a successful identification."""
    if not settings.security_monitoring_enabled:
        return
    occurred = event.recognized_at or datetime.now(timezone.utc)
    name = (
        f"{employee.first_name} {employee.last_name}" if employee else "An employee"
    )

    start = _parse_hhmm(settings.security_after_hours_start)
    end = _parse_hhmm(settings.security_after_hours_end)
    if start and end:
        local_time = await _org_local_time(db, org_id, occurred)
        if _in_after_hours(local_time, start, end):
            await create_alert(
                db,
                organization_id=org_id,
                alert_type="after_hours_access",
                severity=AlertSeverity.high,
                title=f"After-hours access by {name}",
                message=(
                    f"{name} was recognized at {local_time.strftime('%H:%M')}, inside the "
                    f"after-hours window {settings.security_after_hours_start}-"
                    f"{settings.security_after_hours_end}."
                ),
                camera_id=camera_id,
                employee_id=event.employee_id,
                recognition_event_id=event.id,
                snapshot_path=snapshot_path,
                meta={
                    "local_time": local_time.strftime("%H:%M"),
                    "window": f"{settings.security_after_hours_start}-{settings.security_after_hours_end}",
                    "confidence": event.confidence,
                },
                occurred_at=occurred,
            )

    window_s = settings.security_tailgating_window
    if camera_id is not None and event.employee_id is not None and window_s > 0:
        since = occurred - timedelta(seconds=window_s)
        companions = (
            await db.execute(
                select(func.count(func.distinct(RecognitionEvent.employee_id))).where(
                    RecognitionEvent.camera_id == camera_id,
                    RecognitionEvent.result == "matched",
                    RecognitionEvent.employee_id.is_not(None),
                    RecognitionEvent.employee_id != event.employee_id,
                    RecognitionEvent.recognized_at >= since,
                )
            )
        ).scalar() or 0
        if companions:
            await create_alert(
                db,
                organization_id=org_id,
                alert_type="tailgating",
                severity=AlertSeverity.high,
                title="Possible tailgating detected",
                message=(
                    f"{name} and {companions} other "
                    f"{'person was' if companions == 1 else 'people were'} recognized at the "
                    f"same camera within {window_s}s."
                ),
                camera_id=camera_id,
                employee_id=event.employee_id,
                recognition_event_id=event.id,
                snapshot_path=snapshot_path,
                meta={"companions": companions, "window_seconds": window_s},
                occurred_at=occurred,
            )


async def evaluate_unmatched(
    db: AsyncSession,
    *,
    org_id: int | None,
    camera_id: int | None,
    event: RecognitionEvent,
    spoof: bool,
    genuine_unknown: bool,
    reason: str | None,
    snapshot_path: str | None,
) -> None:
    """Spoof / unknown-person alerts for a failed identification."""
    if not settings.security_monitoring_enabled:
        return
    occurred = event.recognized_at or datetime.now(timezone.utc)

    if spoof:
        await create_alert(
            db,
            organization_id=org_id,
            alert_type="spoof_attempt",
            severity=AlertSeverity.critical,
            title="Possible spoofing attempt blocked",
            message=(
                "The liveness check rejected a face presentation "
                f"({reason or 'liveness_failed'}). This can indicate a photo or replay attack."
            ),
            camera_id=camera_id,
            recognition_event_id=event.id,
            snapshot_path=snapshot_path,
            meta={"reason": reason, "confidence": event.confidence},
            occurred_at=occurred,
        )
    elif genuine_unknown:
        await create_alert(
            db,
            organization_id=org_id,
            alert_type="unknown_person",
            severity=AlertSeverity.medium,
            title="Unknown person detected",
            message="A face was detected and searched but matched no enrolled identity.",
            camera_id=camera_id,
            recognition_event_id=event.id,
            snapshot_path=snapshot_path,
            meta={"reason": reason, "confidence": event.confidence},
            occurred_at=occurred,
        )


# ── Dashboard ────────────────────────────────────────────────────────────────


async def _count_by(db: AsyncSession, column, org_id: int | None) -> dict:
    stmt = select(column, func.count(SecurityAlert.id).label("cnt")).group_by(column)
    stmt = apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)
    return {_enum_value(row[0]): row.cnt for row in (await db.execute(stmt)).all()}


def _day_start_utc(day: date, tz_offset: int) -> datetime:
    """UTC instant of the viewer-local midnight (offset = UTC minus local, minutes)."""
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(
        minutes=tz_offset
    )


async def _trend(
    db: AsyncSession, org_id: int | None, tz_offset: int
) -> list[AlertTrendPoint]:
    """Alerts per viewer-local day over the trailing window, zero-filled.

    Bucketing happens in Python (volume is bounded by the alert cooldown), which
    keeps day boundaries correct for the viewer without dialect-specific SQL.
    """
    today_local = (datetime.now(timezone.utc) - timedelta(minutes=tz_offset)).date()
    start_day = today_local - timedelta(days=TREND_DAYS - 1)
    stmt = apply_tenant_filter(
        select(SecurityAlert.occurred_at).where(
            SecurityAlert.occurred_at >= _day_start_utc(start_day, tz_offset)
        ),
        org_id,
        SecurityAlert.organization_id,
    )
    counts: Counter[date] = Counter()
    for ts in (await db.execute(stmt)).scalars():
        if ts is None:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        counts[(ts - timedelta(minutes=tz_offset)).date()] += 1
    return [
        AlertTrendPoint(day=d, count=counts.get(d, 0))
        for d in (start_day + timedelta(days=i) for i in range(TREND_DAYS))
    ]


async def build_dashboard(
    db: AsyncSession, org_id: int | None, tz_offset: int = 0
) -> SecurityDashboard:
    total_q = apply_tenant_filter(
        select(func.count(SecurityAlert.id)), org_id, SecurityAlert.organization_id
    )
    total = (await db.execute(total_q)).scalar() or 0

    status_map = await _count_by(db, SecurityAlert.status, org_id)
    by_severity = await _count_by(db, SecurityAlert.severity, org_id)
    by_type = await _count_by(db, SecurityAlert.alert_type, org_id)

    recent_stmt = apply_tenant_filter(
        select(SecurityAlert), org_id, SecurityAlert.organization_id
    ).order_by(SecurityAlert.id.desc()).limit(10)
    recent_alerts = [
        SecurityAlertOut.model_validate(a, from_attributes=True)
        for a in (await db.execute(recent_stmt)).scalars().all()
    ]

    return SecurityDashboard(
        total_alerts=total,
        open_alerts=status_map.get("open", 0),
        acknowledged_alerts=status_map.get("acknowledged", 0),
        resolved_alerts=status_map.get("resolved", 0),
        by_severity=by_severity,
        by_type=by_type,
        trend=await _trend(db, org_id, tz_offset),
        recent_alerts=recent_alerts,
    )


# ── Alert list / triage ──────────────────────────────────────────────────────


def alerts_query(
    org_id: int | None,
    *,
    status: str | None = None,
    severity: str | None = None,
    alert_type: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz_offset: int = 0,
) -> Select:
    stmt = select(SecurityAlert).order_by(SecurityAlert.id.desc())
    stmt = apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)
    if status:
        try:
            stmt = stmt.where(SecurityAlert.status == AlertStatus(status))
        except ValueError:
            raise ValidationError(f"Unknown status: {status}")
    if severity:
        try:
            stmt = stmt.where(SecurityAlert.severity == AlertSeverity(severity))
        except ValueError:
            raise ValidationError(f"Unknown severity: {severity}")
    if alert_type:
        stmt = stmt.where(SecurityAlert.alert_type == alert_type)
    if date_from and date_to and date_from > date_to:
        raise ValidationError("date_from must not be after date_to")
    if date_from:
        stmt = stmt.where(SecurityAlert.occurred_at >= _day_start_utc(date_from, tz_offset))
    if date_to:
        stmt = stmt.where(
            SecurityAlert.occurred_at < _day_start_utc(date_to + timedelta(days=1), tz_offset)
        )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                SecurityAlert.title.ilike(like),
                SecurityAlert.message.ilike(like),
                SecurityAlert.alert_type.ilike(like),
            )
        )
    return stmt


async def get_alert(db: AsyncSession, alert_id: int, org_id: int | None) -> SecurityAlert:
    stmt = select(SecurityAlert).where(SecurityAlert.id == alert_id)
    stmt = apply_tenant_filter(stmt, org_id, SecurityAlert.organization_id)
    alert = (await db.execute(stmt)).scalar_one_or_none()
    if not alert:
        raise NotFoundError("Alert not found")
    return alert


async def acknowledge_alert(
    db: AsyncSession, alert_id: int, org_id: int | None, user_id: int
) -> SecurityAlert:
    alert = await get_alert(db, alert_id, org_id)
    if _enum_value(alert.status) != "open":
        raise ConflictError("Alert is not in open state")
    alert.status = AlertStatus.acknowledged
    alert.acknowledged_at = datetime.now(timezone.utc)
    alert.acknowledged_by = user_id
    await db.flush()
    await db.refresh(alert)
    return alert


async def resolve_alert(
    db: AsyncSession, alert_id: int, org_id: int | None, user_id: int
) -> SecurityAlert:
    alert = await get_alert(db, alert_id, org_id)
    if _enum_value(alert.status) == "resolved":
        raise ConflictError("Alert already resolved")
    alert.status = AlertStatus.resolved
    alert.resolved_at = datetime.now(timezone.utc)
    alert.resolved_by = user_id
    await db.flush()
    await db.refresh(alert)
    return alert
