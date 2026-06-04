"""Face image processing: alignment, cropping, and enhancement for enrollment."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class ProcessedFaceImage:
    aligned_face: np.ndarray
    cropped_face: np.ndarray
    enhanced_face: np.ndarray
    original_shape: tuple[int, int]
    face_bbox: tuple[int, int, int, int]
    eye_positions: tuple[tuple[float, float], tuple[float, float]] | None
    processing_applied: list[str]


class FaceImageProcessor:
    """Handles face alignment, cropping, and enhancement for enrollment images."""

    DESIRED_FACE_SIZE = (224, 224)
    DESIRED_LEFT_EYE = (0.35, 0.35)

    def process(
        self,
        image: np.ndarray,
        landmarks: np.ndarray | None = None,
        bbox: tuple[int, int, int, int] | None = None,
    ) -> ProcessedFaceImage:
        h, w = image.shape[:2]
        processing_applied: list[str] = []
        eye_positions = None

        if bbox is None:
            bbox = (0, 0, w, h)

        cropped = self._crop_face(image, bbox)
        processing_applied.append("crop")

        if landmarks is not None and len(landmarks) >= 2:
            left_eye = (float(landmarks[0][0]), float(landmarks[0][1]))
            right_eye = (float(landmarks[1][0]), float(landmarks[1][1]))
            eye_positions = (left_eye, right_eye)
            aligned = self._align_face(image, left_eye, right_eye)
            processing_applied.append("align")
        else:
            aligned = cropped.copy()

        enhanced = self._enhance(aligned)
        processing_applied.append("enhance")

        return ProcessedFaceImage(
            aligned_face=aligned,
            cropped_face=cropped,
            enhanced_face=enhanced,
            original_shape=(h, w),
            face_bbox=bbox,
            eye_positions=eye_positions,
            processing_applied=processing_applied,
        )

    def _crop_face(
        self, image: np.ndarray, bbox: tuple[int, int, int, int], margin: float = 0.2
    ) -> np.ndarray:
        """Crop face region with configurable margin."""
        h, w = image.shape[:2]
        x1, y1, x2, y2 = bbox
        face_w = x2 - x1
        face_h = y2 - y1

        margin_x = int(face_w * margin)
        margin_y = int(face_h * margin)

        cx1 = max(0, x1 - margin_x)
        cy1 = max(0, y1 - margin_y)
        cx2 = min(w, x2 + margin_x)
        cy2 = min(h, y2 + margin_y)

        crop = image[cy1:cy2, cx1:cx2]
        if crop.size == 0:
            return image

        return cv2.resize(crop, self.DESIRED_FACE_SIZE, interpolation=cv2.INTER_AREA)

    def _align_face(
        self,
        image: np.ndarray,
        left_eye: tuple[float, float],
        right_eye: tuple[float, float],
    ) -> np.ndarray:
        """Align face based on eye positions using affine transformation."""
        dx = right_eye[0] - left_eye[0]
        dy = right_eye[1] - left_eye[1]
        angle = float(np.degrees(np.arctan2(dy, dx)))

        eye_center = (
            (left_eye[0] + right_eye[0]) / 2.0,
            (left_eye[1] + right_eye[1]) / 2.0,
        )

        dist = float(np.sqrt(dx * dx + dy * dy))
        desired_dist = (1.0 - 2 * self.DESIRED_LEFT_EYE[0]) * self.DESIRED_FACE_SIZE[0]
        scale = desired_dist / max(dist, 1e-6)

        M = cv2.getRotationMatrix2D(eye_center, angle, scale)
        M[0, 2] += self.DESIRED_FACE_SIZE[0] * 0.5 - eye_center[0]
        M[1, 2] += self.DESIRED_FACE_SIZE[1] * self.DESIRED_LEFT_EYE[1] - eye_center[1]

        aligned = cv2.warpAffine(
            image, M, self.DESIRED_FACE_SIZE, flags=cv2.INTER_CUBIC
        )
        return aligned

    def _enhance(self, image: np.ndarray) -> np.ndarray:
        """Apply brightness correction, contrast enhancement, and noise reduction."""
        if image.size == 0:
            return image

        enhanced = image.copy()
        enhanced = self._correct_brightness(enhanced)
        enhanced = self._correct_contrast(enhanced)
        enhanced = self._reduce_noise(enhanced)
        return enhanced

    def _correct_brightness(self, image: np.ndarray) -> np.ndarray:
        """Normalize brightness to target mean."""
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l_channel = lab[:, :, 0].astype(np.float32)
        mean_l = np.mean(l_channel)
        target_mean = 127.0

        if abs(mean_l - target_mean) > 20:
            adjustment = target_mean - mean_l
            l_channel = np.clip(l_channel + adjustment * 0.5, 0, 255)
            lab[:, :, 0] = l_channel.astype(np.uint8)
            return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

        return image

    def _correct_contrast(self, image: np.ndarray) -> np.ndarray:
        """Apply CLAHE for contrast-limited adaptive histogram equalization."""
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        lab[:, :, 0] = clahe.apply(lab[:, :, 0])
        return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

    def _reduce_noise(self, image: np.ndarray) -> np.ndarray:
        """Apply bilateral filtering for edge-preserving noise reduction."""
        return cv2.bilateralFilter(image, d=5, sigmaColor=50, sigmaSpace=50)


_processor: FaceImageProcessor | None = None


def get_face_image_processor() -> FaceImageProcessor:
    global _processor
    if _processor is None:
        _processor = FaceImageProcessor()
    return _processor
