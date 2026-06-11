"""Unit tests for the styled report exports (CSV / Excel / PDF)."""

from datetime import date, datetime, timezone

import pytest

from app.schemas.report import (
    AttendanceRangeEntry,
    AttendanceRangeReport,
    DailyEmployeeEntry,
    DailyReport,
    MonthlyEmployeeEntry,
    MonthlyReport,
    MonthlySummary,
)
from app.services import report_export


@pytest.fixture
def ctx() -> report_export.ExportContext:
    # Viewer at UTC+2 (JS getTimezoneOffset() = -120).
    return report_export.ExportContext(
        org_name="Acme Corp",
        generated_at=datetime(2026, 6, 11, 14, 30, tzinfo=timezone.utc),
        tz_offset=-120,
    )


@pytest.fixture
def daily() -> DailyReport:
    return DailyReport(
        date=date(2026, 6, 11),
        present=1,
        absent=1,
        late=0,
        on_leave=0,
        total_records=2,
        employees=[
            DailyEmployeeEntry(
                employee_code="EMP001",
                employee_name="Maria Garcia",
                status="present",
                check_in_at=datetime(2026, 6, 11, 6, 58, tzinfo=timezone.utc),
                check_out_at=datetime(2026, 6, 11, 15, 35, tzinfo=timezone.utc),
                worked_minutes=485,
                overtime_minutes=35,
            ),
            DailyEmployeeEntry(
                employee_code="EMP002", employee_name="Ahmed Ali", status="absent"
            ),
        ],
    )


@pytest.fixture
def monthly() -> MonthlyReport:
    return MonthlyReport(
        year=2026,
        month=6,
        total_working_days=21,
        employee_count=1,
        summary=MonthlySummary(
            total_working_days=21,
            attendance_percent=95.2,
            overtime_minutes=300,
            absence_count=1,
        ),
        employees=[
            MonthlyEmployeeEntry(
                employee_id=1,
                employee_code="EMP001",
                employee_name="Maria Garcia",
                department="Engineering",
                total_working_days=21,
                present_days=20,
                attendance_percent=95.2,
                overtime_minutes=300,
                overtime_hours=5.0,
                absence_count=1,
                late_count=2,
                on_leave_count=0,
            )
        ],
    )


@pytest.fixture
def attendance_range() -> AttendanceRangeReport:
    return AttendanceRangeReport(
        period_start=date(2026, 6, 4),
        period_end=date(2026, 6, 11),
        total_records=2,
        present=1,
        late_or_early=1,
        worked_minutes=943,
        overtime_minutes=35,
        entries=[
            AttendanceRangeEntry(
                work_date=date(2026, 6, 11),
                employee_code="EMP001",
                employee_name="Maria Garcia",
                department="Engineering",
                status="present",
                check_in_at=datetime(2026, 6, 11, 6, 58, tzinfo=timezone.utc),
                check_out_at=datetime(2026, 6, 11, 15, 35, tzinfo=timezone.utc),
                worked_minutes=485,
                overtime_minutes=35,
            ),
            AttendanceRangeEntry(
                work_date=date(2026, 6, 10),
                employee_code="EMP002",
                employee_name="Jan Novak",
                status="late",
                attendance_type="manual",
                check_in_at=datetime(2026, 6, 10, 7, 24, tzinfo=timezone.utc),
                check_out_at=datetime(2026, 6, 10, 15, 2, tzinfo=timezone.utc),
                worked_minutes=458,
                overtime_minutes=0,
            ),
        ],
    )


def test_attendance_export_all_formats(attendance_range, ctx):
    csv_data = report_export.export_attendance(attendance_range, "csv", ctx)
    assert csv_data.startswith(b"\xef\xbb\xbf")
    text = csv_data.decode("utf-8-sig")
    assert "Employee Code" in text
    assert "08:58" in text  # viewer TZ (UTC+2)
    assert "manual" in text  # attendance_type column

    xlsx_data = report_export.export_attendance(attendance_range, "xlsx", ctx)
    assert xlsx_data[:2] == b"PK"
    import io

    from openpyxl import load_workbook

    ws = load_workbook(io.BytesIO(xlsx_data)).active
    assert ws["A1"].value == "Attendance Report"

    pdf_data = report_export.export_attendance(attendance_range, "pdf", ctx)
    assert pdf_data[:5] == b"%PDF-"


def test_daily_csv_is_utf8_bom_with_viewer_times(daily, ctx):
    data = report_export.export_daily(daily, "csv", ctx)
    assert data.startswith(b"\xef\xbb\xbf")
    text = data.decode("utf-8-sig")
    assert "Employee Code" in text
    # 06:58 UTC rendered for a UTC+2 viewer.
    assert "08:58" in text
    assert "EMP002" in text


def test_monthly_csv_contains_machine_readable_numbers(monthly, ctx):
    text = report_export.export_monthly(monthly, "csv", ctx).decode("utf-8-sig")
    assert "Attendance Percent" in text
    assert "95.2" in text
    assert "Engineering" in text


def test_xlsx_exports_are_valid_workbooks(daily, monthly, ctx):
    import io

    from openpyxl import load_workbook

    for report, fn, expected_title in [
        (daily, report_export.export_daily, "Daily Attendance Report"),
        (monthly, report_export.export_monthly, "Monthly Attendance Report"),
    ]:
        data = fn(report, "xlsx", ctx)
        assert data[:2] == b"PK"  # zip container
        ws = load_workbook(io.BytesIO(data)).active
        assert ws["A1"].value == expected_title
        assert ws.freeze_panes is not None
        assert ws.auto_filter.ref is not None


def test_pdf_exports_have_pdf_signature(daily, monthly, ctx):
    assert report_export.export_daily(daily, "pdf", ctx)[:5] == b"%PDF-"
    assert report_export.export_monthly(monthly, "pdf", ctx)[:5] == b"%PDF-"


def test_pdf_renders_with_no_records(ctx):
    empty = DailyReport(
        date=date(2026, 6, 11), present=0, absent=0, late=0, on_leave=0,
        total_records=0, employees=[],
    )
    assert report_export.export_daily(empty, "pdf", ctx)[:5] == b"%PDF-"
    assert report_export.export_daily(empty, "xlsx", ctx)[:2] == b"PK"


def test_naive_datetimes_treated_as_utc(daily, ctx):
    daily.employees[0].check_in_at = datetime(2026, 6, 11, 6, 58)  # naive
    text = report_export.export_daily(daily, "csv", ctx).decode("utf-8-sig")
    assert "08:58" in text
