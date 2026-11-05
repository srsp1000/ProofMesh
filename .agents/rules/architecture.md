# Architecture Rules

These rules govern architectural structure, system design boundaries, and operational semantics for ProofMesh.

## 1. Simplicity & Reuse

- **Prefer Simplest Design**: Avoid speculative abstractions, premature generic frameworks, and microservice sprawl. Choose the simplest reliable architecture that completely satisfies the requirements.
- **Strict Reuse**: Search for existing utilities and abstractions before writing new ones. Never create a parallel service or utility that duplicates existing functionality.

## 2. Separation of Concerns & Business Logic Placement

- **Domain/Application Layering**: Business rules belong exclusively in domain and application services. Controllers, transports, UI components, prompts, and SDKs must never contain duplicated business logic.
- **Explicit Interfaces**: Use clean interfaces and dependency inversion where domain logic interacts with external infrastructure.

## 3. Telemetry & Enforcement Semantics

- **Asynchronous Observation**: Telemetry collection, observation, and audit recording must be asynchronous and non-blocking by default to prevent adding latency or fragility to governed workflows.
- **Synchronous Policy Enforcement**: Synchronous blocking enforcement is permissible only for explicitly configured operations and must document explicit fail-open or fail-closed behavior.
- **Explicit Failure Modes**: External integrations, database operations, model providers, and queue consumers must declare explicit failure behavior and bounded timeouts.
