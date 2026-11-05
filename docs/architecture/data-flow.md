# ProofMesh Data Flow Architecture

**Document:** `docs/architecture/data-flow.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Architecture Specification

---

## 1. Executive Summary & Core Data Pipelines

ProofMesh coordinates five core data flow pipelines designed to satisfy the competing requirements of high-throughput non-blocking observation (< 5ms overhead) and sub-25ms synchronous policy enforcement:

1. **Asynchronous Telemetry Ingestion Pipeline (Non-Blocking)**
2. **Synchronous Policy Gatekeeping Pipeline (Inline PEP)**
3. **Evidence Correlation & Claim Evaluation Pipeline**
4. **Human Review, Dispute & Attestation Pipeline**
5. **Audit Ledger & Merkle Checkpoint Pipeline**

---

## 2. Pipeline 1: Asynchronous Telemetry Ingestion Pipeline

This pipeline handles OTel GenAI spans, tool execution events, and document updates without introducing latency or fragility into client applications.

```mermaid
flowchart LR
    A["External Agent / OTel Collector"] -->|1. POST /v1/telemetry/events| B["Integration Gateway"]
    B -->|2. Validate JWT & Tenant| C["Tenant Context (AsyncLocalStorage)"]
    C -->|3. Validate Zod Schema| D["Ingestion Controller"]
    D -->|4. Idempotency Check| E["Inbox Table (PostgreSQL)"]
    D -->|5. Compute SHA-256 Digest| F["Content Hasher"]
    D -->|6. Redact PII / Secrets| G["Redaction Filter"]
    D -->|7. Fast Acknowledgment| A["202 Accepted (< 10ms)"]

    D -->|8. Append Row| H["evidence_items (Immutable)"]
    D -->|9. Write Event| I["outbox (evidence.ingested.v1)"]
    I -->|10. Relay Worker| J["Domain Event Bus (NATS/PostgreSQL)"]
```

### Transformation Stages

1. **Header & Context Extraction**: Extracts `Authorization`, `X-Tenant-ID` (validated against JWT claims), and `Idempotency-Key`.
2. **Idempotency Verification**: Checks `inbox_events`. If duplicate, immediately returns original 202 payload with `X-ProofMesh-Duplicate: true`.
3. **Cryptographic Fingerprinting**: Calculates `SHA-256(raw_payload_bytes)` before any modifications to ensure verifiable data provenance.
4. **In-Flight Sanitization**: Runs PII detection filters (regex for SSNs, credit cards, emails) and secrets scanners (Bearer tokens, AWS keys). Masks sensitive tokens unless raw storage is configured.
5. **Transactional Ingestion**: Simultaneously writes the `EvidenceItem` and the `outbox` event within a single PostgreSQL transaction.

---

## 3. Pipeline 2: Synchronous Policy Gatekeeping Pipeline

This pipeline provides inline admission control for high-risk tool invocations or sensitive document publications.

```mermaid
flowchart TD
    A["Agent Tool Interceptor / MCP Gateway"] -->|1. Tool Execution Request| B["Policy Enforcement Point (PEP)"]
    B -->|2. Extract Action & Parameters| C["Input Context Normalizer"]
    C -->|3. Query In-Memory Policy Bundle| D["In-Process OPA Wasm Runtime"]

    D -->|4. Evaluate Rego Rules (< 2ms)| E{"Policy Disposition"}

    E -->|admit| F["Forward Request to Target Tool Server"]
    F -->|Return Tool Output| A

    E -->|deny| G["Block Request with 403 Forbidden & Violation Reason"]
    G --> A

    E -->|require_human_review| H["Create ReviewCase & Return 202 Pending Token"]
    H --> A

    D -.->|Async Logging| I["outbox (policy.evaluated.v1)"]
    I -.->|Background Worker| J["policy_evaluations Table (PostgreSQL)"]
