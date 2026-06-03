"""Lightweight IoU face tracker for consecutive video frames."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

_TRACK_TTL_SEC = 30.0
_sessions: dict[str, dict[int, "_Track"]] = {}


@dataclass
class _Track:
    track_id: int
    bbox: list[float]
    last_seen: float = field(default_factory=time.time)
    hits: int = 1


def _iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _prune(session_id: str, now: float) -> None:
    tracks = _sessions.get(session_id, {})
    stale = [tid for tid, t in tracks.items() if now - t.last_seen > _TRACK_TTL_SEC]
    for tid in stale:
        del tracks[tid]
    if not tracks and session_id in _sessions:
        del _sessions[session_id]


def assign_track(
    session_id: str | None,
    bbox: list[float] | None,
    *,
    iou_threshold: float = 0.35,
) -> dict:
    """
    Associate detected face bbox with a stable track_id for the session.
    Returns track_id (or None), is_new_track, track_hits.
    """
    if not session_id or not bbox:
        return {"track_id": None, "is_new_track": False, "track_hits": 0}

    now = time.time()
    _prune(session_id, now)
    tracks = _sessions.setdefault(session_id, {})

    best_id: int | None = None
    best_iou = 0.0
    for tid, track in tracks.items():
        score = _iou(bbox, track.bbox)
        if score > best_iou:
            best_iou = score
            best_id = tid

    if best_id is not None and best_iou >= iou_threshold:
        track = tracks[best_id]
        track.bbox = bbox
        track.last_seen = now
        track.hits += 1
        return {
            "track_id": best_id,
            "is_new_track": False,
            "track_hits": track.hits,
        }

    new_id = (max(tracks.keys(), default=0) + 1) if tracks else 1
    tracks[new_id] = _Track(track_id=new_id, bbox=bbox, last_seen=now)
    return {"track_id": new_id, "is_new_track": True, "track_hits": 1}
