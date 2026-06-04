"""
Stage 8: Identity Verification — Multi-factor verification rules.

Verification Rules:
  Rule 1: Face Match + Liveness Pass → Verified
  Rule 2: Face Match + RFID Match → High Security Verification
  Rule 3: Face Match + RFID Match + Location Match → Maximum Security Verification
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum

from app.engine.config import engine_config
from app.engine.liveness_detector import LivenessResult
from app.engine.vector_search import SearchResult, MatchAction

logger = logging.getLogger(__name__)


class VerificationLevel(Enum):
    UNVERIFIED = "unverified"
    BASIC = "basic"
    VERIFIED = "verified"
    HIGH_SECURITY = "high_security"
    MAXIMUM_SECURITY = "maximum_security"


class VerificationMethod(Enum):
    FACE_ONLY = "face_only"
    FACE_LIVENESS = "face_liveness"
    FACE_RFID = "face_rfid"
    FACE_RFID_LOCATION = "face_rfid_location"


@dataclass
class VerificationContext:
    face_match: SearchResult | None = None
    liveness: LivenessResult | None = None
    rfid_match: bool = False
    rfid_employee_id: str | None = None
    location_match: bool = False
    location_id: int | None = None
    camera_direction: str | None = None


@dataclass
class VerificationResult:
    verified: bool
    level: VerificationLevel
    method: VerificationMethod
    employee_id: str | None
    confidence: float
    factors: dict
    reason: str | None = None

    def to_dict(self) -> dict:
        return {
            "verified": self.verified,
            "level": self.level.value,
            "method": self.method.value,
            "employee_id": self.employee_id,
            "confidence": round(self.confidence, 4),
            "factors": self.factors,
            "reason": self.reason,
        }


class IdentityVerifier:
    """Multi-factor identity verification engine."""

    def verify(self, context: VerificationContext) -> VerificationResult:
        """Apply verification rules based on available factors."""
        cfg = engine_config.verification

        face_matched = (
            context.face_match is not None
            and context.face_match.action == MatchAction.AUTO_ACCEPT
        )
        liveness_passed = (
            context.liveness is not None and context.liveness.passed
        )
        rfid_matched = context.rfid_match and context.rfid_employee_id is not None
        location_matched = context.location_match

        factors = {
            "face_match": face_matched,
            "liveness_pass": liveness_passed,
            "rfid_match": rfid_matched,
            "location_match": location_matched,
        }

        if face_matched and rfid_matched and location_matched:
            if self._rfid_face_consistent(context):
                return VerificationResult(
                    verified=True,
                    level=VerificationLevel.MAXIMUM_SECURITY,
                    method=VerificationMethod.FACE_RFID_LOCATION,
                    employee_id=context.face_match.employee_id,
                    confidence=context.face_match.confidence,
                    factors=factors,
                )

        if face_matched and rfid_matched:
            if self._rfid_face_consistent(context):
                return VerificationResult(
                    verified=True,
                    level=VerificationLevel.HIGH_SECURITY,
                    method=VerificationMethod.FACE_RFID,
                    employee_id=context.face_match.employee_id,
                    confidence=context.face_match.confidence,
                    factors=factors,
                )
            else:
                return VerificationResult(
                    verified=False,
                    level=VerificationLevel.UNVERIFIED,
                    method=VerificationMethod.FACE_RFID,
                    employee_id=None,
                    confidence=0.0,
                    factors=factors,
                    reason="face_rfid_mismatch",
                )

        if face_matched and liveness_passed:
            return VerificationResult(
                verified=True,
                level=VerificationLevel.VERIFIED,
                method=VerificationMethod.FACE_LIVENESS,
                employee_id=context.face_match.employee_id,
                confidence=context.face_match.confidence,
                factors=factors,
            )

        if face_matched and not cfg.require_liveness:
            return VerificationResult(
                verified=True,
                level=VerificationLevel.BASIC,
                method=VerificationMethod.FACE_ONLY,
                employee_id=context.face_match.employee_id,
                confidence=context.face_match.confidence,
                factors=factors,
            )

        if face_matched and not liveness_passed:
            return VerificationResult(
                verified=False,
                level=VerificationLevel.UNVERIFIED,
                method=VerificationMethod.FACE_LIVENESS,
                employee_id=context.face_match.employee_id,
                confidence=context.face_match.confidence,
                factors=factors,
                reason="liveness_failed",
            )

        reason = "no_face_match"
        if context.face_match and context.face_match.action == MatchAction.REVIEW:
            reason = "low_confidence_review"
        elif context.face_match and context.face_match.action == MatchAction.UNKNOWN:
            reason = "unknown_person"

        return VerificationResult(
            verified=False,
            level=VerificationLevel.UNVERIFIED,
            method=VerificationMethod.FACE_ONLY,
            employee_id=None,
            confidence=context.face_match.confidence if context.face_match else 0.0,
            factors=factors,
            reason=reason,
        )

    def _rfid_face_consistent(self, context: VerificationContext) -> bool:
        """Check that RFID and face identify the same person."""
        if not context.face_match or not context.rfid_employee_id:
            return False
        return context.face_match.employee_id == context.rfid_employee_id


_verifier: IdentityVerifier | None = None


def get_identity_verifier() -> IdentityVerifier:
    global _verifier
    if _verifier is None:
        _verifier = IdentityVerifier()
    return _verifier
