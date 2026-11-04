# Architecture Decision Records (ADRs)

This directory records all authoritative architectural and technical decisions made throughout the lifecycle of ProofMesh.

## ADR Standard Format
Every ADR adheres to the following structure:
- **Title**: `ADR-XXXX: Title`
- **Status**: `PROPOSED`, `ACCEPTED`, `REJECTED`, `DEPRECATED`, `SUPERSEDED`
- **Context & Problem Statement**: The background, driving requirements, and constraints.
- **Alternatives Considered**: Technical options evaluated with trade-off analysis.
- **Decision & Technical Rationale**: The architectural choice made and detailed evidence-based justification.
- **Consequences**: Positive and negative trade-offs, compliance impacts, and technical implications.
- **Reconsideration Triggers**: Specific conditions under which the decision must be formally revisited.

---

## Baselined Records

| ADR Number | Title | Status | Scope |
| :--- | :--- | :--- | :--- |
| [ADR-0001](./0001-modular-monolith-vs-services.md) | Modular Monolith Architecture vs. Microservices | **ACCEPTED** | System Topology & Scalability |
| [ADR-0002](./0002-postgresql-relational-graph.md) | PostgreSQL Relational Graph Storage vs. Graph Database | **ACCEPTED** | Lineage DAG & Query Architecture |
| [ADR-0003](./0003-event-transport-outbox.md) | Transactional Outbox Pattern & Event Transport Strategy | **ACCEPTED** | Event Pipeline & Reliability |
| [ADR-0004](./0004-temporal-workflow-orchestration.md) | Durable Workflow Orchestration Strategy | **ACCEPTED** | Long-Running Human Reviews |
| [ADR-0005](./0005-opa-policy-integration.md) | Open Policy Agent (OPA) Integration & Bundle Execution Mode | **ACCEPTED** | Synchronous Gatekeeping & Policy Engine |
| [ADR-0006](./0006-content-capture-privacy.md) | Content Capture, Privacy & Data Redaction Model | **ACCEPTED** | PII Redaction & Data Sovereignty |
| [ADR-0007](./0007-sdk-framework-adapters.md) | Client SDK & Framework Adapter Strategy | **ACCEPTED** | Integration Connectors & Client Libraries |
| [ADR-0008](./0008-object-storage-snapshotting.md) | Object Storage & Evidence Snapshotting Strategy | **ACCEPTED** | Binary Payloads & Content-Addressable Storage |
| [ADR-0009](./0009-tenant-isolation-audit.md) | Multi-Tenant Isolation & Cryptographic Audit Ledger Design | **ACCEPTED** | PostgreSQL RLS & Merkle Checkpoints |
