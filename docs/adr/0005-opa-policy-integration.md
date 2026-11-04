# ADR-0005: Open Policy Agent (OPA) Integration & Bundle Execution Mode

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Backend Engineer, Security Reviewer  

---

## 1. Context & Problem Statement
ProofMesh evaluates claims, evidence, and tool execution requests against enterprise governance policies authored in Rego. Synchronous gatekeeping requests (`/v1/policy/evaluate`) have a strict latency budget of **p95 < 25ms**.

The team must determine how to execute OPA policies: via an external OPA sidecar daemon over HTTP REST, or via an in-process WebAssembly (Wasm) runtime embedded in the Node.js process.

---

## 2. Alternatives Considered

### Alternative A: External OPA Sidecar Daemon (HTTP REST API)
- Deploy the standard `openpolicyagent/opa` binary as a sidecar container in Kubernetes or Docker. ProofMesh makes HTTP calls (`POST http://localhost:8181/v1/data/proofmesh/allow`).
- **Pros**: Official OPA binary; native support for OPA bundle polling and status reports.
- **Cons**: HTTP round-trip serialization and localhost socket latency adds 5–12ms per evaluation; sidecar process lifecycle must be managed alongside the application.

### Alternative B: In-Process WebAssembly (Wasm) Engine (Chosen for Synchronous PEP)
- Compile Rego policy bundles to `.wasm` files (`opa build -t wasm`). Load and execute the Wasm binary directly in-process within the Node.js runtime using `@open-policy-agent/opa-wasm`.
- **Pros**: Sub-millisecond evaluation latency (< 2ms); zero network hops; zero external daemon dependencies; fully self-contained in single container deployments.
- **Cons**: Built-in functions in Rego are limited compared to full Go OPA binary; Wasm bundle size must be managed.

### Alternative C: Hybrid (In-Process Wasm for PEP + Sidecar for Control Plane)
- In-process Wasm evaluates synchronous PEP requests; a background service polls the central Policy Bundle API to fetch new signed bundles.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative B / C: In-Process OPA WebAssembly (Wasm) Execution**.

To meet the non-negotiable p95 < 25ms SLA for synchronous policy gatekeeping, network hops must be eliminated. In-process Wasm evaluation executes in < 2ms directly in Node.js thread memory. Policy bundles are distributed as versioned, Ed25519-signed tarballs via the OPA Bundle API and hot-swapped dynamically into memory without restarting the process.

---

## 4. Consequences & Trade-offs

### Positive Consequences
- Synchronous evaluation latency is < 2ms, comfortably fulfilling the 25ms SLA.
- Reduced infrastructure footprint: no sidecar process or container port to maintain.
- Tamper-evident bundle integrity: Wasm bundles are verified cryptographically before instantiation.

### Negative Consequences / Risks
- Custom Rego built-in functions requiring system calls cannot run in Wasm (pure data/logic evaluation only).
- Memory footprint increases slightly as policy bundles grow in size.

---

## 5. Reconsideration Triggers
This decision will be formally reconsidered if:
1. Rego policy complexity requires advanced Go-only built-in functions not supported by Wasm.
2. In-memory Wasm compilation time causes noticeable latency spikes during dynamic bundle hot-reloads.
