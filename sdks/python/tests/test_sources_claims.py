import pytest
from proofmesh.models import (
    SourceType,
    SourceRetentionState,
    SourcePermissionContext,
    SourceArtifactDTO,
    SourceVersionDTO,
    SourcePassageDTO,
    SourceSnapshotDTO,
    PropositionType,
    ConfidenceCategory,
    MaterialProposition,
    ClaimExtractionResult,
    ClaimOccurrenceDTO,
    ClaimCorrectionDTO,
    DuplicateConceptCandidate,
)
from proofmesh.client import ProofMeshClient, AsyncProofMeshClient


def test_source_models_instantiation():
    artifact = SourceArtifactDTO(
        id="00000000-0000-4000-8000-000000000001",
        tenantId="00000000-0000-4000-8000-000000000002",
        projectId="00000000-0000-4000-8000-000000000003",
        originalUri="https://docs.proofmesh.io/arch.pdf",
        resolvedUri="https://docs.proofmesh.io/arch.pdf",
        sourceType=SourceType.PDF,
        title="Architecture Guide",
        mimeType="application/pdf",
        permissionContext=SourcePermissionContext.INTERNAL,
        retentionState=SourceRetentionState.ACTIVE,
        metadata={"version": "1.0"},
        createdAt="2026-11-05T00:00:00Z",
        updatedAt="2026-11-05T00:00:00Z",
    )
    assert artifact.sourceType == SourceType.PDF
    assert artifact.retentionState == SourceRetentionState.ACTIVE
    assert artifact.title == "Architecture Guide"


def test_claim_intelligence_models():
    prop = MaterialProposition(
        id="prop-1",
        propositionType=PropositionType.FACTUAL_CLAIM,
        rawStatement="ProofMesh was founded in 2024.",
        normalizedSubject="proofmesh",
        normalizedPredicate="was founded in",
        normalizedObject="2024",
        normalizedUnit="years",
        qualifiers={"temporal": "2024"},
        sourcePassageId=None,
        confidenceScore=0.95,
        confidenceCategory=ConfidenceCategory.HIGH,
    )
    assert prop.propositionType == PropositionType.FACTUAL_CLAIM
    assert prop.confidenceCategory == ConfidenceCategory.HIGH

    candidate = DuplicateConceptCandidate(
        conceptId="00000000-0000-4000-8000-000000000004",
        conceptKey="proofmesh_was_founded_in_2024",
        similarityScore=1.0,
        scopeDifferences=["region:US!=EU"],
        canMerge=False,
    )
    assert candidate.canMerge is False
    assert len(candidate.scopeDifferences) == 1


def test_client_sources_and_claims_methods():
    client = ProofMeshClient(
        base_url="http://mock.proofmesh.local",
        api_key="test_key"
    )

    # Verify method definitions exist on sync client
    assert hasattr(client, "register_source_artifact")
    assert hasattr(client, "get_source_artifact")
    assert hasattr(client, "update_source_retention")
    assert hasattr(client, "create_source_version")
    assert hasattr(client, "get_source_version")
    assert hasattr(client, "create_source_passage")
    assert hasattr(client, "get_source_passages")
    assert hasattr(client, "ingest_file")
    assert hasattr(client, "ingest_web")
    assert hasattr(client, "create_source_snapshot")
    assert hasattr(client, "extract_propositions")
    assert hasattr(client, "record_claim_occurrence")
    assert hasattr(client, "get_claim_occurrences")
    assert hasattr(client, "submit_claim_correction")
    assert hasattr(client, "get_claim_corrections")
    assert hasattr(client, "detect_duplicate_concepts")


def test_async_client_sources_and_claims_methods():
    client = AsyncProofMeshClient(
        base_url="http://mock.proofmesh.local",
        api_key="test_key"
    )

    # Verify method definitions exist on async client
    assert hasattr(client, "register_source_artifact")
    assert hasattr(client, "get_source_artifact")
    assert hasattr(client, "update_source_retention")
    assert hasattr(client, "create_source_version")
    assert hasattr(client, "get_source_version")
    assert hasattr(client, "create_source_passage")
    assert hasattr(client, "get_source_passages")
    assert hasattr(client, "ingest_file")
    assert hasattr(client, "ingest_web")
    assert hasattr(client, "create_source_snapshot")
    assert hasattr(client, "extract_propositions")
    assert hasattr(client, "record_claim_occurrence")
    assert hasattr(client, "get_claim_occurrences")
    assert hasattr(client, "submit_claim_correction")
    assert hasattr(client, "get_claim_corrections")
    assert hasattr(client, "detect_duplicate_concepts")
