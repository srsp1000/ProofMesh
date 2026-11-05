# ADR-0001: Modular Monolith Architecture vs. Microservices

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Backend Engineer, Architecture Auditor

---

## 1. Context & Problem Statement

ProofMesh is an evidence-to-decision governance platform for AI applications. It encompasses several distinct domain capabilities: claim lifecycle management, evidence ingestion, policy evaluation, lineage graph construction, and human review workflows.

The architectural team must determine the initial deployment and service composition topology: should ProofMesh be built as distributed microservices or as a cohesive modular monolith?

---

## 2. Alternatives Considered

### Alternative A: Distributed Microservices

- Deploy independent services (`claims-service`, `evidence-service`, `policy-service`, `lineage-service`, `review-service`) connected via gRPC and message brokers.
- **Pros**: Independent deployability; individual horizontal scaling.
- **Cons**: High operational overhead; distributed transaction complexity (sagas); cross-service latency penalties (> 20ms network hops violating synchronous policy SLAs); complex local development.

### Alternative B: Single Modular Monolith (Chosen)

- Deploy a single Node.js/TypeScript application structured into strictly encapsulated domain modules (`src/modules/*`), communicating in-process via typed interfaces and an internal domain event bus.
- **Pros**: Sub-millisecond in-process function invocation; single database connection pool; simplified ACID transactions; low cloud operational footprint; frictionless local development.
- **Cons**: Requires strict discipline to prevent spaghetti imports and domain leakage.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative B: Modular Monolith** in TypeScript.

In accordance with ProofMesh Operating Rule 4 (_"prefer the simplest reliable design; avoid needless microservices, generic frameworks, abstractions, and duplicate packages"_), a modular monolith provides optimal latency and maintainability during initial phases.

Strict module boundaries (`index.ts` public interface exports only, with private internal models) ensure that if high-throughput modules (e.g. Telemetry Ingestion) require independent horizontal scaling in the future, they can be extracted with zero domain rewrites.

---

## 4. Consequences & Trade-offs

### Positive Consequences

- Synchronous policy evaluation latency achieves the p95 < 25ms SLA with zero network hop overhead.
- Database transactions span claim transitions and outbox writes atomically without distributed two-phase commits.
- Deployment is a single Docker container, drastically reducing customer VPC operational burden.

### Negative Consequences / Risks

- Codebase requires strict linting rules (`eslint-plugin-boundaries` or dependency cruisers) to prevent circular imports between modules.
- Single deployable means bug fixes require redeploying the monolith container.

---

## 5. Reconsideration Triggers

This decision will be formally reconsidered if:

1. Ingestion throughput exceeds 25,000 events/second, creating compute or GC contention with synchronous policy evaluation.
2. Team size scales beyond 20 concurrent engineers where independent deployment pipelines become mandatory.
