import pytest
from proofmesh.models import (
    ClaimStatus,
    SubmitClaimInput,
    ClaimVersionDTO,
    ContextPassageInput,
    ContextPacketCreateInput,
    DependencyRelationship,
    DependencyDeclareInput,
    DecisionOutcome,
    AdmissibilityStatus,
    DecisionRegisterInput,
    AdmissibilityCheckInput,
    HumanReviewPriority,
    HumanReviewRequestInput,
    LineageImpactReport
)


def test_submit_claim_input_validation():
    valid = SubmitClaimInput(
        claimConceptKey="test_key",
        statement="This is a test claim statement.",
        qualifiers={"confidence": 0.95}
    )
    assert valid.claimConceptKey == "test_key"
    assert valid.qualifiers["confidence"] == 0.95

    with pytest.raises(Exception):
        SubmitClaimInput(claimConceptKey="", statement="statement")


def test_claim_version_dto():
    dto = ClaimVersionDTO(
        id="12345678-1234-5678-1234-567812345678",
        conceptId="12345678-1234-5678-1234-567812345679",
        conceptKey="test_key",
        versionSequence=1,
        statement="Test statement",
        status=ClaimStatus.SUBMITTED,
        qualifiers={},
        validFrom=None,
        validTo=None,
        recordedAt="2026-11-05T12:00:00Z"
    )
    assert dto.status == ClaimStatus.SUBMITTED
    assert dto.versionSequence == 1


def test_context_packet_create_input():
    passage = ContextPassageInput(
        passageId="p1",
        contentHash="hash123",
        text="Sample passage text",
        score=0.88
    )
    packet = ContextPacketCreateInput(
        packetType="evidence_retrieval",
        passages=[passage],
        totalTokens=25
    )
    assert len(packet.passages) == 1
    assert packet.passages[0].passageId == "p1"


def test_dependency_declare_input():
    dep = DependencyDeclareInput(
        dependentEntityId="dep1",
        prerequisiteEntityId="prereq1",
        relationshipType=DependencyRelationship.SUPPORTS,
        declarationReason="Source provides grounding evidence"
    )
    assert dep.relationshipType == DependencyRelationship.SUPPORTS


def test_decision_register_input():
    dec = DecisionRegisterInput(
        decisionType="underwriting_approval",
        outcome=DecisionOutcome.ADMIT,
        rationale="All underwriting claims verified and admissible",
        contributingClaimIds=["c1", "c2"],
        admissibilityStatus=AdmissibilityStatus.ADMISSIBLE
    )
    assert dec.outcome == DecisionOutcome.ADMIT
    assert len(dec.contributingClaimIds) == 2


def test_human_review_request_input():
    rev = HumanReviewRequestInput(
        title="High Value Claim Escalation",
        summary="Claim exceeds automated risk threshold",
        requiredRole="lead_architect",
        priority=HumanReviewPriority.HIGH
    )
    assert rev.priority == HumanReviewPriority.HIGH
    assert rev.requiredRole == "lead_architect"


def test_lineage_impact_report():
    report = LineageImpactReport(
        rootEntityId="root1",
        rootEntityType="claim",
        directDependentsCount=2,
        totalDownstreamAffectedCount=5,
        affectedDecisions=[{"decisionId": "d1", "decisionType": "loan_approval", "outcome": "admit"}],
        affectedClaims=[],
        generatedAt="2026-11-05T12:00:00Z"
    )
    assert report.directDependentsCount == 2
    assert report.totalDownstreamAffectedCount == 5
