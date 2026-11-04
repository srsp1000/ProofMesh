# ProofMesh System Architecture Specification

**Document:** `docs/architecture/system-architecture.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Architecture Specification  

---

## 1. System Overview & Architectural Paradigm

ProofMesh is architected as an **integration-first, evidence-driven modular monolith**. It captures telemetry, evaluates policies, tracks claims, and persists immutable audit trails for AI systems without introducing unnecessary microservice complexity.

### Core Architectural Decisions
- **Modularity**: Cohesive domain modules (`claims`, `evidence`, `policy`, `lineage`, `reviews`) communicating via typed in-process interfaces and an internal domain event bus.
- **Transactional Outbox**: Decouples database mutations from asynchronous event streaming, guaranteeing at-least-once event publication without distributed two-phase commit transactions.
- **Strict Trust Isolation**: The public internet and third-party AI agents reside outside the trust perimeter. Ingestion gateways enforce runtime schema validation, authentication, and tenant isolation before payloads reach domain services.

---

## 2. Logical Architecture

```mermaid
flowchart TD
    subgraph Clients["Governed Clients & External Ecosystem"]
        Agents["AI Agents & Workflows<br/>(LangChain, LlamaIndex, SDK)"]
        Tools["MCP Tool Providers<br/>(External Services)"]
        Traces["OpenTelemetry Collectors<br/>(GenAI Spans)"]
        Reviewers["Human Reviewers / Compliance<br/>(Browser Web App)"]
    end

    subgraph Gateway["Integration Gateway & Boundary Layer"]
        Auth["JWT / API Key Authentication"]
        TenantCtx["Tenant Context Injection (AsyncLocalStorage)"]
        ZodVal["Strict Zod Runtime Schema Validation"]
        Idemp["Idempotent Inbox Deduplication"]
    end

    subgraph CoreEngine["ProofMesh Modular Monolith Core"]
        ClaimMod["Claim Module<br/>(Lifecycle State Machine)"]
        EvidMod["Evidence Module<br/>(SHA-256 Digest & Assessment Matrix)"]
        PolMod["Policy Module<br/>(In-Process OPA Wasm Engine)"]
        LineageMod["Lineage Module<br/>(Recursive DAG Adjacency Engine)"]
        ReviewMod["Review & Workflow Module<br/>(Attestation & Quorum Engine)"]
        AuditMod["Audit & Cryptographic Ledger<br/>(Merkle Checkpoints)"]
    end

    subgraph StorageLayer["Persistence & Storage Tier"]
        DB[(PostgreSQL 16 Enterprise<br/>Row-Level Security Enabled)]
        OutboxTable[(Transactional Outbox Table)]
        ObjStore[(S3-Compatible Object Store<br/>Immutable Evidence Snapshots)]
    end

    subgraph AsyncBus["Asynchronous Event Streaming"]
        OutboxRelay["Outbox Relay Worker"]
        EventStream["Internal Event Stream<br/>(PostgreSQL LISTEN/NOTIFY or NATS)"]
    end

    Clients --> Gateway
    Gateway --> CoreEngine
    CoreEngine --> DB
    CoreEngine --> ObjStore
    CoreEngine --> OutboxTable
    OutboxTable --> OutboxRelay
    OutboxRelay --> EventStream
    EventStream --> CoreEngine
```

---

## 3. Sequence Diagrams

### 3.1 Asynchronous Evidence Ingestion & Claim Evaluation

```mermaid
sequenceDiagram
    autonumber
    participant App as Governed AI App / SDK
    participant GW as Integration Gateway
    participant Evid as Evidence Service
    participant DB as PostgreSQL (RLS)
    participant Outbox as Outbox Table
    participant Worker as Evaluation Worker
    participant Pol as Policy Service (OPA)

    App->>GW: POST /v1/evidence (Idempotency-Key, payload)
    GW->>GW: Validate JWT & derive TenantId
    GW->>GW: Validate schema with Zod & check Idempotency
    GW->>Evid: IngestEvidence(TenantCtx, Payload)
    Evid->>Evid: Compute SHA-256 hash & redact PII
    Evid->>DB: INSERT INTO evidence_items (Immutable)
    Evid->>Outbox: INSERT INTO outbox (evidence.ingested.v1)
    Evid-->>GW: Return EvidenceId, ContentHash
    GW-->>App: 202 Accepted (Latency < 10ms)

    Note over Outbox,Worker: Asynchronous Non-Blocking Processing
    Outbox->>Worker: Dispatch evidence.ingested.v1
    Worker->>DB: Query linked ClaimVersion
    Worker->>Pol: Evaluate Evidence Outcome & Applicability
    Pol-->>Worker: Outcome: supports / applicability: direct
    Worker->>DB: INSERT INTO assessment_versions
    Worker->>DB: UPDATE claim_versions SET status = 'attested'
