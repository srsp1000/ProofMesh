# ProofMesh C4 Model: Container Architecture (Level 2)

**Document:** `docs/architecture/c4-container.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Architecture Specification

---

## 1. Container Diagram

The Container diagram zooms into the ProofMesh Platform boundary, exposing the deployable units, datastores, protocols, and internal communication topologies.

```mermaid
C4Container
    title Container Diagram for ProofMesh Platform

    Person(officer, "Compliance Officer", "Human reviewer inspecting claims and evidence.")
    Person(dev, "Developer", "Configuring policies and monitoring agents.")
    System_Ext(agent, "AI Application / Agent", "External AI system streaming telemetry.")

    System_Boundary(c1, "ProofMesh Platform") {
        Container(spa, "Governance Web UI", "React 19 / Vite 6", "Single-Page Application providing governance dashboards, lineage graphs, and review queues.")
        Container(gateway, "API & Integration Gateway", "Fastify / Node.js", "Handles TLS termination, JWT validation, rate limiting, and Zod runtime schema validation.")

        Container_Boundary(monolith, "ProofMesh Modular Core (Node.js 26+)") {
            Component(claimSvc, "Claim Service", "TypeScript", "Authoritative state machine managing draft->attested claim lifecycles.")
            Component(evidSvc, "Evidence Engine", "TypeScript", "Computes SHA-256 digests, coordinates unpdf parsing, and builds assessment matrix.")
            Component(polSvc, "Policy Engine", "OPA Wasm / Rego", "In-process WebAssembly evaluator executing synchronous and asynchronous policy rules.")
            Component(lineageSvc, "Lineage Service", "TypeScript", "Traverses and persists the immutable append-only dependency DAG.")
            Component(reviewSvc, "Review Workflow", "TypeScript / Temporal", "Manages human review cases, approval quorums, and deadline escalations.")
            Component(outboxWorker, "Outbox Relay", "TypeScript Worker", "Reliably dispatches domain events from outbox table to event consumers.")
        }

        ContainerDb(pgDb, "Primary Relational Store", "PostgreSQL 16", "Stores relational metadata, claims, assessments, lineage edges, and audit ledger. Enforces RLS.")
        ContainerDb(objStore, "Evidence Object Store", "S3 / MinIO", "Stores raw evidence blobs, document PDFs, and signed audit export archives.")
        Container(eventBus, "Event Transport", "NATS JetStream / PostgreSQL Outbox", "Lightweight streaming backbone for asynchronous domain events.")
    }

    Rel(officer, spa, "Navigates dashboards & reviews cases", "HTTPS")
    Rel(dev, spa, "Configures rules & inspects logs", "HTTPS")
    Rel(spa, gateway, "Issues authenticated GraphQL/REST calls", "HTTPS / JSON")
    Rel(agent, gateway, "Streams telemetry & requests policy admission", "HTTPS / REST / WebSocket")

    Rel(gateway, monolith, "Forwards validated tenant requests", "In-Process / IPC")
    Rel(monolith, pgDb, "Reads/writes state under RLS", "TCP / PostgreSQL Port 5432")
    Rel(monolith, objStore, "Streams raw evidence files", "HTTPS / S3 API")
    Rel(outboxWorker, eventBus, "Publishes domain events", "TCP / NATS Port 4222")
    Rel(eventBus, monolith, "Delivers asynchronous events", "TCP / Pub-Sub")
```

---

## 2. Container Descriptions & Technical Responsibilities

| Container                     | Technology Stack                      | Scaling Model                    | Responsibilities & Invariants                                                                                                                                                       |
| :---------------------------- | :------------------------------------ | :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Governance Web UI**         | React 19, Vite 6, TailwindCSS         | Static CDN hosting               | Provides WCAG 2.1 AA accessible human review portal, interactive DAG visualizer, and policy management. Never implements client-authoritative security.                             |
| **API & Integration Gateway** | Fastify, Zod, `@fastify/jwt`          | Horizontal stateless replicas    | Enforces TLS termination, extracts and validates JWT tokens, injects `TenantContext`, checks idempotency keys, and applies strict Zod parsing before delegating to domain services. |
| **ProofMesh Modular Core**    | TypeScript 5.6+, Node.js 26+          | Horizontal stateless replicas    | Encapsulates all business logic, claim state transitions, evidence correlation, and OPA policy evaluation. Enforces strict zero-leakage module boundaries.                          |
| **Primary Relational Store**  | PostgreSQL 16 Enterprise              | Primary-Replica with HA failover | Stores all transactional entities, claim versions, and append-only audit ledgers. Row-Level Security (RLS) policies enforce multi-tenant isolation at the engine level.             |
| **Evidence Object Store**     | S3 / MinIO (Customer VPC compatible)  | Cloud-managed high durability    | Content-addressable storage for raw PDF documents, binary evidence items, context packets, and compressed audit bundle exports.                                                     |
| **Event Transport**           | NATS JetStream (or PostgreSQL Outbox) | 3-node Raft consensus cluster    | Decouples ingestion from downstream evaluations. Provides at-least-once message delivery, stream replay, and consumer acknowledgments.                                              |
