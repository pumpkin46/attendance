"""
Stage 3: Face Tracking — Multi-face tracker with persistent IDs.

Features:
- Track 100+ faces simultaneously
- Persistent face IDs across frames
- Track recovery after brief occlusion
- Lost face detection
- Reduced CPU/GPU usage via deduplication
- Per-camera tracking sessions
- Cooldown to prevent repeated processing
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.engine.config import engine_config
from app.engine.face_detector import DetectedFace


@dataclass
class FaceTrack:
    track_id: int
    camera_id: int
    bbox: list[float]
    last_seen: float
    first_seen: float
    hits: int = 1
    last_recognized_at: float = 0.0
    employee_id: str | None = None
    confidence: float = 0.0
    is_unknown: bool = False
    lost_frames: int = 0
    # Last recognition outcome, kept so a live overlay can colour the box
    # (recognized / unknown / spoof) without re-running the pipeline.
    liveness_passed: bool | None = None
    reason: str | None = None

    @property
    def age_seconds(self) -> float:
        return time.time() - self.first_seen

    @property
    def since_last_recognition(self) -> float:
        if self.last_recognized_at == 0:
            return float("inf")
        return time.time() - self.last_recognized_at

    @property
    def needs_recognition(self) -> bool:
        cfg = engine_config.tracking
        if self.hits < cfg.min_hits_for_recognition:
            return False
        if self.employee_id and self.since_last_recognition < cfg.cooldown_seconds:
            return False
        if self.is_unknown and self.since_last_recognition < cfg.cooldown_seconds * 2:
            return False
        return True


@dataclass
class TrackingResult:
    track_id: int
    is_new_track: bool
    track_hits: int
    needs_recognition: bool
    cooldown_active: bool


class MultiCameraTracker:
    """IoU-based face tracker supporting multiple cameras and 100+ simultaneous tracks."""

    def __init__(self) -> None:
        self._tracks: dict[int, dict[int, FaceTrack]] = {}
        self._next_track_id: dict[int, int] = {}

    @property
    def total_active_tracks(self) -> int:
        return sum(len(tracks) for tracks in self._tracks.values())

    def get_camera_tracks(self, camera_id: int) -> dict[int, FaceTrack]:
        return self._tracks.get(camera_id, {})

    def update(self, camera_id: int, faces: list[DetectedFace]) -> list[tuple[DetectedFace, TrackingResult]]:
        """Update tracks for a camera with new detections. Returns face-track pairs."""
        cfg = engine_config.tracking
        now = time.time()

        self._prune(camera_id, now)
        tracks = self._tracks.setdefault(camera_id, {})
        results: list[tuple[DetectedFace, TrackingResult]] = []

        matched_track_ids: set[int] = set()
        matched_face_indices: set[int] = set()

        assignments: list[tuple[int, int, float]] = []
        for fi, face in enumerate(faces):
            face_bbox = face.bbox_xyxy
            for tid, track in tracks.items():
                iou = self._compute_iou(face_bbox, track.bbox)
                if iou >= cfg.iou_threshold:
                    assignments.append((fi, tid, iou))

        assignments.sort(key=lambda x: x[2], reverse=True)

        for fi, tid, iou in assignments:
            if fi in matched_face_indices or tid in matched_track_ids:
                continue
            matched_face_indices.add(fi)
            matched_track_ids.add(tid)

            track = tracks[tid]
            track.bbox = faces[fi].bbox_xyxy
            track.last_seen = now
            track.hits += 1
            track.lost_frames = 0

            results.append((faces[fi], TrackingResult(
                track_id=tid,
                is_new_track=False,
                track_hits=track.hits,
                needs_recognition=track.needs_recognition,
                cooldown_active=not track.needs_recognition and track.employee_id is not None,
            )))

        for fi, face in enumerate(faces):
            if fi in matched_face_indices:
                continue

            if len(tracks) >= cfg.max_tracks:
                continue

            new_id = self._next_id(camera_id)
            track = FaceTrack(
                track_id=new_id,
                camera_id=camera_id,
                bbox=face.bbox_xyxy,
                last_seen=now,
                first_seen=now,
            )
            tracks[new_id] = track

            results.append((face, TrackingResult(
                track_id=new_id,
                is_new_track=True,
                track_hits=1,
                needs_recognition=False,
                cooldown_active=False,
            )))

        for tid in set(tracks.keys()) - matched_track_ids:
            tracks[tid].lost_frames += 1

        return results

    def mark_recognized(
        self,
        camera_id: int,
        track_id: int,
        employee_id: str | None,
        confidence: float,
        *,
        liveness_passed: bool | None = None,
        reason: str | None = None,
    ) -> None:
        tracks = self._tracks.get(camera_id, {})
        track = tracks.get(track_id)
        if track:
            track.last_recognized_at = time.time()
            track.employee_id = employee_id
            track.confidence = confidence
            track.is_unknown = employee_id is None
            track.liveness_passed = liveness_passed
            track.reason = reason

    def get_track(self, camera_id: int, track_id: int) -> FaceTrack | None:
        return self._tracks.get(camera_id, {}).get(track_id)

    def get_stats(self) -> dict:
        total = 0
        recognized = 0
        unknown = 0
        for tracks in self._tracks.values():
            for track in tracks.values():
                total += 1
                if track.employee_id:
                    recognized += 1
                elif track.is_unknown:
                    unknown += 1
        return {
            "total_tracks": total,
            "recognized_tracks": recognized,
            "unknown_tracks": unknown,
            "cameras_tracking": len(self._tracks),
        }

    def _prune(self, camera_id: int, now: float) -> None:
        cfg = engine_config.tracking
        tracks = self._tracks.get(camera_id, {})
        stale = [
            tid for tid, t in tracks.items()
            if now - t.last_seen > cfg.max_age_seconds
        ]
        for tid in stale:
            del tracks[tid]

    def _next_id(self, camera_id: int) -> int:
        current = self._next_track_id.get(camera_id, 0) + 1
        self._next_track_id[camera_id] = current
        return current

    @staticmethod
    def _compute_iou(a: list[float], b: list[float]) -> float:
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        ix1 = max(ax1, bx1)
        iy1 = max(ay1, by1)
        ix2 = min(ax2, bx2)
        iy2 = min(ay2, by2)
        inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
        if inter <= 0:
            return 0.0
        area_a = (ax2 - ax1) * (ay2 - ay1)
        area_b = (bx2 - bx1) * (by2 - by1)
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0


_tracker: MultiCameraTracker | None = None


def get_tracker() -> MultiCameraTracker:
    global _tracker
    if _tracker is None:
        _tracker = MultiCameraTracker()
    return _tracker
