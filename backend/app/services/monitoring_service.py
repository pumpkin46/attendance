"""Live monitoring dashboard + event feed aggregation.

All querying/formatting lives here; the monitoring router only declares the
response models and delegates.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timeutil import local_date, local_day_bounds_utc
from app.middleware.tenant import (
    apply_employee_tenant_filter,
    apply_tenant_filter,
    as_scope_ids,
)
from app.models.attendance import AttendanceRecord
from app.models.camera import Camera, CameraStatus
from app.models.employee import Employee
from app.models.live_event import LiveEvent
from app.models.location import Location
from app.models.recognition import RecognitionEvent, RecognitionResult
from app.models.visitor import Visitor, VisitorStatus


def _camera_is_online(camera: Camera, heartbeat_threshold: datetime) -> bool:
    if camera.status != CameraStatus.active:
        return False
    if not camera.last_heartbeat_at:
        return False
    return camera.last_heartbeat_at >= heartbeat_threshold


def _format_camera(camera: Camera, online: bool, recognition_today: int) -> dict:
    # Telemetry columns hold the camera's *last reported* readings. Once a
    # camera is offline those readings are stale, so health reports them only
    # while online — otherwise the dashboard shows "13 fps" on a dead camera
    # and averages it into the fleet stats.
    fps = float(camera.frame_rate_fps) if online and camera.frame_rate_fps is not None else None
    direction = camera.direction.value if hasattr(camera.direction, "value") else camera.direction
    deployment = (
        camera.deployment_mode.value
        if hasattr(camera.deployment_mode, "value")
        else camera.deployment_mode
    )
    status = camera.status.value if hasattr(camera.status, "value") else camera.status
    resolution = None
    if camera.resolution_width and camera.resolution_height:
        resolution = f"{camera.resolution_width}x{camera.resolution_height}"

    return {
        "id": camera.id,
        "name": camera.name,
        "camera_type": camera.camera_type,
        "location": (
            {"id": camera.location.id, "name": camera.location.name}
            if camera.location
            else None
        ),
        "zone": camera.zone,
        "floor": camera.floor,
        "stream_url": camera.stream_url,
        "target_fps": camera.target_fps,
        "resolution": resolution,
        "resolution_width": camera.resolution_width,
        "resolution_height": camera.resolution_height,
        "status": status,
        "is_active": camera.is_active,
        "direction": direction,
        "deployment_mode": deployment,
        "device_id": camera.device_id,
        "last_heartbeat_at": camera.last_heartbeat_at.isoformat()
        if camera.last_heartbeat_at
        else None,
        "last_frame_at": camera.last_frame_at.isoformat() if camera.last_frame_at else None,
        "health": {
            "online": online,
            "fps": fps,
            "latency_ms": camera.latency_ms if online else None,
            "bandwidth_kbps": camera.bandwidth_kbps if online else None,
            "cpu_usage_percent": (
                float(camera.cpu_usage_percent)
                if online and camera.cpu_usage_percent is not None
                else None
            ),
            "gpu_usage_percent": (
                float(camera.gpu_usage_percent)
                if online and camera.gpu_usage_percent is not None
                else None
            ),
            # Cumulative counter, not a live reading — meaningful either way.
            "dropped_frames": int(camera.dropped_frames or 0),
            "recognition_events_today": recognition_today,
            "updated_at": camera.health_updated_at.isoformat()
            if camera.health_updated_at
            else None,
        },
        "recognition_count_today": recognition_today,
        "online": online,
        "frame_rate_fps": fps,
    }


def _parse_payload(raw: object) -> dict | None:
    """LiveEvent.payload is stored as a JSON string; deserialize for the API."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except (ValueError, TypeError):
            return None
        return value if isinstance(value, dict) else None
    return None


