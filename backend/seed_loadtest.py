"""Load-test data seeder.

Bulk-inserts *representative* row counts so the k6 latency tests
(`loadtest/k6/*.js`) measure realistic query plans instead of trivially-empty
tables. Seeds exactly the entities the read endpoints touch:

    employees      → GET /api/v1/employees
    attendance     → GET /api/v1/attendance?date_from..date_to
    audit logs     → GET /api/v1/audit-logs
    cameras        → GET /api/v1/cameras   (+ monitoring dashboard)
    notifications  → GET /api/v1/notifications   (targeted at the admin user)
    recognition    → feeds the monitoring dashboard's per-camera / unknown counts

Run the base seeder first (it creates the org, admin user, location, shifts);
this script is idempotent and skips if its own data is already present.

    cd backend
    alembic upgrade head
    python seed.py            # base: org, admin, 5 demo employees
    python seed_loadtest.py   # bulk load-test volume

Tune volume via env vars (defaults in brackets):
    LOADTEST_EMPLOYEES        [1000]   active employees
    LOADTEST_ATTENDANCE_DAYS  [90]     days of history (× employees ≈ row count)
    LOADTEST_CAMERAS          [100]    cameras (read endpoint pages 100)
    LOADTEST_AUDIT_LOGS       [20000]  audit-log rows
    LOADTEST_NOTIFICATIONS    [500]    notifications for the admin user
    LOADTEST_RECOGNITION      [2000]   recognition events (recent + today)
    LOADTEST_RESET            [0]      if "1", delete prior load-test data first
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import delete, insert, select

from app.core.database import async_session_factory
from app.models.attendance import AttendanceRecord
from app.models.audit import AuditLog
from app.models.camera import Camera, CameraDirection, CameraStatus, DeploymentMode
from app.models.employee import Employee
from app.models.location import Location
from app.models.notification import Notification
from app.models.organization import Branch, Department, Organization
from app.models.recognition import RecognitionEvent, RecognitionResult
from app.models.user import User

# Deterministic so reruns produce the same distribution.
RNG = random.Random(1337)

# Code prefixes used to tag (and later identify/reset) load-test rows.
EMP_CODE_PREFIX = "LT"          # employee_code: LT0000001
CAM_DEVICE_PREFIX = "LT-CAM-"   # device_id:     LT-CAM-00001
LOCATION_PREFIX = "Load-Test Site"
SENTINEL_EMP_CODE = f"{EMP_CODE_PREFIX}0000001"

BATCH = 5000


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        print(f"[loadtest] {name}={raw!r} is not an integer; using default {default}")
        return default


async def _bulk_insert(db, model, rows: list[dict]) -> None:
    """Insert rows in batches via executemany; commit per batch to cap memory."""
    for start in range(0, len(rows), BATCH):
        chunk = rows[start : start + BATCH]
        await db.execute(insert(model), chunk)
        await db.commit()


async def _reset(db, emp_ids: list[int]) -> None:
    """Remove previously-seeded load-test data (cascades drop attendance)."""
    print("[loadtest] LOADTEST_RESET=1 - deleting prior load-test data...")
    await db.execute(delete(Camera).where(Camera.device_id.like(f"{CAM_DEVICE_PREFIX}%")))
    await db.execute(
        delete(AuditLog).where(AuditLog.action.like("loadtest.%"))
    )
    await db.execute(
        delete(Notification).where(Notification.type == "loadtest.notification")
    )
    if emp_ids:
        await db.execute(
            delete(RecognitionEvent).where(RecognitionEvent.employee_id.in_(emp_ids))
        )
        # attendance_records FK ON DELETE CASCADE handles attendance.
        await db.execute(delete(Employee).where(Employee.id.in_(emp_ids)))
    # Locations last — cameras/employees referencing them are already gone.
    await db.execute(delete(Location).where(Location.name.like(f"{LOCATION_PREFIX}%")))
    await db.commit()


async def seed() -> None:
    n_employees = _env_int("LOADTEST_EMPLOYEES", 1000)
    n_days = _env_int("LOADTEST_ATTENDANCE_DAYS", 90)
    n_cameras = _env_int("LOADTEST_CAMERAS", 100)
    n_audit = _env_int("LOADTEST_AUDIT_LOGS", 20000)
    n_notif = _env_int("LOADTEST_NOTIFICATIONS", 500)
    n_recog = _env_int("LOADTEST_RECOGNITION", 2000)
    reset = os.environ.get("LOADTEST_RESET") == "1"

    async with async_session_factory() as db:
        org = (await db.execute(select(Organization).limit(1))).scalar_one_or_none()
        if org is None:
            print("[loadtest] No organization found. Run `python seed.py` first.")
            return

        branch = (
            await db.execute(select(Branch).where(Branch.organization_id == org.id).limit(1))
        ).scalar_one_or_none()
        department = (
            await db.execute(
                select(Department).where(Department.organization_id == org.id).limit(1)
            )
        ).scalar_one_or_none()
        location = (
            await db.execute(
                select(Location).where(Location.organization_id == org.id).limit(1)
            )
        ).scalar_one_or_none()
        if location is None:
            print("[loadtest] No location found. Run `python seed.py` first.")
            return

        admin = (
            await db.execute(
                select(User)
                .where(User.organization_id == org.id, User.email == "admin@attendance.local")
                .limit(1)
            )
        ).scalar_one_or_none()
        if admin is None:
            admin = (
                await db.execute(
                    select(User).where(User.organization_id == org.id).limit(1)
                )
            ).scalar_one_or_none()
        if admin is None:
            print("[loadtest] No admin user found. Run `python seed.py` first.")
            return

        branch_id = branch.id if branch else None
        department_id = department.id if department else None

        existing_ids = list(
            (
                await db.execute(
                    select(Employee.id).where(
                        Employee.employee_code.like(f"{EMP_CODE_PREFIX}%")
                    )
                )
            )
            .scalars()
            .all()
        )

        if reset:
            await _reset(db, existing_ids)
            existing_ids = []
        elif existing_ids:
            print(
                f"[loadtest] Already seeded ({len(existing_ids)} load-test employees). "
                "Set LOADTEST_RESET=1 to rebuild. Skipping."
            )
            return

        print(
            f"[loadtest] Seeding org #{org.id}: {n_employees} employees, "
            f"{n_days}d attendance, {n_cameras} cameras, {n_audit} audit logs, "
            f"{n_notif} notifications, {n_recog} recognition events."
        )

        now = datetime.now(timezone.utc)
        today = date.today()
        job_titles = ["Operator", "Analyst", "Technician", "Supervisor", "Coordinator", "Engineer"]
        depts = ["Operations", "Security", "Logistics", "Maintenance", "Administration"]

        # ── Locations (a handful, so cameras spread across them) ──────────────
        # Idempotent: only create the ones that don't already exist.
        existing_loc_names = set(
            (
                await db.execute(
                    select(Location.name).where(
                        Location.organization_id == org.id,
                        Location.name.like(f"{LOCATION_PREFIX}%"),
                    )
                )
            )
            .scalars()
            .all()
        )
        extra_locations = [
            {
                "organization_id": org.id,
                "branch_id": branch_id,
                "name": name,
                "address": f"{i} Load Test Ave",
                "timezone": "UTC",
                "is_active": True,
            }
            for i in range(1, 4)
            if (name := f"{LOCATION_PREFIX} {i}") not in existing_loc_names
        ]
        if extra_locations:
            await db.execute(insert(Location), extra_locations)
            await db.commit()
        location_ids = list(
            (
                await db.execute(select(Location.id).where(Location.organization_id == org.id))
            )
            .scalars()
            .all()
        )

        # ── Employees ─────────────────────────────────────────────────────────
        emp_rows = []
        for i in range(1, n_employees + 1):
            emp_rows.append(
                {
                    "organization_id": org.id,
                    "location_id": RNG.choice(location_ids),
                    "branch_id": branch_id,
                    "department_id": department_id,
                    "employee_code": f"{EMP_CODE_PREFIX}{i:07d}",
                    "first_name": f"Load{i}",
                    "last_name": RNG.choice(["Tester", "Demo", "Sample", "Bench"]),
                    "email": f"loadtest+{i}@demo.local",
                    "department": RNG.choice(depts),
                    "job_title": RNG.choice(job_titles),
                    "hire_date": today - timedelta(days=RNG.randint(30, 1500)),
                    "is_active": True,
                    "face_enrolled": RNG.random() < 0.85,
                }
            )
        await _bulk_insert(db, Employee, emp_rows)
        emp_ids = list(
            (
                await db.execute(
                    select(Employee.id).where(
                        Employee.employee_code.like(f"{EMP_CODE_PREFIX}%")
                    )
                )
            )
            .scalars()
            .all()
        )
        print(f"[loadtest]   [ok] {len(emp_ids)} employees")

        # ── Cameras ───────────────────────────────────────────────────────────
        cam_rows = []
        for i in range(1, n_cameras + 1):
            online = RNG.random() < 0.9
            cam_rows.append(
                {
                    "location_id": RNG.choice(location_ids),
                    "zone": RNG.choice(["entrance", "lobby", "floor-1", "floor-2", "exit", "gate"]),
                    "floor": str(RNG.randint(1, 5)),
                    "name": f"Load-Test Camera {i:04d}",
                    "camera_type": "rtsp",
                    "device_id": f"{CAM_DEVICE_PREFIX}{i:05d}",
                    "stream_url": f"rtsp://10.0.0.{i % 254 + 1}:554/stream",
                    "target_fps": 15,
                    "resolution_width": 1920,
                    "resolution_height": 1080,
                    "direction": CameraDirection.both,
                    "deployment_mode": DeploymentMode.cloud,
                    "status": CameraStatus.active
                    if online
                    else RNG.choice([CameraStatus.inactive, CameraStatus.maintenance]),
                    "is_active": True,
                    "last_heartbeat_at": now - timedelta(seconds=RNG.randint(0, 60)) if online else now - timedelta(hours=2),
                    "frame_rate_fps": round(RNG.uniform(12, 15), 2),
                    "last_frame_at": now - timedelta(seconds=RNG.randint(0, 30)),
                    "latency_ms": RNG.randint(20, 200),
                    "bandwidth_kbps": RNG.randint(1000, 8000),
                    "cpu_usage_percent": round(RNG.uniform(10, 80), 2),
                    "gpu_usage_percent": round(RNG.uniform(10, 90), 2),
                    "dropped_frames": RNG.randint(0, 50),
                    "health_updated_at": now,
                }
            )
        await _bulk_insert(db, Camera, cam_rows)
        cam_ids = list(
            (
                await db.execute(
                    select(Camera.id).where(Camera.device_id.like(f"{CAM_DEVICE_PREFIX}%"))
                )
            )
            .scalars()
            .all()
        )
        print(f"[loadtest]   [ok] {len(cam_ids)} cameras")

        # ── Attendance (one row per employee per work day) ────────────────────
        statuses = ["present", "present", "present", "late", "absent", "early_leave"]
        att_rows = []
        total_att = 0
        for day_offset in range(n_days):
            work_date = today - timedelta(days=day_offset)
            if work_date.weekday() >= 5:  # skip weekends
                continue
            for emp_id in emp_ids:
                status = RNG.choice(statuses)
                if status == "absent":
                    check_in = check_out = None
                    worked = overtime = 0
                else:
                    base_in = datetime.combine(work_date, time(9, 0), tzinfo=timezone.utc)
                    late_min = RNG.randint(16, 90) if status == "late" else RNG.randint(-15, 15)
                    check_in = base_in + timedelta(minutes=late_min)
                    work_len = RNG.randint(240, 540) if status == "early_leave" else RNG.randint(480, 600)
                    check_out = check_in + timedelta(minutes=work_len)
                    worked = work_len
                    overtime = max(0, work_len - 480)
                att_rows.append(
                    {
                        "employee_id": emp_id,
                        "location_id": RNG.choice(location_ids),
                        "camera_id": RNG.choice(cam_ids) if cam_ids else None,
                        "work_date": work_date,
                        "check_in_at": check_in,
                        "check_out_at": check_out,
                        "check_in_method": "face" if check_in else None,
                        "check_out_method": "face" if check_out else None,
                        "worked_minutes": worked,
                        "overtime_minutes": overtime,
                        "status": status,
                        "attendance_type": "regular",
                    }
                )
                # Flush periodically to keep the in-memory list bounded.
                if len(att_rows) >= BATCH:
                    await db.execute(insert(AttendanceRecord), att_rows)
                    await db.commit()
                    total_att += len(att_rows)
                    att_rows = []
        if att_rows:
            await db.execute(insert(AttendanceRecord), att_rows)
            await db.commit()
            total_att += len(att_rows)
        print(f"[loadtest]   [ok] {total_att} attendance records")

        # ── Audit logs ────────────────────────────────────────────────────────
        actions = [
            "loadtest.employee.update",
            "loadtest.attendance.manual",
            "loadtest.camera.update",
            "loadtest.recognition.identify",
            "loadtest.auth.login",
        ]
        entities = ["employee", "camera", "attendance_record", "recognition_event"]
        audit_rows = []
        for i in range(n_audit):
            created = now - timedelta(minutes=RNG.randint(0, n_days * 24 * 60))
            audit_rows.append(
                {
                    "user_id": admin.id,
                    "action": RNG.choice(actions),
                    "entity_type": RNG.choice(entities),
                    "entity_id": RNG.randint(1, max(1, n_employees)),
                    "ip_address": f"10.0.{RNG.randint(0, 255)}.{RNG.randint(1, 254)}",
                    "user_agent": "k6-loadtest/1.0",
                    "new_values": {"field": "value", "seq": i},
                    "created_at": created,
                }
            )
        await _bulk_insert(db, AuditLog, audit_rows)
        print(f"[loadtest]   [ok] {n_audit} audit logs")

        # ── Notifications (targeted at the admin user) ────────────────────────
        notif_types = ["anomaly.detected", "camera.offline", "visitor.arrived", "attendance.late"]
        notif_rows = []
        for i in range(n_notif):
            ntype = RNG.choice(notif_types)
            created = now - timedelta(minutes=RNG.randint(0, n_days * 24 * 60))
            notif_rows.append(
                {
                    "id": str(uuid.uuid4()),
                    "type": "loadtest.notification",
                    "notifiable_type": "user",
                    "notifiable_id": admin.id,
                    "data": json.dumps({"title": ntype, "body": f"Load-test notification #{i}"}),
                    "read_at": None if RNG.random() < 0.4 else created,
                    "created_at": created,
                }
            )
        await _bulk_insert(db, Notification, notif_rows)
        print(f"[loadtest]   [ok] {n_notif} notifications")

        # ── Recognition events (recent + today, feeds the dashboard) ──────────
        results = [
            RecognitionResult.matched,
            RecognitionResult.matched,
            RecognitionResult.matched,
            RecognitionResult.unknown,
            RecognitionResult.low_confidence,
            RecognitionResult.liveness_failed,
        ]
        recog_rows = []
        for i in range(n_recog):
            # Bias ~40% to today so the dashboard's "today" group-by has data.
            if RNG.random() < 0.4:
                recognized = now - timedelta(minutes=RNG.randint(0, 12 * 60))
            else:
                recognized = now - timedelta(days=RNG.randint(1, n_days), minutes=RNG.randint(0, 1440))
            result = RNG.choice(results)
            recog_rows.append(
                {
                    "organization_id": org.id,
                    "camera_id": RNG.choice(cam_ids) if cam_ids else None,
                    "employee_id": RNG.choice(emp_ids) if result == RecognitionResult.matched else None,
                    "result": result,
                    "confidence": round(RNG.uniform(0.5, 0.99), 4),
                    "liveness_passed": result == RecognitionResult.matched,
                    "processing_ms": RNG.randint(80, 260),
                    "recognized_at": recognized,
                }
            )
        await _bulk_insert(db, RecognitionEvent, recog_rows)
        print(f"[loadtest]   [ok] {n_recog} recognition events")

        print("[loadtest] Done. Run the k6 scripts against this dataset.")


if __name__ == "__main__":
    asyncio.run(seed())
