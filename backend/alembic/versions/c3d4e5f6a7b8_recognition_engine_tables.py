"""recognition engine tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "engine_streams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("camera_id", sa.Integer(), sa.ForeignKey("cameras.id", ondelete="CASCADE"), unique=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("stream_url", sa.String(512), nullable=False),
        sa.Column("protocol", sa.String(32), server_default="rtsp"),
        sa.Column("camera_type", sa.String(64), server_default="ip_camera"),
        sa.Column("mode", sa.String(32), server_default="live_stream"),
        sa.Column("status", sa.String(32), server_default="offline"),
        sa.Column("direction", sa.String(16), server_default="both"),
        sa.Column("zone", sa.String(64), nullable=True),
        sa.Column("target_fps", sa.Integer(), server_default="30"),
        sa.Column("resolution_width", sa.Integer(), nullable=True),
        sa.Column("resolution_height", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1"),
        sa.Column("last_frame_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_fps", sa.Numeric(6, 2), nullable=True),
        sa.Column("current_latency_ms", sa.Integer(), nullable=True),
        sa.Column("total_frames", sa.Integer(), server_default="0"),
        sa.Column("dropped_frames", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "engine_recognition_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("camera_id", sa.Integer(), sa.ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("result", sa.String(32), nullable=False),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("liveness_score", sa.Numeric(5, 4), nullable=True),
        sa.Column("liveness_passed", sa.Boolean(), server_default="0"),
        sa.Column("quality_score", sa.Numeric(5, 4), nullable=True),
        sa.Column("verification_level", sa.String(32), nullable=True),
        sa.Column("event_type", sa.String(32), nullable=True),
        sa.Column("track_id", sa.Integer(), nullable=True),
        sa.Column("processing_ms", sa.Integer(), nullable=True),
        sa.Column("pipeline_data", sa.JSON(), nullable=True),
        sa.Column("snapshot_path", sa.String(512), nullable=True),
        sa.Column("recognized_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_engine_recognition_logs_timestamp",
        "engine_recognition_logs",
        ["recognized_at"],
    )
    op.create_index(
        "ix_engine_recognition_logs_employee",
        "engine_recognition_logs",
        ["employee_id", "recognized_at"],
    )
    op.create_index(
        "ix_engine_recognition_logs_camera",
        "engine_recognition_logs",
        ["camera_id", "recognized_at"],
    )

    op.create_table(
        "unknown_person_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.String(128), unique=True),
        sa.Column("camera_id", sa.Integer(), sa.ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("locations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("zone", sa.String(64), nullable=True),
        sa.Column("confidence_score", sa.Numeric(5, 4), nullable=True),
        sa.Column("snapshot_path", sa.String(512), nullable=True),
        sa.Column("bbox_data", sa.JSON(), nullable=True),
        sa.Column("alert_sent", sa.Boolean(), server_default="0"),
        sa.Column("reviewed", sa.Boolean(), server_default="0"),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("review_result", sa.String(32), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_unknown_person_logs_detected_at",
        "unknown_person_logs",
        ["detected_at"],
    )
    op.create_index(
        "ix_unknown_person_logs_camera",
        "unknown_person_logs",
        ["camera_id", "detected_at"],
    )

    op.create_table(
        "engine_metrics_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("total_detections", sa.Integer(), server_default="0"),
        sa.Column("total_recognized", sa.Integer(), server_default="0"),
        sa.Column("total_unknown", sa.Integer(), server_default="0"),
        sa.Column("total_liveness_passed", sa.Integer(), server_default="0"),
        sa.Column("total_liveness_failed", sa.Integer(), server_default="0"),
        sa.Column("total_quality_rejected", sa.Integer(), server_default="0"),
        sa.Column("total_attendance_events", sa.Integer(), server_default="0"),
        sa.Column("avg_recognition_ms", sa.Numeric(8, 2), nullable=True),
        sa.Column("avg_detection_ms", sa.Numeric(8, 2), nullable=True),
        sa.Column("avg_liveness_ms", sa.Numeric(8, 2), nullable=True),
        sa.Column("active_cameras", sa.Integer(), server_default="0"),
        sa.Column("active_tracks", sa.Integer(), server_default="0"),
        sa.Column("index_size", sa.Integer(), server_default="0"),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_engine_metrics_snapshots_recorded_at",
        "engine_metrics_snapshots",
        ["recorded_at"],
    )


def downgrade() -> None:
    op.drop_table("engine_metrics_snapshots")
    op.drop_table("unknown_person_logs")
    op.drop_table("engine_recognition_logs")
    op.drop_table("engine_streams")
