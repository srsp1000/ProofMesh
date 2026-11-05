# ProofMesh C4 Model: System Context (Level 1)

**Document:** `docs/architecture/c4-context.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Architecture Specification

---

## 1. System Context Diagram

The System Context diagram illustrates ProofMesh in relation to its human users, governed AI applications, model providers, and external enterprise systems.

```mermaid
C4Context
    title System Context Diagram for ProofMesh

    Person(developer, "AI Engineer / Developer", "Instruments applications with ProofMesh SDK and monitors evaluation pipelines.")
    Person(complianceOfficer, "Compliance & Risk Officer", "Audits claims, inspects evidence lineage, and resolves disputed review cases.")
    Person(auditor, "External Regulatory Auditor", "Inspects tamper-evident audit bundles and verifies cryptographic proofs.")

    System(proofmesh, "ProofMesh Platform", "Integration-first evidence-to-decision governance platform. Evaluates claims, enforces policies, and tracks lineage.")

    System_Ext(agentApp, "Governed AI Application", "Customer AI application, autonomous agent framework (LangChain, LlamaIndex), or multi-agent orchestrator.")
    System_Ext(mcpTools, "External Tool Servers (MCP)", "Databases, APIs, calculators, and services exposed via Model Context Protocol.")
    System_Ext(idp, "Enterprise Identity Provider", "OAuth 2.1 / OIDC provider (Okta, Azure AD, Auth0) issuing cryptographically signed JWTs.")
    System_Ext(otelCollector, "OpenTelemetry Collector", "Ingests and routes GenAI telemetry traces.")
    System_Ext(cloudStorage, "Enterprise Object Storage", "S3 / GCS storage for raw document evidence and exported audit bundles.")

    Rel(agentApp, proofmesh, "Streams telemetry & requests policy admission", "HTTPS / REST / WebSocket")
    Rel(agentApp, mcpTools, "Executes tool actions through", "MCP JSON-RPC (Proxied)")
    Rel(proofmesh, mcpTools, "Evaluates & gates tool access", "MCP JSON-RPC")
    Rel(otelCollector, proofmesh, "Forwards GenAI spans & traces", "OTLP / HTTP")
    Rel(developer, proofmesh, "Configures policies & monitors execution", "HTTPS / Web UI & CLI")
    Rel(complianceOfficer, proofmesh, "Attests claims & reviews dispute cases", "HTTPS / Governance Portal")
    Rel(auditor, proofmesh, "Downloads & verifies signed audit bundles", "HTTPS / Portal")
    Rel(proofmesh, idp, "Validates JWTs & user credentials", "HTTPS / JWKS")
    Rel(proofmesh, cloudStorage, "Stores immutable raw evidence & archives", "S3 API")
```

---

## 2. External System Actors & Boundaries

| Actor / External System     | Interaction Role                                                                               | Protocols & Interfaces                                  | Trust Level                                         |
| :-------------------------- | :--------------------------------------------------------------------------------------------- | :------------------------------------------------------ | :-------------------------------------------------- |
| **Governed AI Application** | Initiates claims, streams runtime traces, queries policy admission before tool execution.      | REST API (`/v1/claims`, `/v1/evidence`), SDK, WebSocket | Untrusted client (requires JWT & schema validation) |
| **OpenTelemetry Collector** | Aggregates and forwards distributed LLM spans (`gen_ai.*`).                                    | OTLP HTTP / gRPC                                        | Untrusted stream (validated at gateway)             |
| **MCP Tool Servers**        | External capabilities executed by agents under ProofMesh policy supervision.                   | JSON-RPC 2.0 over stdio or SSE/HTTP                     | Semi-trusted (monitored & gated by PEP)             |
| **Compliance Officer**      | Reviews flagged disputes, resolves review cases, and provides authoritative human attestation. | HTTPS Web Portal (React/Vite)                           | Trusted Authenticated Human                         |
| **Regulatory Auditor**      | Inspects append-only audit ledgers and verifies offline cryptographic bundles.                 | HTTPS Web Portal / Verification CLI                     | Read-only Authenticated Principal                   |
| **Enterprise IdP**          | Authenticates users and service accounts; provides token signing keys.                         | OIDC / OAuth 2.1 / JWKS                                 | Authoritative Identity Source                       |
| **Object Storage**          | Stores raw evidence blobs, source documents (PDFs), and signed bundles.                        | S3 API / Blob Storage                                   | High Durability Storage Tier                        |
