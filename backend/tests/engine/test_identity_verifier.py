"""Tests for identity verification rules."""

from app.engine.config import engine_config
from app.engine.identity_verifier import (
    IdentityVerifier,
    VerificationContext,
    VerificationLevel,
    VerificationMethod,
)
from app.engine.liveness_detector import LivenessResult
from app.engine.vector_search import MatchAction, SearchMatch, SearchResult


def _search_result(action: MatchAction, employee_id: str = "EMP001", confidence: float = 0.95):
    top = SearchMatch(employee_id=employee_id, confidence=confidence, rank=1)
    return SearchResult(
        top_match=top,
        matches=[top],
        action=action,
        search_ms=1,
        index_size=1,
    )


def _liveness(passed: bool, score: float = 0.90):
    return LivenessResult(
        passed=passed,
        score=score,
        is_live=passed,
        verification_ms=1,
    )


def test_rule1_face_and_liveness_verified():
    verifier = IdentityVerifier()
    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.AUTO_ACCEPT),
            liveness=_liveness(True),
        )
    )

    assert result.verified is True
    assert result.level == VerificationLevel.VERIFIED
    assert result.method == VerificationMethod.FACE_LIVENESS
    assert result.employee_id == "EMP001"


def test_rule2_face_and_rfid_high_security():
    verifier = IdentityVerifier()
    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.AUTO_ACCEPT),
            liveness=_liveness(False),
            rfid_match=True,
            rfid_employee_id="EMP001",
        )
    )

    assert result.verified is True
    assert result.level == VerificationLevel.HIGH_SECURITY
    assert result.method == VerificationMethod.FACE_RFID


def test_rule3_face_rfid_location_maximum_security():
    verifier = IdentityVerifier()
    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.AUTO_ACCEPT),
            liveness=_liveness(False),
            rfid_match=True,
            rfid_employee_id="EMP001",
            location_match=True,
            location_id=10,
        )
    )

    assert result.verified is True
    assert result.level == VerificationLevel.MAXIMUM_SECURITY
    assert result.method == VerificationMethod.FACE_RFID_LOCATION


def test_face_rfid_mismatch_rejected():
    verifier = IdentityVerifier()
    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.AUTO_ACCEPT, employee_id="EMP001"),
            rfid_match=True,
            rfid_employee_id="EMP002",
        )
    )

    assert result.verified is False
    assert result.reason == "face_rfid_mismatch"


def test_liveness_failed_when_required():
    verifier = IdentityVerifier()
    engine_config.verification.require_liveness = True

    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.AUTO_ACCEPT),
            liveness=_liveness(False),
        )
    )

    assert result.verified is False
    assert result.reason == "liveness_failed"


def test_face_only_when_liveness_not_required():
    verifier = IdentityVerifier()
    engine_config.verification.require_liveness = False

    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.AUTO_ACCEPT),
            liveness=_liveness(False),
        )
    )

    assert result.verified is True
    assert result.level == VerificationLevel.BASIC
    assert result.method == VerificationMethod.FACE_ONLY


def test_review_match_not_verified():
    verifier = IdentityVerifier()
    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.REVIEW, confidence=0.85),
            liveness=_liveness(True),
        )
    )

    assert result.verified is False
    assert result.reason == "low_confidence_review"


def test_unknown_person_not_verified():
    verifier = IdentityVerifier()
    result = verifier.verify(
        VerificationContext(
            face_match=_search_result(MatchAction.UNKNOWN, confidence=0.40),
            liveness=_liveness(True),
        )
    )

    assert result.verified is False
    assert result.reason == "unknown_person"
