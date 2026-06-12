"""SSRF guard tests for client-supplied stream URLs (Tier-2 fix).

The validator must block the SSRF targets (loopback, link-local/cloud
metadata, file reads) while keeping the product's legitimate use case:
IP cameras on private RFC1918 LAN addresses.
"""

from __future__ import annotations

from app.services.stream_capture import validate_stream_url


class TestSchemeAllowlist:
    def test_rtsp_and_http_schemes_allowed(self):
        assert validate_stream_url("rtsp://192.168.1.20:554/stream1") is None
        assert validate_stream_url("rtsps://192.168.1.20:322/stream1") is None
        assert validate_stream_url("http://192.168.1.20/mjpeg") is None
        assert validate_stream_url("https://192.168.1.20/mjpeg") is None

    def test_file_scheme_rejected(self):
        assert validate_stream_url("file:///etc/passwd") is not None

    def test_bare_path_rejected(self):
        assert validate_stream_url("C:/Windows/system32/config/SAM") is not None
        assert validate_stream_url("/dev/video0") is not None

    def test_other_schemes_rejected(self):
        assert validate_stream_url("ftp://192.168.1.20/x") is not None
        assert validate_stream_url("gopher://192.168.1.20/x") is not None


class TestHostRestrictions:
    def test_loopback_rejected(self):
        assert validate_stream_url("http://127.0.0.1:8000/admin") is not None
        assert validate_stream_url("rtsp://localhost/stream") is not None
        assert validate_stream_url("http://[::1]/admin") is not None

    def test_link_local_metadata_rejected(self):
        assert validate_stream_url("http://169.254.169.254/latest/meta-data/") is not None
        assert validate_stream_url("rtsp://169.254.10.10/stream") is not None

    def test_private_lan_cameras_allowed(self):
        # RFC1918 is where real cameras live - must NOT be blocked.
        assert validate_stream_url("rtsp://10.0.0.5:554/ch0") is None
        assert validate_stream_url("rtsp://172.16.3.4/live") is None
        assert validate_stream_url("rtsp://192.168.0.99/main") is None

    def test_public_address_allowed(self):
        assert validate_stream_url("rtsp://8.8.8.8/stream") is None

    def test_missing_host_rejected(self):
        assert validate_stream_url("rtsp://") is not None

    def test_unresolvable_host_rejected(self):
        assert (
            validate_stream_url("rtsp://no-such-host.invalid./stream") is not None
        )
