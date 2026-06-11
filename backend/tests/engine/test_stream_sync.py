"""Tests for DB-backed stream registration (app.services.stream_sync)."""

from __future__ import annotations

import pytest

from app.engine.stream_manager import (
    CameraType,
    StreamProtocol,
    get_stream_manager,
)
from app.models.camera import Camera, CameraDirection, CameraStatus
from app.services.stream_sync import (
    protocol_for_url,
    register_camera,
    sync_streams_from_db,
)


def make_camera(**overrides) -> Camera:
    defaults = dict(
        id=1,
        location_id=2,
        zone="entry",
        name="Lobby cam",
        camera_type="rtsp",
        device_id="LOBBY-CAM",
        stream_url="rtsp://example/stream",
        target_fps=15,
        resolution_width=1280,
        resolution_height=720,
        direction=CameraDirection.both,
        status=CameraStatus.active,
        is_active=True,
    )
    defaults.update(overrides)
    return Camera(**defaults)


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeDb:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, stmt):
        return FakeResult(self._rows)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("rtsp://cam/1", StreamProtocol.RTSP),
        ("rtmp://cam/1", StreamProtocol.RTMP),
        ("http://cam/1", StreamProtocol.HTTP),
        ("https://cam/1", StreamProtocol.HTTPS),
        ("0", StreamProtocol.USB),
        ("12", StreamProtocol.USB),
    ],
)
def test_protocol_for_url(url, expected):
    assert protocol_for_url(url) == expected


def test_protocol_for_url_fallback():
    assert protocol_for_url("device:path", StreamProtocol.USB) == StreamProtocol.USB


def test_register_camera_maps_row_fields():
    manager = get_stream_manager()
    register_camera(manager, make_camera(), organization_id=7)

    stream = manager.get_stream(1)
    assert stream is not None
    assert stream.stream_url == "rtsp://example/stream"
    assert stream.protocol == StreamProtocol.RTSP
    assert stream.camera_type == CameraType.IP_CAMERA
    assert stream.organization_id == 7
    assert stream.location_id == 2
    assert stream.zone == "entry"
    assert stream.direction == "both"
    assert stream.target_fps == 15
    assert stream.resolution == (1280, 720)


def test_register_camera_usb_device_index():
    manager = get_stream_manager()
    register_camera(manager, make_camera(camera_type="usb", stream_url="0"), None)

    stream = manager.get_stream(1)
    assert stream.protocol == StreamProtocol.USB
    assert stream.camera_type == CameraType.USB_CAMERA


@pytest.mark.asyncio
async def test_sync_registers_active_cameras():
    db = FakeDb([(make_camera(), 7), (make_camera(id=2, device_id="CAM-2"), 7)])
    count = await sync_streams_from_db(db)

    manager = get_stream_manager()
    assert count == 2
    assert manager.get_stream(1) is not None
    assert manager.get_stream(2) is not None


@pytest.mark.asyncio
async def test_sync_leaves_unchanged_stream_alone():
    manager = get_stream_manager()
    register_camera(manager, make_camera(), organization_id=7)
    existing = manager.get_stream(1)

    await sync_streams_from_db(FakeDb([(make_camera(), 7)]))
    assert manager.get_stream(1) is existing


@pytest.mark.asyncio
async def test_sync_reregisters_on_url_change():
    manager = get_stream_manager()
    register_camera(manager, make_camera(), organization_id=7)

    await sync_streams_from_db(
        FakeDb([(make_camera(stream_url="rtsp://example/new"), 7)])
    )
    assert manager.get_stream(1).stream_url == "rtsp://example/new"


@pytest.mark.asyncio
async def test_sync_keeps_manually_registered_streams():
    manager = get_stream_manager()
    manager.add_stream(99, "rtsp://manual/stream")

    await sync_streams_from_db(FakeDb([]))
    assert manager.get_stream(99) is not None
