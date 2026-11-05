# ADR-0003: Transactional Outbox Pattern & Event Transport Strategy

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Data Engineer, Integration Engineer

---

## 1. Context & Problem Statement

When state transitions occur in ProofMesh (e.g. claim submitted, evidence ingested), asynchronous events must be broadcast to downstream evaluators, search indexers, and webhook dispatchers.

The system must ensure that database writes and event publishing are atomic: an event must **never** be published if the database transaction rolls back, and events must **never** be lost if the process crashes immediately after committing.

---

## 2. Alternatives Considered

### Alternative A: Dual-Writing directly to External Message Broker (Kafka / NATS)

- Write to PostgreSQL, then immediately call `broker.publish()`.
- **Pros**: Direct event emission.
- **Cons**: Classic dual-write failure: if the network blips or broker is down, the DB commit succeeds but events are lost, creating data inconsistency.

### Alternative B: PostgreSQL Transactional Outbox + Relay Worker (Chosen for Core)

- Write domain entities and outbox events in the same PostgreSQL transaction (`INSERT INTO outbox ...`). A lightweight background relay worker polls `outbox` using `SELECT ... FOR UPDATE SKIP LOCKED` and publishes to subscribers or external streams.
- **Pros**: Guaranteed atomicity; zero message loss; zero external broker required for standalone/edge deployments.
- **Cons**: Minor database polling load; outbox table requires periodic partition pruning.

### Alternative C: External Message Stream (NATS JetStream) fed by Outbox

- Outbox relay dispatches events to a lightweight NATS JetStream cluster for multi-worker fanout.
- **Pros**: High-throughput distributed fanout; backpressure management.
- **Cons**: Adds NATS cluster operational overhead.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative B (Transactional Outbox)** as the core persistence guarantee, with **Alternative C (NATS JetStream)** as an optional streaming adapter for clustered deployments.

This ensures that even in single-node or air-gapped customer VPC deployments, ProofMesh guarantees 100% reliable at-least-once event delivery using standard PostgreSQL transactions without requiring external broker infrastructure.

---

## 4. Consequences & Trade-offs

### Positive Consequences

- True transactional atomicity: no ghost events or lost notifications.
- At-least-once delivery is guaranteed across crashes and network partitions.
- Simplified testing: integration tests can verify outbox table rows deterministically.

### Negative Consequences / Risks

- Outbox table must be partitioned by day and purged after successful publication to prevent table bloat.
- Event ordering is per-tenant/per-claim, not globally sequential.

---

## 5. Reconsideration Triggers

This decision will be formally reconsidered if:

1. Outbox relay polling overhead causes measurable database CPU contention (> 10% DB CPU).
2. Outbox event publication lag exceeds 1,000ms under standard peak loads.
