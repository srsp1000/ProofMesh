import httpx
import pytest
from proofmesh.client import ProofMeshClient
from proofmesh.exceptions import ProofMeshApiError, ProofMeshError
from proofmesh.models import ClaimStatus, SubmitClaimInput


def test_client_init_validation():
    with pytest.raises(ProofMeshError):
        ProofMeshClient(api_key="", base_url="http://localhost:3000")

    with pytest.raises(ProofMeshError):
        ProofMeshClient(api_key="key", base_url="")


def test_client_successful_request():
    def mock_handler(request: httpx.Request):
        assert request.headers["Authorization"] == "Bearer test_key"
        assert request.headers["X-Tenant-ID"] == "tenant-123"
        return httpx.Response(
            201,
            json={
                "id": "12345678-1234-5678-1234-567812345678",
                "conceptId": "12345678-1234-5678-1234-567812345679",
                "conceptKey": "user_id_verified",
                "versionSequence": 1,
                "statement": "User identity document verified",
                "status": "submitted",
                "qualifiers": {"proofmesh_capture_method": "declared"},
                "validFrom": None,
                "validTo": None,
                "recordedAt": "2026-11-05T12:00:00Z"
            }
        )

    client = ProofMeshClient(
        api_key="test_key",
        base_url="http://mock.proofmesh.local",
        tenant_id="tenant-123"
    )
    client._http_client = httpx.Client(transport=httpx.MockTransport(mock_handler))

    claim = client.register_claim(
        SubmitClaimInput(
            claimConceptKey="user_id_verified",
            statement="User identity document verified"
        )
    )

    assert claim.conceptKey == "user_id_verified"
    assert claim.status == ClaimStatus.SUBMITTED
    assert claim.qualifiers["proofmesh_capture_method"] == "declared"


def test_client_4xx_does_not_retry():
    call_count = 0

    def mock_handler(request: httpx.Request):
        nonlocal call_count
        call_count += 1
        return httpx.Response(
            400,
            json={
                "code": "VALIDATION_FAILED",
                "detail": "Invalid statement length"
            }
        )

    client = ProofMeshClient(
        api_key="test_key",
        base_url="http://mock.proofmesh.local",
        max_retries=3
    )
    client._http_client = httpx.Client(transport=httpx.MockTransport(mock_handler))

    with pytest.raises(ProofMeshApiError) as exc_info:
        client.register_claim(
            SubmitClaimInput(
                claimConceptKey="test",
                statement="Invalid"
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "VALIDATION_FAILED"
    # Must NOT retry 4xx errors
    assert call_count == 1


def test_client_fail_open():
    def mock_handler(request: httpx.Request):
        return httpx.Response(500, json={"code": "INTERNAL_ERROR", "detail": "Server crashed"})

    client = ProofMeshClient(
        api_key="test_key",
        base_url="http://mock.proofmesh.local",
        max_retries=1,
        retry_delay_seconds=0.01,
        fail_open=True
    )
    client._http_client = httpx.Client(transport=httpx.MockTransport(mock_handler))

    # With fail_open=True, error does not raise
    result = client._request("POST", "/v1/claims", json_data={})
    assert result is None
