# ProofMesh Product Requirements Document (PRD)

**Document:** `docs/product/PRD.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Architecture Specification  

---

## 1. Executive Summary & Product Vision

**ProofMesh** is an integration-first evidence-to-decision governance platform for AI-powered applications. As autonomous agents, generative models, and multi-agent workflows execute increasingly critical operations, enterprise systems require mathematical, cryptographic, and policy-driven certainty over the evidence supporting AI claims and decisions.

ProofMesh bridges the gap between raw AI execution traces and authoritative governance. It continuously captures evidence, verifies claims against enterprise policies, tracks dependency lineage in an immutable directed acyclic graph (DAG), orchestrates human review when thresholds are breached, and enforces synchronous or asynchronous policy admission.

---

## 2. Non-Negotiable Product Principles & Non-Goals

### 2.1 Core Invariants
1. **Separation of Authoritative State from LLM Reasoning**: LLMs and autonomous agents may generate claims, draft summaries, and suggest decisions, but they can **never** directly mutate authoritative claim statuses, policy rules, tenant identities, or audit logs. All transitions are governed by deterministic domain services.
2. **Distinct Semantic Axes**:
   - **Claim Lifecycle**: `draft` -> `submitted` -> `evaluating` -> `attested` | `disputed` | `rejected` -> `archived`.
   - **Evidence Outcome**: `supports`, `refutes`, `inconclusive`, `contradictory`.
   - **Evidence Applicability**: `direct`, `analogous`, `contextual`, `inapplicable`.
   - **Policy Disposition**: `admit`, `deny`, `require_human_review`, `warn`, `remediate`.
   - **Dependency Capture Method**: `captured`, `declared`, `attested`, `inferred`, `unknown`.
3. **Historical Immutability**: Historical evidence, claims, evaluations, and decisions are append-only. Versions are immutable; updates create new version nodes while retaining prior cryptographic digests.
4. **Asynchronous Observation by Default**: Observation and telemetry must be non-blocking with fail-open behavior. Synchronous policy gating is strictly opt-in with explicit fail-open/fail-closed semantics.

### 2.2 Explicit Non-Goals
1. **Universal Truth Guarantees**: ProofMesh does **not** assert metaphysical or real-world "truth." It asserts and evaluates whether an explicit claim is corroborated, contradicted, or untestable relative to a specified, cryptographically snapshot evidence corpus and policy bundle.
2. **Hidden Model-Causality Claims**: ProofMesh does **not** treat model activation traces or co-occurring telemetry as proof of decision causality. Relationships derived through heuristics are explicitly tagged as `inferred` or `unknown`, never as `captured` or `attested`.
3. **Automatic Complete-Lineage Claims**: ProofMesh does **not** assume complete graph visibility across opaque third-party models or external network partitions. When dependencies cannot be observed directly, coverage records explicitly tag them as `partial` or `unknown`.

---

## 3. Product Scope Tiers

To balance immediate vertical-slice execution with long-term enterprise scalability, all requirements are categorized into three delivery tiers:
- **Tier 1 (Initial Core - v1.0.0 / Phases 1–3)**: Minimal viable vertical slice including core domain state machines, PostgreSQL RLS persistence, OpenTelemetry ingestion, MCP connector, local OPA evaluation, and basic CLI/REST interfaces.
- **Tier 2 (Enterprise Governance - v1.1.0 / Phases 4–5)**: Durable Temporal human-in-the-loop workflow orchestration, React governance portal, visual lineage DAG, signed audit bundle export, and NATS JetStream event streaming.
- **Tier 3 (Advanced Enterprise - Post-v1)**: Multi-region active-active replication, hardware security module (HSM) attestation signing, automated ML red-teaming connectors, and distributed graph query sharding.

---

## 4. Module Requirements Catalog

Each requirement specifies: **User / Principal**, **Trigger**, **Input Payload**, **Expected Result**, **Failure Behavior**, **Permissions**, **Audit Requirements**, and **Acceptance Criteria**.

---

### 4.1 Claim Management Module (FR-CLAIM)

#### `FR-CLAIM-001`: Authoritative Claim Submission & Concept Versioning
- **User / Principal**: Authenticated Client Service, SDK, or Integration Connector.
- **Trigger**: Client submits an AI-generated statement, tool assertion, or compliance claim.
- **Input**:
  - `tenantId` (UUID, server-derived).
  - `projectId` (UUID).
  - `claimConceptKey` (string, stable slug across versions).
  - `statement` (string, markdown/text of the assertion).
  - `qualifiers` (key-value metadata: domain, jurisdiction, confidence score, valid time range).
  - `contextPacketId` (optional UUID of initiating agent context).
  - `idempotencyKey` (string, UUIDv4).
- **Expected Result**: System creates or links to `ClaimConcept`, appends a new `ClaimVersion` (status: `submitted`), creates initial `ClaimOccurrence` record, and emits `claim.submitted.v1` event.
- **Failure Behavior**: Invalid schema returns `400 Bad Request`. Duplicate idempotency key returns cached original claim response without creating duplicate versions.
- **Permissions**: `claim:create` on target project.
- **Audit Requirements**: Append record to `audit_events` with principal ID, timestamp, and payload SHA-256 digest.
- **Acceptance Criteria**:
  1. Claim version sequence increments monotonically per concept.
  2. Submitting with identical idempotency key yields identical claim ID and HTTP 200/201.
  3. `tenantId` in body is ignored; server authentication token strictly governs tenant scope.
- **Scope Tier**: Tier 1 (Initial Core).

#### `FR-CLAIM-002`: Deterministic Claim State Machine Transition
- **User / Principal**: Governance Engine, Evaluation Service, or Authorized Human Reviewer.
- **Trigger**: Evidence evaluation completes, policy threshold is breached, or human review concludes.
- **Input**:
  - `claimVersionId` (UUID).
  - `targetState` (`evaluating` | `attested` | `disputed` | `rejected` | `archived`).
  - `transitionReason` (string).
  - `evidenceAssessmentIds` (array of UUIDs).
- **Expected Result**: Domain service checks state transition guards, updates claim status atomically under row lock, increments revision, and emits `claim.transitioned.v1`.
- **Failure Behavior**: Invalid transition (e.g., `rejected` -> `attested` without new version) is rejected with `409 Conflict`.
- **Permissions**: `claim:transition` or `review:attest`.
- **Audit Requirements**: Audit entry records prior state, new state, transition actor, and linked evidence IDs.
- **Acceptance Criteria**:
  1. Terminal states cannot be reverted within the same `ClaimVersion`.
  2. Transition requires valid lock; concurrent transitions fail safely without lost updates.
- **Scope Tier**: Tier 1 (Initial Core).

---

### 4.2 Evidence Processing & Ingestion Module (FR-EVID)

#### `FR-EVID-001`: Idempotent Evidence Ingestion & Cryptographic Snapshotting
- **User / Principal**: AI Application, Telemetry Collector, Document Pipeline.
- **Trigger**: AI application records tool output, document retrieval, or execution log.
- **Input**:
  - `sourceArtifactId` (UUID).
  - `evidenceType` (`runtime_trace` | `document_passage` | `tool_result` | `human_statement`).
  - `payload` (JSON or binary stream).
  - `capturedAt` (ISO 8601 timestamp).
  - `idempotencyKey` (string).
- **Expected Result**: Ingestion validates schema, computes SHA-256 content digest, stores raw snapshot in immutable object store/table, creates `EvidenceItem` record, and returns `evidenceId`.
- **Failure Behavior**: Payload exceeds size limit (50MB) returns `413 Payload Too Large`. Corrupted stream returns `422 Unprocessable Entity`.
- **Permissions**: `evidence:ingest`.
- **Audit Requirements**: Evidence item record includes SHA-256 hash, byte size, ingestion source, and storage URI.
- **Acceptance Criteria**:
  1. Ingestion produces identical content hash for identical binary input.
  2. Raw evidence payload cannot be modified or deleted post-creation.
- **Scope Tier**: Tier 1 (Initial Core).

#### `FR-EVID-002`: Claim-Evidence Evaluation Matrix
- **User / Principal**: Evaluation Application Service.
- **Trigger**: New evidence linked to submitted claim.
- **Input**:
  - `claimVersionId` (UUID).
  - `evidenceItemId` (UUID).
  - `outcome` (`supports` | `refutes` | `inconclusive` | `contradictory`).
  - `applicability` (`direct` | `analogous` | `contextual` | `inapplicable`).
  - `rationale` (structured evaluation text).
- **Expected Result**: Persists `ClaimEvidenceLink` and creates `AssessmentVersion`. If outcome is `refutes`, flags claim for dispute/review.
- **Failure Behavior**: Linking evidence from different tenant causes `404 Not Found` (tenant isolation).
- **Permissions**: `evidence:evaluate`.
- **Audit Requirements**: Records evaluator identity, evaluation timestamp, and outcome classifications.
- **Acceptance Criteria**:
  1. Outcome and Applicability values are strictly validated against enum domains.
  2. An assessment linked to an older evidence version is flagged as `stale` if a new version of the source evidence is ingested.
- **Scope Tier**: Tier 1 (Initial Core).

---

### 4.3 Policy Enforcement & Gatekeeping Module (FR-POL)

#### `FR-POL-001`: Synchronous Policy Evaluation & Gatekeeping
- **User / Principal**: API Gateway, MCP Interceptor, Client Application.
- **Trigger**: Client requests pre-execution admission (e.g. before executing sensitive tool).
- **Input**:
  - `action` (string, e.g. `tool:execute:database_query`).
  - `claimVersionId` (UUID, optional).
  - `principal` (principal context object).
  - `parameters` (JSON object).
  - `enforcementMode` (`synchronous`).
  - `failPolicy` (`fail_open` | `fail_closed`).
- **Expected Result**: Evaluates OPA Rego policy bundle in-process; returns Policy Disposition (`admit`, `deny`, `require_human_review`, `warn`, `remediate`) with evaluation latency < 25ms.
- **Failure Behavior**: If OPA evaluation times out (>50ms) or errors:
  - If `fail_open`: Returns `admit` with `warning: policy_timeout_fail_open` and logs alert.
  - If `fail_closed`: Returns `deny` with `error: policy_timeout_fail_closed`.
- **Permissions**: `policy:evaluate`.
- **Audit Requirements**: Full policy evaluation record persisted asynchronously to `policy_evaluations` table with input snapshot, rule IDs triggered, and execution latency.
- **Acceptance Criteria**:
  1. P95 latency is under 25ms for standard rule sets.
  2. Fail-open and fail-closed directives behave exactly as configured.
- **Scope Tier**: Tier 1 (Initial Core).

#### `FR-POL-002`: Dynamic Policy Bundle Distribution
- **User / Principal**: Security Administrator / CI Automation.
- **Trigger**: Security team updates governance rules or compliance policies.
- **Input**:
  - `bundleTarball` (gzipped tar archive containing `.rego` and `data.json`).
  - `version` (semantic version string).
  - `signature` (Ed25519 digital signature of bundle).
- **Expected Result**: Validates bundle syntax, verifies signature against trusted key, stores bundle in versioned store, and broadcasts reload signal to OPA runtime instances.
- **Failure Behavior**: Invalid signature rejects upload with `403 Forbidden`. Rego syntax error returns `422 Unprocessable Entity`.
- **Permissions**: `policy:publish` (Admin only).
- **Audit Requirements**: Audit event records admin identity, bundle version, cryptographic digest, and signature verification result.
- **Acceptance Criteria**:
  1. Bundle is loaded without restarting the application server.
  2. Corrupted or unsigned bundles are rejected with zero impact on currently loaded policy.
- **Scope Tier**: Tier 1 (Initial Core).

---

### 4.4 Human Review & Attestation Workflow Module (FR-REV)

#### `FR-REV-001`: Review Case Creation & Orchestration
- **User / Principal**: Governance State Machine or Policy Service.
- **Trigger**: Claim receives `disputed` status or policy disposition returns `require_human_review`.
- **Input**:
  - `claimVersionId` (UUID).
  - `triggerReason` (string).
  - `severity` (`low` | `medium` | `high` | `critical`).
  - `deadline` (ISO 8601 timestamp, optional).
- **Expected Result**: Creates `ReviewCase`, triggers durable workflow (Temporal / DB state machine), assigns reviewers based on project routing rules, and emits `review.case_created.v1`.
- **Failure Behavior**: Duplicate review case creation for active claim returns existing active `ReviewCase`.
- **Permissions**: Internal Service / `review:create`.
- **Audit Requirements**: Logs case creation, assigned roles, and triggering evidence IDs.
- **Acceptance Criteria**:
  1. Review cases maintain unique active lease per claim version.
  2. Deadlines trigger automated escalation alerts.
- **Scope Tier**: Tier 2 (Enterprise Governance).

#### `FR-REV-002`: Authoritative Human Attestation Sign-Off
- **User / Principal**: Authorized Human Reviewer.
- **Trigger**: Reviewer completes investigation and renders verdict in governance portal.
- **Input**:
  - `reviewCaseId` (UUID).
  - `verdict` (`approve_attestation` | `confirm_rejection` | `request_remediation`).
  - `attestationStatement` (string).
  - `reviewerSignature` (optional cryptographic user token).
- **Expected Result**: Transitions `ReviewCase` to `resolved`, records `Approval` entity, and transitions underlying `ClaimVersion` to `attested` or `rejected`.
- **Failure Behavior**: Reviewer without appropriate role (e.g. attempting to approve critical case with junior role) receives `403 Forbidden`.
- **Permissions**: `review:attest` with appropriate role level.
- **Audit Requirements**: Append-only log of reviewer ID, IP address, timestamp, verdict, and digital signature.
- **Acceptance Criteria**:
  1. Resolving the case atomically updates the associated claim version.
  2. An approval cannot be altered or redacted after submission.
- **Scope Tier**: Tier 2 (Enterprise Governance).

---

### 4.5 Lineage Graph & Cryptographic Audit Module (FR-GRAPH)

#### `FR-GRAPH-001`: Immutable Dependency DAG Construction
- **User / Principal**: Lineage Engine.
- **Trigger**: Creation of claim version, evidence link, or decision outcome.
- **Input**:
  - `sourceNodeId` (UUID) & `sourceNodeType` (`source_artifact` | `evidence_item` | `claim_version` | `decision_version`).
  - `targetNodeId` (UUID) & `targetNodeType`.
  - `edgeType` (`derives_from` | `supported_by` | `refuted_by` | `governed_by` | `attested_by`).
  - `captureMethod` (`captured` | `declared` | `attested` | `inferred` | `unknown`).
  - `confidenceScore` (float between 0.0 and 1.0, optional).
- **Expected Result**: Appends row to `typed_dependency_edges` table with foreign key validation; prevents cyclic dependencies across temporal boundaries.
- **Failure Behavior**: Cyclic reference detected in temporal ancestry returns `400 Bad Request`.
- **Permissions**: Internal Service / `lineage:write`.
- **Audit Requirements**: Edge insertion is append-only with immutable creation timestamp.
- **Acceptance Criteria**:
  1. Capture method is explicitly stored and indexed.
  2. Querying lineage traversal returns full upstream and downstream DAGs via recursive CTE.
- **Scope Tier**: Tier 1 (Initial Core).

#### `FR-GRAPH-002`: Tamper-Evident Audit Bundle Export
- **User / Principal**: Compliance Officer / Auditor.
- **Trigger**: Request compliance export for external audit or regulatory filing.
- **Input**:
  - `claimConceptId` or `decisionId` (UUID).
  - `includeEvidencePayloads` (boolean).
- **Expected Result**: Assembles all claim versions, evidence items, policy evaluations, and approvals into a structured JSON/Zip bundle; signs bundle with tenant private key; includes SHA-256 verification manifest.
- **Failure Behavior**: Tenant mismatch returns `404 Not Found`.
- **Permissions**: `audit:export`.
- **Audit Requirements**: Records audit export event with recipient identity and bundle hash.
- **Acceptance Criteria**:
  1. External verifier script can validate bundle integrity using public key and SHA-256 manifest.
  2. Bundle captures full valid time vs transaction time metadata.
- **Scope Tier**: Tier 2 (Enterprise Governance).

---

## 5. Non-Functional Requirements (NFR)

### 5.1 Security & Tenant Isolation (NFR-SEC)
- **`NFR-SEC-001`: Defense-in-Depth Multi-Tenancy**: Tenant isolation must be enforced both at the application gateway (JWT authentication) and at the database layer (PostgreSQL Row-Level Security). Zero cross-tenant data leaks under any condition.
- **`NFR-SEC-002`: Authoritative State Guard**: No route handler or API allows an LLM completion or tool result to update status columns in `claims`, `policies`, or `approvals`. Only verified services with validated business rules can transition state.
- **`NFR-SEC-003`: Untrusted Input Sanitization**: All incoming JSON payloads, external webhooks, and OTel traces must pass through strict Zod schemas before being processed or persisted.
- **`NFR-SEC-004`: Secret & PII Masking**: PII patterns (email, phone, SSN) and API keys (Bearer tokens, AWS keys) must be automatically redacted from evidence payloads before storage, unless tenant explicitly configures raw retention.

### 5.2 Performance & Scalability (NFR-PERF)
- **`NFR-PERF-001`: Asynchronous Ingestion Overhead**: Ingestion API endpoint must return HTTP 202 Accepted within **< 10ms** (p95) by offloading processing to internal inbox/queues.
- **`NFR-PERF-002`: Synchronous Policy Admission Latency**: Synchronous policy evaluation (`/v1/policy/evaluate`) must complete in **< 25ms** (p95) under 500 concurrent requests.
- **`NFR-PERF-003`: Lineage Traversal Depth**: Lineage DAG queries up to 10 hops deep must return in **< 150ms** (p95) using PostgreSQL recursive CTEs.

### 5.3 Reliability & Disaster Recovery (NFR-REL)
- **`NFR-REL-001`: At-Least-Once Delivery Resilience**: All background queues and webhook consumers must be idempotent, safely tolerating identical message re-deliveries.
- **`NFR-REL-002`: Database Rollback Safety**: Every database migration must include an automated, tested `down` migration script. Zero destructive unversioned schema alterations.

---

## 6. Integration Requirements (INT)

- **`INT-OTEL-001`: OpenTelemetry GenAI Semantic Conventions**: Ingest GenAI spans containing `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, token metrics, and tool execution spans.
- **`INT-MCP-001`: Model Context Protocol Gatekeeper**: Expose an MCP server proxy that intercepts tool requests and resource reads, validating them against OPA policy bundles before delegating to downstream tool providers.
- **`INT-WEB-001`: Cryptographically Signed Webhooks**: Ingest and dispatch webhooks with HMAC-SHA256 signatures, `X-ProofMesh-Signature` headers, and timestamp replay prevention.