```

### Latency Budget Allocation (< 25ms SLA)

- **Transport & TLS Termination**: 2ms
- **Authentication & Tenant Binding**: 2ms
- **Zod Input Schema Validation**: 1ms
- **In-Process OPA Wasm Policy Evaluation**: 2ms
- **Response Packaging & Async Outbox Queue**: 2ms
- **Total ProofMesh Overhead**: **~9ms** (well within the 25ms SLA budget).

---

## 4. Pipeline 3: Evidence Correlation & Claim Evaluation Pipeline

This asynchronous pipeline evaluates ingested evidence against active claims, establishes lineage graph edges, and detects stale assessments.

```mermaid
flowchart TD
    A["Event Bus (evidence.ingested.v1)"] --> B["Evaluation Worker"]
    B -->|Query Claims under RLS| C["PostgreSQL (claims & source_artifacts)"]

    B -->|Check Source Version| D{"Is Source Version New?"}
    D -->|Yes| E["Set prior AssessmentVersion.is_stale = true"]
    D -->|No| F["Proceed with Evaluation"]

    E --> G["Flag Affected Claim as evaluating"]
    F --> H["Evaluate Claim-Evidence Matrix"]

    H -->|Classify Outcome| I["Outcome: supports | refutes | inconclusive"]
    H -->|Classify Applicability| J["Applicability: direct | analogous | contextual"]

    I & J --> K["Insert assessment_versions"]
    K --> L["Append typed_dependency_edges (DAG)"]

    L --> M{"Outcome == refutes?"}
    M -->|Yes| N["Transition ClaimVersion to disputed"]
    N --> O["Auto-trigger ReviewCase"]
    M -->|No| P["Transition ClaimVersion to attested (if policy met)"]
```

---

## 5. Pipeline 4: Human Review & Attestation Pipeline

This pipeline governs human-in-the-loop dispute resolution, quorum reviews, and tamper-evident sign-offs.

```mermaid
flowchart LR
    A["Claim in disputed Status"] --> B["Review & Workflow Service"]
    B -->|Create ReviewCase| C["review_cases Table"]
    B -->|Notify Assigned Role| D["Governance Portal (Web UI)"]

    D -->|Compliance Officer Inspects Lineage| E["Lineage Graph API"]
    D -->|Reviewer Submits Signed Attestation| F["POST /v1/reviews/:id/approve"]

    F -->|Verify Reviewer Permissions| G["Authorization Guard"]
    G -->|Atomic DB Transaction| H["PostgreSQL"]

    H -->|1. Insert approval record| I["approvals"]
    H -->|2. Update ReviewCase -> resolved| J["review_cases"]
    H -->|3. Transition ClaimVersion -> attested| K["claim_versions"]
    H -->|4. Append Merkle Event| L["audit_events"]
```

---

## 6. Pipeline 5: Audit Ledger & Merkle Checkpointing Pipeline

This pipeline guarantees historical non-repudiation and provides exportable compliance packages.

```mermaid
flowchart TD
    A["State Change in Any Domain Module"] --> B["Database Trigger / Service Layer"]
    B -->|Append-Only INSERT| C["audit_events Table"]

    C -->|Calculate Block Hash| D["SHA-256(Payload + Prev_Hash)"]
    D -->|Cryptographic Hash Chain| E["Linear Event Ledger"]

    F["Hourly Checkpoint Cron"] --> G["Audit Checkpoint Worker"]
    G -->|Collect Hourly Block Hashes| H["Build Merkle Tree"]
    H -->|Calculate Root Hash| I["audit_checkpoints Table"]
    I -->|Sign with Tenant Private Key| J["Signed Cryptographic Attestation"]

    K["Auditor Export Request"] --> L["Export Worker"]
    L -->|Assemble Manifest & Audit Block| M["Signed Audit Bundle (.zip)"]
    M --> N["Immutable Object Store (S3)"]
```

---

## 7. Storage Tier Data Partitioning & Retention

| Data Classification              | Storage Medium               | Immutability Mechanism              | Retention Policy                                        |
| :------------------------------- | :--------------------------- | :---------------------------------- | :------------------------------------------------------ |
| **Claim & Decision Versions**    | PostgreSQL (Relational)      | DB triggers block `UPDATE`/`DELETE` | Indefinite / Configurable per tenant (default: 7 years) |
| **Evidence Metadata & Hashes**   | PostgreSQL (Relational)      | DB triggers block `UPDATE`/`DELETE` | Permanent audit record                                  |
| **Raw Evidence Payloads / PDFs** | S3-Compatible Object Store   | S3 Object Lock (Compliance Mode)    | Tenant-configurable (30 days to 7 years)                |
| **Lineage DAG Edges**            | PostgreSQL (Adjacency table) | Append-only index                   | Permanent                                               |
| **Audit Ledger & Checkpoints**   | PostgreSQL + S3 Merkle Root  | Cryptographic hash chaining         | Permanent immutable ledger                              |
| **Ephemeral Ingestion Inbox**    | PostgreSQL (`inbox_events`)  | Automated partition drop            | Rolling 7-day retention                                 |