async def build_dashboard(db: AsyncSession, org_id: list[int] | int | None) -> dict:
    now = datetime.now(timezone.utc)
    today = local_date(now)
    day_start_utc, day_end_utc = local_day_bounds_utc(today)
    heartbeat_threshold = now - timedelta(seconds=settings.camera_online_threshold_seconds)

    cam_stmt = (
        select(Camera)
        .join(Location, Camera.location_id == Location.id)
        .options(selectinload(Camera.location))
    )
    cam_stmt = apply_tenant_filter(cam_stmt, org_id, Location.organization_id)
    cam_stmt = cam_stmt.order_by(Camera.name)
    cameras = list((await db.execute(cam_stmt)).scalars().all())

    recognition_by_camera: dict[int, int] = {}
    if cameras:
        rec_stmt = (
            select(RecognitionEvent.camera_id, func.count())
            .where(
                RecognitionEvent.camera_id.isnot(None),
                RecognitionEvent.recognized_at >= day_start_utc,
                RecognitionEvent.recognized_at < day_end_utc,
            )
            .group_by(RecognitionEvent.camera_id)
        )
        if org_id is not None:
            rec_stmt = rec_stmt.join(Camera, RecognitionEvent.camera_id == Camera.id).join(
                Location, Camera.location_id == Location.id
            )
            rec_stmt = apply_tenant_filter(rec_stmt, org_id, Location.organization_id)
        for camera_id, count in (await db.execute(rec_stmt)).all():
            recognition_by_camera[camera_id] = count

    formatted_cameras = []
    fps_values: list[float] = []
    latency_values: list[int] = []
    total_dropped = 0
    cameras_online = 0

    for camera in cameras:
        online = _camera_is_online(camera, heartbeat_threshold)
        if online:
            cameras_online += 1
        recognition_today = recognition_by_camera.get(camera.id, 0)
        formatted = _format_camera(camera, online, recognition_today)
        formatted_cameras.append(formatted)
        if formatted["health"]["fps"] is not None:
            fps_values.append(formatted["health"]["fps"])
        if formatted["health"]["latency_ms"] is not None:
            latency_values.append(formatted["health"]["latency_ms"])
        total_dropped += formatted["health"]["dropped_frames"]

    cameras_offline = len(cameras) - cameras_online
    avg_fps = round(sum(fps_values) / len(fps_values), 2) if fps_values else None
    avg_latency = int(round(sum(latency_values) / len(latency_values))) if latency_values else None

    emp_stmt = select(func.count()).select_from(Employee).where(Employee.is_active.is_(True))
    emp_stmt = apply_employee_tenant_filter(emp_stmt, org_id, Employee.organization_id)
    active_employees = (await db.execute(emp_stmt)).scalar() or 0

    att_stmt = select(AttendanceRecord).where(AttendanceRecord.work_date == today)
    if org_id is not None:
        att_stmt = att_stmt.join(Employee, AttendanceRecord.employee_id == Employee.id)
        att_stmt = apply_employee_tenant_filter(att_stmt, org_id, Employee.organization_id)
    records = list((await db.execute(att_stmt)).scalars().all())

    present = sum(1 for r in records if r.status in ("present", "late"))
    late = sum(1 for r in records if r.status == "late")
    on_leave = sum(1 for r in records if r.status == "on_leave")
    # Mirrors /attendance/today: anyone neither present/late nor on leave today
    # counts as absent. (Counting by check_in_at instead would mark on-leave
    # employees absent and disagree with the attendance page.)
    absent = max(0, active_employees - present - on_leave)

    unknown_stmt = select(func.count()).select_from(RecognitionEvent).where(
        RecognitionEvent.result == RecognitionResult.unknown.value,
        RecognitionEvent.recognized_at >= day_start_utc,
        RecognitionEvent.recognized_at < day_end_utc,
    )
    if org_id is not None:
        unknown_stmt = unknown_stmt.where(
            RecognitionEvent.organization_id.in_(as_scope_ids(org_id))
        )
    unknown_today = (await db.execute(unknown_stmt)).scalar() or 0

    # Checked-in only, matching the visitor dashboard's "on site" count and the
    # On-site tab this KPI links to. Scheduled (not yet arrived) visitors are
    # not "active".
    visitor_stmt = select(func.count()).select_from(Visitor).where(
        Visitor.status == VisitorStatus.checked_in
    )
    visitor_stmt = apply_tenant_filter(visitor_stmt, org_id, Visitor.organization_id)
    active_visitors = (await db.execute(visitor_stmt)).scalar() or 0

    return {
        "active_cameras": cameras_online,
        "total_cameras": len(cameras),
        "employees_present": present,
        "employees_absent": absent,
        "employees_late": late,
        "employees_on_leave": on_leave,
        "total_employees": active_employees,
        "unknown_persons_today": unknown_today,
        "active_visitors": active_visitors,
        "camera_health": {
            "online": cameras_online,
            "offline": cameras_offline,
            "avg_fps": avg_fps,
            "avg_latency_ms": avg_latency,
            "total_dropped_frames": total_dropped,
        },
        "cameras": formatted_cameras,
    }


async def build_attendance_trend(
    db: AsyncSession, org_id: list[int] | int | None, days: int = 7
) -> dict:
    """Daily check-in volume for the last ``days`` calendar days (local time).

    Only counts attendance rows that actually exist (status ``present``/``late``),
    so the series reflects real check-ins rather than a back-filled headcount —
    historical "absent" can't be reconstructed reliably and is left out. Returns a
    contiguous, gap-filled list oldest→newest so the chart axis is uniform.
    """
    days = max(1, min(days, 31))
    today = local_date()
    start = today - timedelta(days=days - 1)

    stmt = (
        select(AttendanceRecord.work_date, AttendanceRecord.status, func.count())
        .where(AttendanceRecord.work_date >= start, AttendanceRecord.work_date <= today)
        .group_by(AttendanceRecord.work_date, AttendanceRecord.status)
    )
    if org_id is not None:
        stmt = stmt.join(Employee, AttendanceRecord.employee_id == Employee.id)
        stmt = apply_employee_tenant_filter(stmt, org_id, Employee.organization_id)

    buckets: dict[object, dict[str, int]] = {}
    for work_date, status, count in (await db.execute(stmt)).all():
        bucket = buckets.setdefault(work_date, {"on_time": 0, "late": 0})
        if status == "late":
            bucket["late"] += count
        elif status == "present":
            bucket["on_time"] += count

    out = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        bucket = buckets.get(day, {"on_time": 0, "late": 0})
        out.append(
            {
                "date": day.isoformat(),
                "on_time": bucket["on_time"],
                "late": bucket["late"],
                "total": bucket["on_time"] + bucket["late"],
            }
        )
    return {"days": out}


async def build_live_feed(db: AsyncSession, org_id: list[int] | int | None) -> dict:
    stmt = select(LiveEvent).order_by(LiveEvent.occurred_at.desc()).limit(50)
    stmt = apply_tenant_filter(stmt, org_id, LiveEvent.organization_id)
    events = list((await db.execute(stmt)).scalars().all())

    return {
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "message": e.message,
                "payload": _parse_payload(e.payload),
                "camera_id": e.camera_id,
                "employee_id": e.employee_id,
                "visitor_id": e.visitor_id,
                "occurred_at": e.occurred_at.isoformat() if e.occurred_at else None,
            }
            for e in events
        ]
    }
