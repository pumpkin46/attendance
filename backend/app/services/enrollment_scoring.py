"""Enrollment scoring: computes overall enrollment quality with diversity analysis."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class EnrollmentStatus(str, Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    ACCEPTABLE = "acceptable"
    RE_ENROLL_REQUIRED = "re_enroll_required"


@dataclass
class EnrollmentScore:
    overall_score: float
    status: EnrollmentStatus
    image_quality_score: float
    pose_diversity_score: float
    lighting_diversity_score: float
    completeness_score: float
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "overall_score": round(self.overall_score, 2),
            "status": self.status.value,
            "image_quality_score": round(self.image_quality_score, 2),
            "pose_diversity_score": round(self.pose_diversity_score, 2),
            "lighting_diversity_score": round(self.lighting_diversity_score, 2),
            "completeness_score": round(self.completeness_score, 2),
            "details": self.details,
        }


REQUIRED_POSE_TYPES = {"front", "left", "right", "up", "down"}
OPTIONAL_POSE_TYPES = {"smiling", "neutral", "glasses", "without_glasses"}
ALL_POSE_TYPES = REQUIRED_POSE_TYPES | OPTIONAL_POSE_TYPES

MIN_IMAGES = 10
RECOMMENDED_IMAGES_MIN = 20
RECOMMENDED_IMAGES_MAX = 30


class EnrollmentScorer:
    """Calculate enrollment quality scores based on image diversity and quality."""

    def score(self, accepted_images: list[dict]) -> EnrollmentScore:
        if not accepted_images:
            return EnrollmentScore(
                overall_score=0.0,
                status=EnrollmentStatus.RE_ENROLL_REQUIRED,
                image_quality_score=0.0,
                pose_diversity_score=0.0,
                lighting_diversity_score=0.0,
                completeness_score=0.0,
            )

        image_quality = self._compute_image_quality_score(accepted_images)
        pose_diversity = self._compute_pose_diversity_score(accepted_images)
        lighting_diversity = self._compute_lighting_diversity_score(accepted_images)
        completeness = self._compute_completeness_score(accepted_images)

        overall = (
            0.30 * image_quality
            + 0.30 * pose_diversity
            + 0.20 * lighting_diversity
            + 0.20 * completeness
        )

        overall_100 = overall * 100
        status = self._determine_status(overall_100)

        return EnrollmentScore(
            overall_score=overall_100,
            status=status,
            image_quality_score=image_quality * 100,
            pose_diversity_score=pose_diversity * 100,
            lighting_diversity_score=lighting_diversity * 100,
            completeness_score=completeness * 100,
            details={
                "image_count": len(accepted_images),
                "unique_poses": list(self._get_unique_poses(accepted_images)),
                "required_poses_covered": list(
                    self._get_required_poses_covered(accepted_images)
                ),
                "missing_poses": list(
                    REQUIRED_POSE_TYPES - self._get_required_poses_covered(accepted_images)
                ),
            },
        )

    def _compute_image_quality_score(self, images: list[dict]) -> float:
        scores = [img.get("quality_score", 0.0) for img in images]
        if not scores:
            return 0.0
        return sum(scores) / len(scores)

    def _compute_pose_diversity_score(self, images: list[dict]) -> float:
        unique_poses = self._get_unique_poses(images)
        required_covered = len(unique_poses & REQUIRED_POSE_TYPES)
        optional_covered = len(unique_poses & OPTIONAL_POSE_TYPES)

        required_score = required_covered / len(REQUIRED_POSE_TYPES)
        optional_score = optional_covered / len(OPTIONAL_POSE_TYPES)

        return 0.7 * required_score + 0.3 * optional_score

    def _compute_lighting_diversity_score(self, images: list[dict]) -> float:
        brightness_values = []
        for img in images:
            checks = img.get("checks", {})
            brightness = checks.get("brightness_score")
            if brightness is not None:
                brightness_values.append(brightness)

        if len(brightness_values) < 2:
            return 0.5

        std = float(__import__("numpy").std(brightness_values))
        return min(1.0, std / 0.2 + 0.3)

    def _compute_completeness_score(self, images: list[dict]) -> float:
        count = len(images)
        if count >= RECOMMENDED_IMAGES_MIN:
            return 1.0
        if count >= MIN_IMAGES:
            return 0.7 + 0.3 * (count - MIN_IMAGES) / (RECOMMENDED_IMAGES_MIN - MIN_IMAGES)
        return count / MIN_IMAGES

    def _get_unique_poses(self, images: list[dict]) -> set[str]:
        poses = set()
        for img in images:
            pose = img.get("pose_type")
            if not pose:
                meta = img.get("face_metadata", {}) or {}
                pose = meta.get("detected_pose")
            if pose:
                poses.add(pose)
        return poses

    def _get_required_poses_covered(self, images: list[dict]) -> set[str]:
        return self._get_unique_poses(images) & REQUIRED_POSE_TYPES

    def _determine_status(self, score: float) -> EnrollmentStatus:
        if score >= 90:
            return EnrollmentStatus.EXCELLENT
        if score >= 80:
            return EnrollmentStatus.GOOD
        if score >= 70:
            return EnrollmentStatus.ACCEPTABLE
        return EnrollmentStatus.RE_ENROLL_REQUIRED


_scorer: EnrollmentScorer | None = None


def get_enrollment_scorer() -> EnrollmentScorer:
    global _scorer
    if _scorer is None:
        _scorer = EnrollmentScorer()
    return _scorer
