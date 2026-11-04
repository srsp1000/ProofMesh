# Data Integrity Rules

These rules govern data durability, audit trails, event ingestion idempotency, and causality modeling for ProofMesh.

## 1. Historical Immutability
- **Preserve Full Version History**: Historical claims, evidence, decisions, evaluation runs, and audit entries must never be overwritten, modified, or destructively purged.
- **Append-Only Ledgers**: System state transitions must be modeled as append-only records or versioned ledgers. Updates create new versions while preserving immutable references to prior states.
- **Audit Traceability**: Every state modification must record an audit entry capturing timestamp, initiating identity/service, and cryptographic digest of the transition.

## 2. Event Ingestion Idempotency
- **At-Least-Once Delivery Resilience**: Assume all event ingestion, webhooks, and asynchronous message queues operate on at-least-once delivery semantics.
- **Deduplication & Idempotency Keys**: All ingestion pipelines and external side effects must require and enforce idempotency keys to ensure replay safety and prevent duplicate processing.

## 3. Telemetry & Causality Distinction
- **No False Causality Claims**: Telemetry and observation do not prove decision causality.
- **Relationship Categorization**: Data schemas, APIs, and UI representations must strictly maintain and expose explicit relationship categories:
  - **`captured`**: Observed directly from system telemetry or raw execution traces.
  - **`declared`**: Explicitly stated in static configuration or code manifests.
  - **`attested`**: Cryptographically signed or verified by an authorized human or service identity.
  - **`inferred`**: Deduced via heuristic, model analysis, or probabilistic linkage.
  - **`unknown`**: Relationship is ambiguous or unverified.
- Never collapse or report inferred or unknown relationships as proven causal facts.
