# ProofMesh Acceptance Criteria & Verification Matrix

**Document:** `docs/product/acceptance-criteria.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Quality Assurance Specification  

---

## 1. Overview & Verification Strategy

This document provides formal, unambiguous, and automated acceptance criteria for every requirement specified in [`docs/product/PRD.md`](./PRD.md). All criteria follow the **Given-When-Then** specification format and map directly to automated unit, integration, contract, or end-to-end tests.

---

## 2. Functional Requirements Acceptance Criteria

### 2.1 Claim Management (FR-CLAIM)

#### AC-CLAIM-001: Claim Submission & Concept Versioning (`FR-CLAIM-001`)
- **Given**: An authenticated client with valid JWT possessing scope `claim:create` for Tenant `T1` and Project `P1`.
- **When**: The client POSTs to `/v1/claims` with:
  ```json
  {
    "claimConceptKey": "customer-risk-score-analysis",
    "statement": "Applicant credit risk is low based on debt-to-income ratio.",
    "qualifiers": { "domain": "underwriting", "confidence": 0.94 },
    "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  }
  ```
- **Then**:
  1. HTTP response code is `201 Created`.
  2. Response payload contains `claimConceptId`, `claimVersionId`, `versionSequence: 1`, and `status: "submitted"`.
  3. `tenant_id` on the database record matches `T1` derived from the JWT, even if client passes a different tenant in payload.
  4. Database table `audit_events` contains an entry referencing the creation with SHA-256 hash of payload.
- **Negative / Edge Test**:
  - Re-submitting the exact same payload and idempotency key returns `200 OK` (or `201 Created`) with the **exact same** `claimVersionId`, and no new row is created in `claim_versions`.
  - Submitting without `statement` or with empty string returns `400 Bad Request` with structured Zod error details.

#### AC-CLAIM-002: Deterministic Claim State Machine Transition (`FR-CLAIM-002`)
- **Given**: A `ClaimVersion` in status `submitted`.
- **When**: The internal evaluation service posts a valid transition request to `/v1/claims/:id/transition` with `targetState: "evaluating"`.
- **Then**:
  1. The status updates atomically to `evaluating`.
  2. Emits `claim.transitioned.v1` domain event.
- **Negative / Edge Test**:
  - Attempting to transition directly from `submitted` to `attested` without passing through `evaluating` or without an authorized human attestation returns `409 Conflict` (`INVALID_STATE_TRANSITION`).
  - Attempting to transition a claim owned by Tenant `T2` using a token for Tenant `T1` returns `404 Not Found` (zero tenant leakage).

---

### 2.2 Evidence Processing (FR-EVID)

#### AC-EVID-001: Idempotent Evidence Ingestion & Cryptographic Digest (`FR-EVID-001`)
- **Given**: A raw PDF or JSON evidence payload.
- **When**: The client POSTs to `/v1/evidence` with header `Idempotency-Key: e1a1-2b3c`.
- **Then**:
  1. The server computes the SHA-256 digest of the raw bytes.
  2. The server stores the raw bytes in immutable storage and inserts metadata into `evidence_items`.
  3. Response contains `evidenceItemId` and `contentHash: "sha256:..."`.
  4. Attempting to execute an SQL `UPDATE` on `evidence_items.content_hash` fails due to database trigger/constraint.
- **Negative / Edge Test**:
  - Submitting an evidence payload larger than configured maximum (50MB) returns `413 Payload Too Large`.

#### AC-EVID-002: Claim-Evidence Evaluation Matrix (`FR-EVID-002`)
- **Given**: An existing `ClaimVersion` and an ingested `EvidenceItem`.
- **When**: The evaluator records an evaluation with `outcome: "refutes"` and `applicability: "direct"`.
- **Then**:
  1. A `claim_evidence_links` row is inserted linking claim and evidence.
  2. A new `assessment_versions` record is created.
  3. The `ClaimVersion` status transitions automatically to `disputed`.
  4. An automated `ReviewCase` is created for human investigation.
- **Negative / Edge Test**:
  - Submitting an invalid outcome value (e.g. `"partially_true"`) is rejected with `400 Bad Request` citing valid enum values (`supports`, `refutes`, `inconclusive`, `contradictory`).

---

### 2.3 Policy Enforcement (FR-POL)

#### AC-POL-001: Synchronous Policy Gatekeeping & Latency SLA (`FR-POL-001`)
- **Given**: An active OPA Rego policy bundle loaded in memory requiring tool calls with `risk_level: "high"` to obtain human approval.
- **When**: An agent attempts to invoke tool `drop_database_partition` with `risk_level: "high"`.
- **Then**:
  1. Policy evaluation returns `disposition: "deny"` or `disposition: "require_human_review"`.
  2. Total HTTP request duration from request to response is **< 25ms** at p95 across 200 iterations.
- **Negative / Edge Test (Fail-Open vs. Fail-Closed)**:
  - When the policy service experiences an intentional timeout:
    - If `failPolicy: "fail_closed"`, returns HTTP 403 Forbidden with `disposition: "deny"`.
    - If `failPolicy: "fail_open"`, returns HTTP 200 OK with `disposition: "admit"` and header `X-ProofMesh-Warning: policy_timeout_fail_open`.

---

### 2.4 Human Review & Attestation (FR-REV)

#### AC-REV-001: Review Case Resolution & Immutability (`FR-REV-001`, `FR-REV-002`)
- **Given**: An active `ReviewCase` in status `open` linked to a `disputed` claim.
- **When**: An authorized compliance officer submits an approval with verdict `approve_attestation` and statement.
- **Then**:
  1. `ReviewCase` status changes to `resolved`.
  2. An immutable `approvals` record is created with officer ID and timestamp.
  3. Underlying `ClaimVersion` status transitions to `attested`.
  4. Subsequent attempts to call `DELETE /v1/reviews/:id` or mutate the approval record return `405 Method Not Allowed`.

---

### 2.5 Lineage Graph & Auditing (FR-GRAPH)

#### AC-GRAPH-001: Recursive DAG Lineage Traversal (`FR-GRAPH-001`)
- **Given**: A graph containing a Source Artifact -> Evidence Item -> Assessment -> Claim Version -> Decision.
- **When**: Client requests `GET /v1/lineage/claims/:id?depth=5`.
- **Then**:
  1. Response contains the full upstream tree with all typed edges.
  2. Every edge explicitly indicates `captureMethod` (`captured`, `declared`, `attested`, `inferred`, `unknown`).
  3. Response execution time in PostgreSQL is **< 100ms**.

#### AC-GRAPH-002: Audit Bundle Cryptographic Verification (`FR-GRAPH-002`)
- **Given**: An exported audit bundle zip containing manifest.json, records.jsonl, and signature.sig.
- **When**: An independent verification script hashes the contents and checks against the public key.
- **Then**:
  1. The signature verification returns `VALID`.
  2. Altering a single character in `records.jsonl` causes the verification script to return `INVALID_DIGEST`.

---

## 3. Non-Functional & Security Acceptance Criteria

### AC-SEC-001: Database Row-Level Security Isolation (`NFR-SEC-001`)
- **Given**: Two tenants `Tenant_Alpha` and `Tenant_Beta` with claims populated in the shared database.
- **When**: A connection sets session config `SET LOCAL app.current_tenant_id = 'Tenant_Alpha'` and executes `SELECT * FROM claims;`.
- **Then**:
  1. The query returns **only** claims belonging to `Tenant_Alpha`.
  2. Zero rows for `Tenant_Beta` are returned.
  3. Executing an un-scoped raw update `UPDATE claims SET statement = 'Hacked';` updates **only** `Tenant_Alpha` rows.

### AC-SEC-002: Authoritative State Guarding (`NFR-SEC-002`)
- **Given**: An external agent attempting to forge claim state by sending a payload `{"status": "attested"}` to any ingestion endpoint.
- **Then**:
  1. The `status` field is stripped or rejected by the input schema validator.
  2. The claim remains in `submitted` or `evaluating` status.
  3. Only the internal domain state transition service can alter authoritative state.

---

## 4. Integration Acceptance Criteria

### AC-INT-001: OpenTelemetry GenAI Span Parsing (`INT-OTEL-001`)
- **Given**: An OpenTelemetry trace span with attributes:
  - `gen_ai.operation.name: "chat"`
  - `gen_ai.provider.name: "anthropic"`
  - `gen_ai.request.model: "claude-3-5-sonnet"`
  - `gen_ai.usage.input_tokens: 150`
- **When**: Ingested via `/v1/telemetry/events`.
- **Then**:
  1. The endpoint returns `202 Accepted` within **< 10ms**.
  2. The background worker parses the span and maps it to an `EvidenceItem` of type `runtime_trace`.
  3. Model attributes are mapped to standard qualifiers without loss.

### AC-INT-002: Model Context Protocol Tool Interception (`INT-MCP-001`)
- **Given**: An MCP client executing a tool call through the ProofMesh MCP Gateway.
- **When**: The tool invocation is evaluated against active policy:
  - If policy evaluates to `admit`: The request is proxied to the downstream tool server and returns output.
  - If policy evaluates to `deny`: The proxy intercepts the call, blocks execution, and returns a JSON-RPC error containing the policy denial reason.
