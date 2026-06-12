"""Camera CRUD stream_url validation: USB device-index exemption + SSRF rejection.

USB cameras store a bare numeric device index ("0") as stream_url, which the
engine opens as int(url). That must bypass URL validation, while file:// and
loopback URLs stay rejected and clearing the URL stays allowed.
"""

from __future__ import annotations

import pytest

from app.core.errors import ValidationError
from app.models.location import Location
from app.models.organization import Organization
from app.schemas.camera import CameraCreate, CameraUpdate
from app.services import camera_service


async def _make_location(db) -> Location:
    org = Organization(id=1, name="Org 1", code="ORG1")
    db.add(org)
    await db.flush()
    location = Location(organization_id=org.id, name="HQ")
    db.add(location)
    await db.flush()
    return location


async def test_create_accepts_usb_device_index(db_session):
    location = await _make_location(db_session)
    camera = await camera_service.create_camera(
        db_session,
        CameraCreate(
            location_id=location.id,
            name="Front Door USB",
            camera_type="usb",
            stream_url="0",
        ),
    )
    assert camera.stream_url == "0"


async def test_update_accepts_usb_device_index(db_session):
    location = await _make_location(db_session)
    camera = await camera_service.create_camera(
        db_session,
        CameraCreate(location_id=location.id, name="Lobby USB", camera_type="usb"),
    )
    updated = await camera_service.update_camera(
        db_session, camera.id, None, CameraUpdate(stream_url="1")
    )
    assert updated.stream_url == "1"


async def test_create_rejects_file_url(db_session):
    location = await _make_location(db_session)
    with pytest.raises(ValidationError):
        await camera_service.create_camera(
            db_session,
            CameraCreate(
                location_id=location.id,
                name="Bad",
                stream_url="file:///etc/passwd",
            ),
        )


async def test_create_rejects_loopback_url(db_session):
    location = await _make_location(db_session)
    with pytest.raises(ValidationError):
        await camera_service.create_camera(
            db_session,
            CameraCreate(
                location_id=location.id,
                name="Bad",
                stream_url="http://127.0.0.1:8000/admin",
            ),
        )


async def test_update_rejects_loopback_url(db_session):
    location = await _make_location(db_session)
    camera = await camera_service.create_camera(
        db_session, CameraCreate(location_id=location.id, name="Cam")
    )
    with pytest.raises(ValidationError):
        await camera_service.update_camera(
            db_session,
            camera.id,
            None,
            CameraUpdate(stream_url="http://127.0.0.1:8000/admin"),
        )


async def test_update_allows_clearing_stream_url(db_session):
    location = await _make_location(db_session)
    camera = await camera_service.create_camera(
        db_session,
        CameraCreate(
            location_id=location.id,
            name="Cam",
            stream_url="rtsp://192.168.1.20:554/stream1",
        ),
    )
    assert camera.stream_url == "rtsp://192.168.1.20:554/stream1"

    updated = await camera_service.update_camera(
        db_session, camera.id, None, CameraUpdate(stream_url=None)
    )
    assert updated.stream_url is None
