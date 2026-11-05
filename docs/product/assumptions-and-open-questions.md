# Assumptions, Technical Decisions & Open Questions

**Document:** `docs/product/assumptions-and-open-questions.md`  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Under Active Review

---

## 1. Overview & Classification Scheme

In accordance with ProofMesh Operating Rule 2 (_"Do not invent files, functions, dependencies, APIs..."_) and the SDLC guidelines (_"If an important requirement is ambiguous... choose a conservative default, document it as an assumption and add a test"_), this document registers all foundational assumptions, architectural trade-offs, and open decisions identified during Phase 0.

### Item Status Types

- **CONFIRMED**: Backed by verified documentation and authoritative repo governance.
- **ASSUMPTION (Conservative Default)**: An engineering assumption adopted to enable progress without violating non-negotiable rules.
- **OPEN DECISION**: A critical design fork requiring formal stakeholder decision or ADR.

---

## 2. Technical Assumptions Log

### ASSUMP-01: Runtime Environment & Package Manager

- **Context**: The host machine runs Node.js `v26.3.0` and `pnpm 11.6.0`.
- **Assumption**: We will establish `pnpm` as the authoritative package manager using a monorepo or modular monolith workspace with strict Node.js engine constraints (`engines: { node: ">=20.0.0" }`).
- **Rationale**: Bleeding-edge Node v26 may exhibit peer dependency incompatibilities with older libraries; targeting `>=20.0.0` ensures local development succeeds while preserving backward compatibility with LTS environments (Node 20/22).
- **Verification Strategy**: Automated CI pipeline runs across Node 22 LTS and Node 26.

### ASSUMP-02: Persistence Strategy for Initial Phases

- **Context**: Docker is installed on the host (`Docker version 29.7.2`), but the daemon is not currently active, and `psql` is not installed globally in PATH.
- **Assumption**: Phase 1 local development will define a standardized `docker-compose.yml` deploying PostgreSQL 16 with a designated test database, while application data access code will use an abstraction (e.g., Kysely or Prisma) with migration tests that can also run against an in-memory/embedded test container or local Docker container.
- **Rationale**: Keeps database migrations standard and avoids manual host database setup.
- **Verification Strategy**: Migration up/down integration tests run as part of the Phase 1 test suite.

### ASSUMP-03: Event Streaming Architecture: PostgreSQL vs. NATS JetStream

- **Context**: Telemetry ingestion must be asynchronous and non-blocking by default (REQ-NF-01).
- **Assumption**: For Phase 1–2, we will implement an internal transactional event queue using PostgreSQL with `SKIP LOCKED` / `LISTEN/NOTIFY` (or an in-memory event bus with persistent ledger) before provisioning dedicated external NATS clusters.
- **Rationale**: Adheres to Rule 4 (_"prefer the simplest reliable design; avoid needless microservices and premature infrastructure"_). An external NATS cluster adds operational overhead before throughput metrics demand it.
- **Verification Strategy**: Latency benchmark verifying ingestion queue overhead is <5ms.

### ASSUMP-04: Document Parsing Engine

- **Context**: Evidence ingestion requires parsing PDF documents and extracting text.
- **Assumption**: ProofMesh will use **`unpdf`** (MIT license, modern PDF.js build) rather than `pdf-parse` or heavy OCR engines.
- **Rationale**: `unpdf` has zero native compilation dependencies (avoiding `node-gyp` and `canvas` failures) and runs seamlessly in serverless and containerized environments without vulnerability lag.
- **Verification Strategy**: Unit tests parsing sample evidence PDFs with corrupted structures and measuring execution time.

---

## 3. Open Architectural Decisions Requiring Formal Ratification

| Decision ID | Area                                | Options Considered                                                                                                                                          | Recommended Default                                                                                                                                   | Decision Trigger                             |
| :---------- | :---------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------- |
| **DEC-01**  | **Backend Framework**               | Option A: NestJS (Modular enterprise DI)<br/>Option B: Fastify + Zod (Ultra-lightweight modular monolith)                                                   | **Option B: Fastify + Zod** for maximum performance and minimal abstraction overhead, or **Option A** if dependency injection hierarchy is preferred. | Proposed in ADR-0002 during Phase 1 kickoff. |
| **DEC-02**  | **Multi-Tenant Database Isolation** | Option A: Row-Level Security (RLS) on shared tables<br/>Option B: Separate PostgreSQL schema per tenant<br/>Option C: Hybrid (RLS + tenant ID foreign keys) | **Option C: Hybrid (Mandatory tenant_id foreign keys + RLS policies)** for defense-in-depth.                                                          | Proposed in ADR-0003 during Phase 1 kickoff. |
| **DEC-03**  | **Policy Execution Engine Mode**    | Option A: In-process OPA WebAssembly (Wasm) evaluator<br/>Option B: Sidecar OPA daemon over HTTP REST                                                       | **Option A: In-process OPA Wasm** for synchronous low-latency policy admission (<5ms), with Option B for complex enterprise cluster deployments.      | Proposed in ADR-0004 during Phase 1 kickoff. |
| **DEC-04**  | **Evidence Lineage Graph Storage**  | Option A: Relational DAG adjacency table in PostgreSQL with recursive CTEs<br/>Option B: Dedicated Graph Database (e.g. Neo4j)                              | **Option A: Relational DAG adjacency tables with recursive CTEs in PostgreSQL** to maintain simplicity and ACID consistency.                          | Proposed in ADR-0005 during Phase 1 kickoff. |

---

## 4. Gating Items for Phase 1 Kickoff

To advance from Phase 0 to Phase 1 implementation:

1. **Approval of Phase 0 Deliverables**: Review and sign-off on the Phase 0 Baseline Report ([`phase-00.md`](file:///Users/rishisingh/ProofMesh/docs/phase-reports/phase-00.md)).
2. **ADR-0002 Approval**: Select backend framework (Fastify vs NestJS).
3. **Docker Daemon Activation**: Start Docker Desktop/daemon on the host machine to support local PostgreSQL containerization for migration tests.
