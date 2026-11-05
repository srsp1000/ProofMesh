import logging
import random
import time
import uuid
from typing import Any, Dict, List, Optional, Union

import httpx
from proofmesh.context import WorkflowContext, get_workflow_context, with_workflow
from proofmesh.exceptions import (
    ProofMeshApiError,
    ProofMeshError,
    ProofMeshTimeoutError,
)
from proofmesh.models import (
    AdmissibilityCheckInput,
    AdmissibilityCheckResult,
    ClaimStatus,
    ClaimVersionDTO,
    ContextPacketCreateInput,
    ContextPacketDTO,
    DecisionDTO,
    DecisionRegisterInput,
    DependencyDTO,
    DependencyDeclareInput,
    HumanReviewDTO,
    HumanReviewRequestInput,
    LineageImpactReport,
    SubmitClaimInput,
    TransitionClaimInput,
    SourceArtifactDTO,
    SourceVersionDTO,
    SourcePassageDTO,
    SourceSnapshotDTO,
    ClaimExtractionResult,
    ClaimOccurrenceDTO,
    ClaimCorrectionDTO,
    DuplicateConceptCandidate,
)
from proofmesh.telemetry import TelemetryBuffer

logger = logging.getLogger("proofmesh.client")


class ProofMeshClient:
    """Synchronous ProofMesh client for AI Governance and Evidence Lineage."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        tenant_id: Optional[str] = None,
        timeout_seconds: float = 5.0,
        max_retries: int = 3,
        retry_delay_seconds: float = 0.2,
        fail_open: bool = False,
    ) -> None:
        if not api_key:
            raise ProofMeshError("ProofMeshClient requires an api_key")
        if not base_url:
            raise ProofMeshError("ProofMeshClient requires a base_url")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.tenant_id = tenant_id
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_delay_seconds = retry_delay_seconds
        self.fail_open = fail_open

        self._http_client = httpx.Client(timeout=timeout_seconds)
        self.telemetry = TelemetryBuffer(
            api_key=api_key,
            base_url=base_url,
            tenant_id=tenant_id
        )

    def _request(
        self,
        method: str,
        path: str,
        json_data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        active_ctx = get_workflow_context()

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        if self.tenant_id:
            headers["X-Tenant-ID"] = self.tenant_id
        if active_ctx and active_ctx.correlation_id:
            headers["X-Correlation-ID"] = active_ctx.correlation_id

        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                response = self._http_client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    json=json_data,
                    params=params,
                )

                if response.status_code < 400:
                    return response.json() if response.content else {}

                status = response.status_code
                try:
                    err_payload = response.json()
                except Exception:
                    err_payload = {"title": response.text}

                code = err_payload.get("code", "API_ERROR")
                detail = err_payload.get("detail") or err_payload.get("title") or f"HTTP {status}"
                api_error = ProofMeshApiError(status, code, detail, err_payload)

                # Do not retry client 4xx errors
                if 400 <= status < 500:
                    raise api_error

                last_error = api_error
            except httpx.TimeoutException:
                last_error = ProofMeshTimeoutError(self.timeout_seconds, f"{method} {path}")
            except httpx.RequestError as req_err:
                last_error = ProofMeshError(f"Network error communicating with ProofMesh: {req_err}")
            except ProofMeshApiError as api_err:
                if 400 <= api_err.status_code < 500:
                    raise
                last_error = api_err

            if attempt == self.max_retries:
                break

            jitter = random.uniform(0, 0.05)
            backoff = min(self.retry_delay_seconds * (2 ** attempt) + jitter, 5.0)
            logger.warning(f"Request {method} {path} failed (attempt {attempt+1}/{self.max_retries+1}). Retrying in {backoff:.2f}s...")
            time.sleep(backoff)

        if self.fail_open:
            logger.warning(f"ProofMesh request {method} {path} failed, fail_open enabled: {last_error}")
            return None

        raise last_error or ProofMeshError(f"Request {method} {path} failed")

    # Workflow Context helper
    def with_workflow(
        self,
        workflow_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> with_workflow:
        return with_workflow(
            workflow_id=workflow_id,
            correlation_id=correlation_id,
            metadata=metadata
        )

    # 1. Claims
    def register_claim(
        self,
        claim: Union[SubmitClaimInput, Dict[str, Any]],
        capture_method: str = "declared"
    ) -> ClaimVersionDTO:
        data = claim.model_dump() if isinstance(claim, SubmitClaimInput) else dict(claim)
        active_ctx = get_workflow_context()
        qualifiers = data.get("qualifiers", {})
        qualifiers["proofmesh_capture_method"] = capture_method
        if active_ctx:
            qualifiers["proofmesh_workflow_id"] = active_ctx.workflow_id
            qualifiers["proofmesh_correlation_id"] = active_ctx.correlation_id
        data["qualifiers"] = qualifiers

        res = self._request("POST", "/v1/claims", json_data=data)
        return ClaimVersionDTO(**res)

    def get_claim(self, claim_id: str) -> ClaimVersionDTO:
        res = self._request("GET", f"/v1/claims/{claim_id}")
        return ClaimVersionDTO(**res)

    def transition_claim(
        self,
        claim_id: str,
        target_state: ClaimStatus,
        reason: str,
        assessment_ids: Optional[List[str]] = None
    ) -> ClaimVersionDTO:
        payload = TransitionClaimInput(
            targetState=target_state,
            transitionReason=reason,
            evidenceAssessmentIds=assessment_ids or []
        )
        res = self._request("POST", f"/v1/claims/{claim_id}/transition", json_data=payload.model_dump())
        return ClaimVersionDTO(**res)

    # 2. Context Packets
    def create_context_packet(
        self,
        packet: Union[ContextPacketCreateInput, Dict[str, Any]]
    ) -> ContextPacketDTO:
        data = packet.model_dump() if isinstance(packet, ContextPacketCreateInput) else dict(packet)
        res = self._request("POST", "/v1/context-packets", json_data=data)
        return ContextPacketDTO(**res)

    def get_context_packet(self, packet_id: str) -> ContextPacketDTO:
        res = self._request("GET", f"/v1/context-packets/{packet_id}")
        return ContextPacketDTO(**res)

    # 3. Dependencies
    def declare_dependency(
        self,
        dep: Union[DependencyDeclareInput, Dict[str, Any]]
    ) -> DependencyDTO:
        data = dep.model_dump() if isinstance(dep, DependencyDeclareInput) else dict(dep)
        res = self._request("POST", "/v1/dependencies", json_data=data)
        return DependencyDTO(**res)

    # 4. Decisions
    def register_decision(
        self,
        decision: Union[DecisionRegisterInput, Dict[str, Any]]
    ) -> DecisionDTO:
        data = decision.model_dump() if isinstance(decision, DecisionRegisterInput) else dict(decision)
        res = self._request("POST", "/v1/decisions", json_data=data)
        return DecisionDTO(**res)

    def get_decision(self, decision_id: str) -> DecisionDTO:
        res = self._request("GET", f"/v1/decisions/{decision_id}")
        return DecisionDTO(**res)

    # 5. Admissibility
    def check_admissibility(
        self,
        check: Union[AdmissibilityCheckInput, Dict[str, Any]]
    ) -> AdmissibilityCheckResult:
        data = check.model_dump() if isinstance(check, AdmissibilityCheckInput) else dict(check)
        res = self._request("POST", "/v1/admissibility/check", json_data=data)
        return AdmissibilityCheckResult(**res)

    # 6. Reviews
    def request_review(
        self,
        review: Union[HumanReviewRequestInput, Dict[str, Any]]
    ) -> HumanReviewDTO:
        data = review.model_dump() if isinstance(review, HumanReviewRequestInput) else dict(review)
        res = self._request("POST", "/v1/reviews", json_data=data)
        return HumanReviewDTO(**res)

    def get_review(self, review_id: str) -> HumanReviewDTO:
        res = self._request("GET", f"/v1/reviews/{review_id}")
        return HumanReviewDTO(**res)

    # 7. Lineage Impact
    def get_lineage_impact(
        self,
        entity_id: str,
        entity_type: str = "claim"
    ) -> LineageImpactReport:
        res = self._request("GET", "/v1/lineage/impact", params={"entityId": entity_id, "entityType": entity_type})
        return LineageImpactReport(**res)

    # 8. Sources
    def register_source_artifact(self, artifact_data: Dict[str, Any]) -> SourceArtifactDTO:
        res = self._request("POST", "/v1/sources/artifacts", json_data=artifact_data)
        return SourceArtifactDTO(**res)

    def get_source_artifact(self, artifact_id: str) -> SourceArtifactDTO:
        res = self._request("GET", f"/v1/sources/artifacts/{artifact_id}")
        return SourceArtifactDTO(**res)

    def update_source_retention(self, artifact_id: str, retention_state: str, reason: str) -> SourceArtifactDTO:
        res = self._request("PATCH", f"/v1/sources/artifacts/{artifact_id}/retention", json_data={"retentionState": retention_state, "reason": reason})
        return SourceArtifactDTO(**res)

    def create_source_version(self, version_data: Dict[str, Any]) -> SourceVersionDTO:
        res = self._request("POST", "/v1/sources/versions", json_data=version_data)
        return SourceVersionDTO(**res)

    def get_source_version(self, version_id: str) -> SourceVersionDTO:
        res = self._request("GET", f"/v1/sources/versions/{version_id}")
        return SourceVersionDTO(**res)

    def create_source_passage(self, version_id: str, passage_data: Dict[str, Any]) -> SourcePassageDTO:
        res = self._request("POST", f"/v1/sources/versions/{version_id}/passages", json_data=passage_data)
        return SourcePassageDTO(**res)

    def get_source_passages(self, version_id: str) -> List[SourcePassageDTO]:
        res = self._request("GET", f"/v1/sources/versions/{version_id}/passages")
        return [SourcePassageDTO(**p) for p in res.get("passages", [])]

    def ingest_file(self, filename: str, content_base64: str, permission_context: str = "internal", original_uri: Optional[str] = None) -> Dict[str, Any]:
        payload = {
            "filename": filename,
            "contentBase64": content_base64,
            "permissionContext": permission_context,
            "originalUri": original_uri or f"file://{filename}"
        }
        return self._request("POST", "/v1/sources/ingest/file", json_data=payload)

    def ingest_web(self, url: str, permission_context: str = "public", timeout_ms: int = 10000) -> Dict[str, Any]:
        payload = {
            "url": url,
            "permissionContext": permission_context,
            "timeoutMs": timeout_ms
        }
        return self._request("POST", "/v1/sources/ingest/web", json_data=payload)

    def create_source_snapshot(self, version_ids: List[str]) -> SourceSnapshotDTO:
        res = self._request("POST", "/v1/sources/snapshots", json_data={"sourceVersionIds": version_ids})
        return SourceSnapshotDTO(**res)

    # 9. Claim Intelligence
    def extract_propositions(self, extraction_input: Dict[str, Any]) -> ClaimExtractionResult:
        res = self._request("POST", "/v1/claims/extract", json_data=extraction_input)
        return ClaimExtractionResult(**res)

    def record_claim_occurrence(self, occurrence_data: Dict[str, Any]) -> ClaimOccurrenceDTO:
        res = self._request("POST", "/v1/claims/occurrences", json_data=occurrence_data)
        return ClaimOccurrenceDTO(**res)

    def get_claim_occurrences(self, claim_version_id: str) -> List[ClaimOccurrenceDTO]:
        res = self._request("GET", f"/v1/claims/{claim_version_id}/occurrences")
        return [ClaimOccurrenceDTO(**occ) for occ in res.get("occurrences", [])]

    def submit_claim_correction(self, claim_version_id: str, field_name: str, original_value: str, corrected_value: str, reason: str) -> ClaimCorrectionDTO:
        payload = {
            "fieldName": field_name,
            "originalValue": original_value,
            "correctedValue": corrected_value,
            "correctionReason": reason
        }
        res = self._request("POST", f"/v1/claims/{claim_version_id}/corrections", json_data=payload)
        return ClaimCorrectionDTO(**res)

    def get_claim_corrections(self, claim_version_id: str) -> List[ClaimCorrectionDTO]:
        res = self._request("GET", f"/v1/claims/{claim_version_id}/corrections")
        return [ClaimCorrectionDTO(**c) for c in res.get("corrections", [])]

    def detect_duplicate_concepts(self, proposition: Dict[str, Any], existing_concepts: List[Dict[str, Any]]) -> List[DuplicateConceptCandidate]:
        payload = {"proposition": proposition, "existingConcepts": existing_concepts}
        res = self._request("POST", "/v1/claims/concepts/detect-duplicates", json_data=payload)
        return [DuplicateConceptCandidate(**c) for c in res.get("candidates", [])]

    def flush(self) -> None:
        self.telemetry.flush()

    def close(self) -> None:
        self.telemetry.close()
        self._http_client.close()

    def __enter__(self) -> "ProofMeshClient":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()


class AsyncProofMeshClient:
    """Asynchronous ProofMesh client for AI Governance and Evidence Lineage."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        tenant_id: Optional[str] = None,
        timeout_seconds: float = 5.0,
        max_retries: int = 3,
        retry_delay_seconds: float = 0.2,
        fail_open: bool = False,
    ) -> None:
        if not api_key:
            raise ProofMeshError("AsyncProofMeshClient requires an api_key")
        if not base_url:
            raise ProofMeshError("AsyncProofMeshClient requires a base_url")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.tenant_id = tenant_id
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_delay_seconds = retry_delay_seconds
        self.fail_open = fail_open

        self._http_client = httpx.AsyncClient(timeout=timeout_seconds)
        self.telemetry = TelemetryBuffer(
            api_key=api_key,
            base_url=base_url,
            tenant_id=tenant_id
        )

    async def _request(
        self,
        method: str,
        path: str,
        json_data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        active_ctx = get_workflow_context()

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        if self.tenant_id:
            headers["X-Tenant-ID"] = self.tenant_id
        if active_ctx and active_ctx.correlation_id:
            headers["X-Correlation-ID"] = active_ctx.correlation_id

        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                response = await self._http_client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    json=json_data,
                    params=params,
                )

                if response.status_code < 400:
                    return response.json() if response.content else {}

                status = response.status_code
                try:
                    err_payload = response.json()
                except Exception:
                    err_payload = {"title": response.text}

                code = err_payload.get("code", "API_ERROR")
                detail = err_payload.get("detail") or err_payload.get("title") or f"HTTP {status}"
                api_error = ProofMeshApiError(status, code, detail, err_payload)

                if 400 <= status < 500:
                    raise api_error

                last_error = api_error
            except httpx.TimeoutException:
                last_error = ProofMeshTimeoutError(self.timeout_seconds, f"{method} {path}")
            except httpx.RequestError as req_err:
                last_error = ProofMeshError(f"Network error communicating with ProofMesh: {req_err}")
            except ProofMeshApiError as api_err:
                if 400 <= api_err.status_code < 500:
                    raise
                last_error = api_err

            if attempt == self.max_retries:
                break

            jitter = random.uniform(0, 0.05)
            backoff = min(self.retry_delay_seconds * (2 ** attempt) + jitter, 5.0)
            logger.warning(f"Async request {method} {path} failed (attempt {attempt+1}/{self.max_retries+1}). Retrying in {backoff:.2f}s...")
            import asyncio
            await asyncio.sleep(backoff)

        if self.fail_open:
            logger.warning(f"ProofMesh async request {method} {path} failed, fail_open enabled: {last_error}")
            return None

        raise last_error or ProofMeshError(f"Request {method} {path} failed")

    def with_workflow(
        self,
        workflow_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> with_workflow:
        return with_workflow(
            workflow_id=workflow_id,
            correlation_id=correlation_id,
            metadata=metadata
        )

    async def register_claim(
        self,
        claim: Union[SubmitClaimInput, Dict[str, Any]],
        capture_method: str = "declared"
    ) -> ClaimVersionDTO:
        data = claim.model_dump() if isinstance(claim, SubmitClaimInput) else dict(claim)
        active_ctx = get_workflow_context()
        qualifiers = data.get("qualifiers", {})
        qualifiers["proofmesh_capture_method"] = capture_method
        if active_ctx:
            qualifiers["proofmesh_workflow_id"] = active_ctx.workflow_id
            qualifiers["proofmesh_correlation_id"] = active_ctx.correlation_id
        data["qualifiers"] = qualifiers

        res = await self._request("POST", "/v1/claims", json_data=data)
        return ClaimVersionDTO(**res)

    async def get_claim(self, claim_id: str) -> ClaimVersionDTO:
        res = await self._request("GET", f"/v1/claims/{claim_id}")
        return ClaimVersionDTO(**res)

    async def transition_claim(
        self,
        claim_id: str,
        target_state: ClaimStatus,
        reason: str,
        assessment_ids: Optional[List[str]] = None
    ) -> ClaimVersionDTO:
        payload = TransitionClaimInput(
            targetState=target_state,
            transitionReason=reason,
            evidenceAssessmentIds=assessment_ids or []
        )
        res = await self._request("POST", f"/v1/claims/{claim_id}/transition", json_data=payload.model_dump())
        return ClaimVersionDTO(**res)

    async def create_context_packet(
        self,
        packet: Union[ContextPacketCreateInput, Dict[str, Any]]
    ) -> ContextPacketDTO:
        data = packet.model_dump() if isinstance(packet, ContextPacketCreateInput) else dict(packet)
        res = await self._request("POST", "/v1/context-packets", json_data=data)
        return ContextPacketDTO(**res)

    async def get_context_packet(self, packet_id: str) -> ContextPacketDTO:
        res = await self._request("GET", f"/v1/context-packets/{packet_id}")
        return ContextPacketDTO(**res)

    async def declare_dependency(
        self,
        dep: Union[DependencyDeclareInput, Dict[str, Any]]
    ) -> DependencyDTO:
        data = dep.model_dump() if isinstance(dep, DependencyDeclareInput) else dict(dep)
        res = await self._request("POST", "/v1/dependencies", json_data=data)
        return DependencyDTO(**res)

    async def register_decision(
        self,
        decision: Union[DecisionRegisterInput, Dict[str, Any]]
    ) -> DecisionDTO:
        data = decision.model_dump() if isinstance(decision, DecisionRegisterInput) else dict(decision)
        res = await self._request("POST", "/v1/decisions", json_data=data)
        return DecisionDTO(**res)

    async def get_decision(self, decision_id: str) -> DecisionDTO:
        res = await self._request("GET", f"/v1/decisions/{decision_id}")
        return DecisionDTO(**res)

    async def check_admissibility(
        self,
        check: Union[AdmissibilityCheckInput, Dict[str, Any]]
    ) -> AdmissibilityCheckResult:
        data = check.model_dump() if isinstance(check, AdmissibilityCheckInput) else dict(check)
        res = await self._request("POST", "/v1/admissibility/check", json_data=data)
        return AdmissibilityCheckResult(**res)

    async def request_review(
        self,
        review: Union[HumanReviewRequestInput, Dict[str, Any]]
    ) -> HumanReviewDTO:
        data = review.model_dump() if isinstance(review, HumanReviewRequestInput) else dict(review)
        res = await self._request("POST", "/v1/reviews", json_data=data)
        return HumanReviewDTO(**res)

    async def get_review(self, review_id: str) -> HumanReviewDTO:
        res = await self._request("GET", f"/v1/reviews/{review_id}")
        return HumanReviewDTO(**res)

    async def get_lineage_impact(
        self,
        entity_id: str,
        entity_type: str = "claim"
    ) -> LineageImpactReport:
        res = await self._request("GET", "/v1/lineage/impact", params={"entityId": entity_id, "entityType": entity_type})
        return LineageImpactReport(**res)

    # 8. Sources
    async def register_source_artifact(self, artifact_data: Dict[str, Any]) -> SourceArtifactDTO:
        res = await self._request("POST", "/v1/sources/artifacts", json_data=artifact_data)
        return SourceArtifactDTO(**res)

    async def get_source_artifact(self, artifact_id: str) -> SourceArtifactDTO:
        res = await self._request("GET", f"/v1/sources/artifacts/{artifact_id}")
        return SourceArtifactDTO(**res)

    async def update_source_retention(self, artifact_id: str, retention_state: str, reason: str) -> SourceArtifactDTO:
        res = await self._request("PATCH", f"/v1/sources/artifacts/{artifact_id}/retention", json_data={"retentionState": retention_state, "reason": reason})
        return SourceArtifactDTO(**res)

    async def create_source_version(self, version_data: Dict[str, Any]) -> SourceVersionDTO:
        res = await self._request("POST", "/v1/sources/versions", json_data=version_data)
        return SourceVersionDTO(**res)

    async def get_source_version(self, version_id: str) -> SourceVersionDTO:
        res = await self._request("GET", f"/v1/sources/versions/{version_id}")
        return SourceVersionDTO(**res)

    async def create_source_passage(self, version_id: str, passage_data: Dict[str, Any]) -> SourcePassageDTO:
        res = await self._request("POST", f"/v1/sources/versions/{version_id}/passages", json_data=passage_data)
        return SourcePassageDTO(**res)

    async def get_source_passages(self, version_id: str) -> List[SourcePassageDTO]:
        res = await self._request("GET", f"/v1/sources/versions/{version_id}/passages")
        return [SourcePassageDTO(**p) for p in res.get("passages", [])]

    async def ingest_file(self, filename: str, content_base64: str, permission_context: str = "internal", original_uri: Optional[str] = None) -> Dict[str, Any]:
        payload = {
            "filename": filename,
            "contentBase64": content_base64,
            "permissionContext": permission_context,
            "originalUri": original_uri or f"file://{filename}"
        }
        return await self._request("POST", "/v1/sources/ingest/file", json_data=payload)

    async def ingest_web(self, url: str, permission_context: str = "public", timeout_ms: int = 10000) -> Dict[str, Any]:
        payload = {
            "url": url,
            "permissionContext": permission_context,
            "timeoutMs": timeout_ms
        }
        return await self._request("POST", "/v1/sources/ingest/web", json_data=payload)

    async def create_source_snapshot(self, version_ids: List[str]) -> SourceSnapshotDTO:
        res = await self._request("POST", "/v1/sources/snapshots", json_data={"sourceVersionIds": version_ids})
        return SourceSnapshotDTO(**res)

    # 9. Claim Intelligence
    async def extract_propositions(self, extraction_input: Dict[str, Any]) -> ClaimExtractionResult:
        res = await self._request("POST", "/v1/claims/extract", json_data=extraction_input)
        return ClaimExtractionResult(**res)

    async def record_claim_occurrence(self, occurrence_data: Dict[str, Any]) -> ClaimOccurrenceDTO:
        res = await self._request("POST", "/v1/claims/occurrences", json_data=occurrence_data)
        return ClaimOccurrenceDTO(**res)

    async def get_claim_occurrences(self, claim_version_id: str) -> List[ClaimOccurrenceDTO]:
        res = await self._request("GET", f"/v1/claims/{claim_version_id}/occurrences")
        return [ClaimOccurrenceDTO(**occ) for occ in res.get("occurrences", [])]

    async def submit_claim_correction(self, claim_version_id: str, field_name: str, original_value: str, corrected_value: str, reason: str) -> ClaimCorrectionDTO:
        payload = {
            "fieldName": field_name,
            "originalValue": original_value,
            "correctedValue": corrected_value,
            "correctionReason": reason
        }
        res = await self._request("POST", f"/v1/claims/{claim_version_id}/corrections", json_data=payload)
        return ClaimCorrectionDTO(**res)

    async def get_claim_corrections(self, claim_version_id: str) -> List[ClaimCorrectionDTO]:
        res = await self._request("GET", f"/v1/claims/{claim_version_id}/corrections")
        return [ClaimCorrectionDTO(**c) for c in res.get("corrections", [])]

    async def detect_duplicate_concepts(self, proposition: Dict[str, Any], existing_concepts: List[Dict[str, Any]]) -> List[DuplicateConceptCandidate]:
        payload = {"proposition": proposition, "existingConcepts": existing_concepts}
        res = await self._request("POST", "/v1/claims/concepts/detect-duplicates", json_data=payload)
        return [DuplicateConceptCandidate(**c) for c in res.get("candidates", [])]

    def flush(self) -> None:
        self.telemetry.flush()

    async def aclose(self) -> None:
        self.telemetry.close()
        await self._http_client.aclose()

    async def __aenter__(self) -> "AsyncProofMeshClient":
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self.aclose()
