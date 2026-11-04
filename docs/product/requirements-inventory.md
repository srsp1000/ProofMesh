# ProofMesh Requirements Inventory & Domain Catalog

**Document:** `docs/product/requirements-inventory.md`  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined  

---

## 1. Domain Taxonomy & Non-Negotiable Distinctions

ProofMesh is an integration-first evidence-to-decision governance platform for AI-powered applications. All requirements and data structures must strictly preserve the following five domain distinctions:

### 1.1 Claim Lifecycle
Authoritative claims progress through strict, discrete lifecycle states managed exclusively by trusted domain application services:
- **`draft`**: Claim is being authored; not yet submitted for evaluation.
- **`submitted`**: Claim submitted to governance engine; awaiting evidence evaluation.
- **`evaluating`**: Evidence is actively being correlated and analyzed.
- **`attested`**: Authoritative attestation verified by authorized criteria or human sign-off.
- **`disputed`**: Conflicting evidence or policy failure has challenged the claim.
- **`rejected`**: Claim definitively refuted or failed mandatory policy admission.
- **`archived`**: Retained in append-only storage for historical audit; immutable.

### 1.2 Evidence Outcome
Evaluated relationship between an item of evidence and an associated claim:
- **`supports`**: Directly corroborates the claim.
- **`refutes`**: Contradicts or disproves the claim.
- **`inconclusive`**: Evidence is insufficient or ambiguous.
- **`contradictory`**: Internal conflicts exist within the evidence payload itself.

### 1.3 Evidence Applicability
Degree of relevance of evidence to the target claim:
- **`direct`**: Evidence originates from the exact system, runtime trace, or document evaluated.
- **`analogous`**: Evidence originates from a comparable or baseline scenario.
- **`contextual`**: Environmental or circumstantial metadata.
- **`inapplicable`**: Irrelevant to the claim under evaluation.

### 1.4 Policy Disposition
Governance outcome returned by the policy engine:
- **`admit`**: Action or claim meets all policy criteria; allowed to proceed.
- **`deny`**: Policy violation; blocked immediately.
- **`require_human_review`**: High-risk or ambiguous condition requiring human approval.
- **`warn`**: Policy advisory logged; execution proceeds non-blockingly.
- **`remediate`**: Automated filtering or transformation applied before admission.

### 1.5 Dependency Capture Method
Classification of how dependencies or causal linkages were established:
- **`captured`**: Observed directly from system runtime traces or network telemetry.
- **`declared`**: Explicitly stated in static configuration or package manifests.
- **`attested`**: Cryptographically signed or verified by an authorized human or service identity.
- **`inferred`**: Deduced via heuristic, model analysis, or probabilistic linkage.
- **`unknown`**: Relationship is ambiguous or unverified.
*Rule: Inferred or unknown relationships must NEVER be presented as proven causal facts.*

---

## 2. Requirements Inventory

### Status Legend
- **Verified**: Requirement grounded in approved product architecture and technical specifications.
- **Proposed**: Planned architectural feature undergoing review.
- **Assumed**: Reasonable technical deduction pending formal playbook ratification.
- **Unresolved**: Open requirement requiring stakeholder decision.
- **Out of Scope**: Explicitly excluded from core ProofMesh platform scope.

---

### 2.1 Functional Requirements (REQ-FUNC)

| ID | Title | Description | Domain Mapping | Status |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-FUNC-01** | Evidence Ingestion API | Ingest external evidence items (telemetry traces, evaluation logs, documents) via REST and webhooks with idempotency keys. | Evidence Lifecycle | **Verified** |
| **REQ-FUNC-02** | Claim State Machine | Enforce authoritative claim state transitions (`draft` -> `submitted` -> `evaluating` -> `attested` / `disputed` / `rejected` -> `archived`). | Claim Lifecycle | **Verified** |
| **REQ-FUNC-03** | Evidence Evaluation Engine | Correlate evidence against claims, classifying Evidence Outcome (`supports`, `refutes`, `inconclusive`, `contradictory`) and Applicability (`direct`, `analogous`, `contextual`, `inapplicable`). | Evidence Outcome & Applicability | **Verified** |
| **REQ-FUNC-04** | Policy Evaluation Pipeline | Evaluate incoming actions against OPA Rego policy bundles, returning a definitive Policy Disposition (`admit`, `deny`, `require_human_review`, `warn`, `remediate`). | Policy Disposition | **Verified** |
| **REQ-FUNC-05** | Human Review Queue | Provide a portal and API for human operators to inspect pending claims, resolve disputes, and submit signed attestations. | Claim Attestation | **Verified** |
| **REQ-FUNC-06** | Evidence Lineage Graph | Construct and expose an immutable DAG representing claims, supporting evidence nodes, policy checks, and causal dependency methods. | Dependency Capture | **Verified** |
| **REQ-FUNC-07** | Document Extraction Service | Ingest and extract text/metadata from PDF and structured documents using zero-native, secure parsing (`unpdf`). | Evidence Ingestion | **Verified** |
| **REQ-FUNC-08** | Audit Trail Export | Generate cryptographically verifiable audit bundles containing full lineage, state transitions, and evaluation outputs. | Immutability | **Verified** |

---

### 2.2 Non-Functional & Reliability Requirements (REQ-NF)