```

---

### 3.2 Synchronous Policy Enforcement & Admission Gate

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Agent / Tool Caller
    participant GW as Policy Gateway (PEP)
    participant Pol as Policy Engine (In-Process OPA Wasm)
    participant DB as PostgreSQL
    participant Tool as Target Tool / External API

    Agent->>GW: POST /v1/policy/evaluate (Action, Parameters, FailPolicy)
    GW->>GW: Verify Tenant & Authenticate
    GW->>Pol: EvaluatePolicy(Bundle, Action, Parameters)
    Note over Pol: In-Memory Rego Execution (< 5ms)
    alt Policy = admit
        Pol-->>GW: Disposition: admit
        GW->>Tool: Proxy Execution
        Tool-->>GW: Tool Output
        GW-->>Agent: 200 OK (Tool Output)
    else Policy = deny
        Pol-->>GW: Disposition: deny (Rule: Unapproved_DB_Mutation)
        GW-->>Agent: 403 Forbidden (Policy Denial Reason)
    else Policy = require_human_review
        Pol-->>GW: Disposition: require_human_review
        GW->>DB: Create ReviewCase (status: open)
        GW-->>Agent: 202 Accepted (Pending Human Approval Token)
    end
```

---

## 4. Component Architecture & System Boundaries

### 4.1 Integration Gateway & Protocol Adapters
- **OpenTelemetry GenAI Adapter**: Maps incoming OTLP HTTP/gRPC traces into canonical ProofMesh evidence items. Extracts token counts, model names, and prompt hashes.
- **Model Context Protocol (MCP) Proxy**: Implements standard MCP JSON-RPC protocol. Acts as an inline Policy Enforcement Point (PEP) intercepting tool requests.
- **Webhook Adapter**: Validates HMAC-SHA256 signatures, unpacks payloads, and handles timestamp anti-replay verification.
- **Switch Protocol Adapter**: Maintains persistent WebSocket/SSE connections with agent runtimes, managing session resumes (`session/resume`) and event synchronization.

### 4.2 Inbox/Outbox & Idempotent Processing
- **Transactional Outbox**: All domain events are inserted into an `outbox` table within the same database transaction that updates business entities. This eliminates race conditions and ensures zero event loss.
- **Outbox Relay**: A high-efficiency background worker polls the `outbox` table using `FOR UPDATE SKIP LOCKED` and publishes events to consumers.
- **Idempotent Inbox**: Incoming requests containing `Idempotency-Key` are verified against the `inbox_events` table. If previously processed, the cached response is returned immediately.

### 4.3 Database & Object Storage Boundaries
- **PostgreSQL 16 (Primary Datastore)**: Stores relational metadata, claim versions, evaluations, audit events, and lineage graph edges. Enforces multi-tenancy via Row-Level Security (RLS).
- **S3-Compatible Object Storage**: Stores large evidence payloads, raw document files (PDFs), context packets, and signed audit export archives. Payloads are referenced by SHA-256 content-addressable URIs.

### 4.4 Policy Enforcement Points (PEPs)
- **In-Process OPA WebAssembly Evaluator**: Rego policy bundles compiled to WebAssembly (Wasm) run directly within the Node.js application process, achieving sub-millisecond evaluation latency without network overhead.
- **Dynamic Bundle Sync**: A background polling routine checks the Policy Bundle Service every 60 seconds, verifying Ed25519 digital signatures before hot-swapping active Wasm policy instances.

### 4.5 Customer-Controlled Deployment & Data Plane
ProofMesh supports two operational topologies:
1. **Fully Managed SaaS Plane**: ProofMesh hosts both the control plane (dashboard, policy distribution) and data plane (telemetry ingestion, database).
2. **Customer-Controlled Hybrid Data Plane**: Customers run the ProofMesh Docker/Kubernetes container within their own VPC/cloud account. Raw evidence payloads and database records never leave the customer's perimeter; only anonymized policy metric heartbeats flow back to the central control plane.

---

## 5. Failure Domains & Recovery Paths

| Failure Scenario | Impact | Recovery Path |
| :--- | :--- | :--- |
| **Database Network Partition** | Ingestion & evaluation temporarily blocked. | Gateway buffers events in local disk spool; retries with exponential backoff. Ingestion endpoints return `503 Service Unavailable` with `Retry-After`. |
| **Policy Engine Timeout** | Synchronous enforcement requests delayed. | Evaluates `failPolicy`: If `fail_open`, admits request with warning; if `fail_closed`, rejects with 403. |
| **Object Store Outage** | Cannot persist raw evidence payloads. | Ingestion buffers payload metadata in PostgreSQL; raw blob upload deferred to background retry queue. |
| **Outbox Worker Crash** | Asynchronous domain events delayed. | Standby outbox worker picks up unprocessed rows via `SKIP LOCKED`. Zero event loss. |