| ID | Title | Description | Target Metric | Status |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-NF-01** | Non-Blocking Telemetry | Telemetry and observation ingestion must be asynchronous and non-blocking by default. | Latency overhead < 5ms | **Verified** |
| **REQ-NF-02** | Synchronous Policy Latency | When configured in synchronous blocking enforcement mode, policy evaluation must execute with minimal latency. | p95 < 25ms | **Verified** |
| **REQ-NF-03** | Ingestion Idempotency | Tolerate duplicate event deliveries gracefully using idempotency keys. | Zero duplicate records | **Verified** |
| **REQ-NF-04** | Append-Only Storage | Historical claims, evidence, decisions, and audit entries must be permanently immutable. | Zero UPDATE/DELETE on history | **Verified** |
| **REQ-NF-05** | Horizontal Scalability | Stateless API services scalable horizontally behind standard load balancers. | Stateless service layer | **Verified** |

---

### 2.3 Security Requirements (REQ-SEC)

| ID | Title | Description | Standards Compliance | Status |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-SEC-01** | Multi-Tenant Isolation | Tenant isolation enforced strictly at server layer and database layer (PostgreSQL RLS or tenant schemas). | OWASP ASVS v4.0 | **Verified** |
| **REQ-SEC-02** | Authoritative State Protection | LLMs, external agents, and untrusted clients must NEVER directly mutate authoritative claim status, policies, or audit logs. | OWASP Agentic ASI03 | **Verified** |
| **REQ-SEC-03** | Untrusted Input Validation | Validate all external payloads, headers, webhook deliveries, and tool results using strict runtime schemas (Zod). | OWASP ASVS 5.1 | **Verified** |
| **REQ-SEC-04** | Prompt Injection Mitigation | External documents and prompt contexts must be treated as untrusted data channels; tool execution requires strict schema adherence. | OWASP LLM01 / ASI01 | **Verified** |
| **REQ-SEC-05** | Cryptographic Integrity | Hash evidence and audit log blocks using collision-resistant algorithms (SHA-256). Verify digital signatures for external attestations. | NIST SSDF / SLSA | **Verified** |
| **REQ-SEC-06** | Secrets Hygiene | Zero hardcoded credentials or API tokens in code; load strictly from environment or secret managers. | OWASP ASVS 14.2 | **Verified** |

---

### 2.4 Integration Requirements (REQ-INT)

| ID | Title | Description | Protocol / Standard | Status |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-INT-01** | OpenTelemetry Ingestion | Ingest GenAI telemetry traces adhering to OTel GenAI semantic conventions (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`). | OTel GenAI SemConv | **Verified** |
| **REQ-INT-02** | Model Context Protocol Connector | Provide MCP server and client adapters to govern AI tool calls and resource reads under strict policy control. | MCP Spec (JSON-RPC) | **Verified** |
| **REQ-INT-03** | Webhook Dispatcher & Receiver | Support incoming and outgoing signed webhooks with HMAC signatures and exponential retry backoff. | RFC 2104 (HMAC) | **Verified** |
| **REQ-INT-04** | OPA Policy Bundle Integration | Pull and evaluate compiled Rego policy bundles dynamically via OPA Bundle API. | OPA Bundle Spec | **Verified** |
| **REQ-INT-05** | Event Stream Connector | Decouple ingestion pipelines via lightweight event streaming (NATS JetStream or PostgreSQL LISTEN/NOTIFY). | NATS / PostgreSQL | **Proposed** |

---

### 2.5 Privacy & Governance Requirements (REQ-PRIV)

| ID | Title | Description | Compliance Focus | Status |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-PRIV-01** | Sensitive Data Redaction | Automatically detect and redact PII, authorization tokens, and credentials from telemetry traces before persistence. | GDPR / CCPA / HIPAA | **Verified** |
| **REQ-PRIV-02** | Tenant-Scoped Retention | Enforce configurable retention and archiving policies on a per-tenant basis while preserving cryptographic audit proof. | Data Minimization | **Verified** |
| **REQ-PRIV-03** | Causality Integrity | Strictly maintain metadata tags distinguishing `captured`, `declared`, `attested`, `inferred`, and `unknown` relationships. | AI Ethics & Governance | **Verified** |

---

### 2.6 Operational & Observability Requirements (REQ-OPS)

| ID | Title | Description | Target SLA / Tool | Status |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-OPS-01** | Explicit Fail-Open/Closed Policies | Document and implement explicit failure behaviors when external model providers, databases, or policy engines fail. | Zero undefined failure states | **Verified** |
| **REQ-OPS-02** | Health & Readiness Probes | Provide `/healthz` (liveness) and `/readyz` (readiness) endpoints reflecting downstream connectivity. | Kubernetes / Docker | **Verified** |
| **REQ-OPS-03** | Structured Logging | Emit JSON-formatted logs with correlation IDs, tenant IDs (redacted), and trace contexts. | OpenTelemetry Tracing | **Verified** |

---

### 2.7 Evaluation & Quality Assurance Requirements (REQ-EVAL)

| ID | Title | Description | Target Coverage | Status |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-EVAL-01** | Automated Contract Testing | Maintain contract test suites validating public API endpoints and webhook schemas. | 100% schema assertion | **Verified** |
| **REQ-EVAL-02** | Negative & Fuzz Testing | Verify system rejection of malformed payloads, cross-tenant injection attempts, and forged HMAC signatures. | Zero security bypass | **Verified** |
| **REQ-EVAL-03** | Zero-Mock Production Discipline | Ensure test mocks are strictly confined to `test/fixtures/` and never bundled into production builds. | 0 mocks in `src/` | **Verified** |

---

## 3. Discrepancy & Conflict Analysis

Comparing this verified requirements inventory against the current workspace state:
- **Code vs. Spec Conflict**: Currently **zero conflict**, because no legacy or conflicting application code exists in the repository.
- **Scaffolding Alignment**: All scoped rules in `.agents/rules/` and subagent definitions in `.agents/agents/` are 100% aligned with this requirements catalog.
