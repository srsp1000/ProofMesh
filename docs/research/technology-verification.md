# Technology Stack Verification & External Research

**Document:** `docs/research/technology-verification.md`  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Complete

---

## 1. Research Objectives & Methodology

In accordance with ProofMesh Operating Rule 3 (_"verify current official documentation and compatibility with the repository runtime; record exact version and source"_), this document evaluates the technical feasibility, compatibility, security posture, and licensing of prospective architectural dependencies.

---

## 2. Technology Verification Matrix

### 2.1 Antigravity Customization Architecture (Rules, Skills, Subagents, Worktrees)

- **Official Source**: Antigravity System Specifications (`~/.gemini/antigravity/builtin/skills/agy-customizations/`, `https://antigravity.google/docs`)
- **Version / Date**: Antigravity 2.0 (Verified 2026-11)
- **Verified Capabilities**:
  - **Hierarchical Discovery**: Customizations automatically discovered by traversing up to the git root (`.git`), scanning `.agents/agents/`, `.agents/skills/`, and `.agents/rules/`.
  - **Progressive Disclosure**: Skills and conditional rules are loaded on demand via name/description metadata; only `always_on` rules load unconditionally into the 20,000-token rules budget.
  - **Subagent Declaration**: Custom subagents defined via YAML frontmatter (`name`, `description`, `tools`, `model`, `workspace`, `skills`, `hidden: false`). Subagents loaded dynamically into the execution registry.
  - **Worktree Isolation**: Subagent parameter `Workspace: "branch"` enables isolated Git worktrees, preventing concurrent agents from corrupting shared branches or modifying shared contracts simultaneously.
- **Limitations & Implications**: Subagents cannot share in-memory state; all inter-agent communication must flow through the central Lead Architect via `send_message`.

---

### 2.2 Host Runtime & Core Frameworks (Node.js, TypeScript, NestJS, React, Vite)

- **Official Sources**:
  - Node.js Documentation (`https://nodejs.org/docs/`) - Node.js `v26.3.0`
  - TypeScript Documentation (`https://www.typescriptlang.org/docs/`) - TypeScript `5.6.3`
  - NestJS Official Docs (`https://docs.nestjs.com/`) - NestJS `v11.x`
  - Vite Documentation (`https://vitejs.dev/`) - Vite `v6.x` / React `19.x`
- **Verified Capabilities**:
  - **Node.js v26.3.0 & ESM**: Node 26 provides native ESM support, built-in test runner (`node:test`), and native WebSocket support.
  - **NestJS v11**: Compatible with Node 22/24/26 LTS lines, native SWC compilation, first-class ESM, and standard modular architecture.
  - **React 19 & Vite 6**: Vite 6 supports React 19 out of the box via `@vitejs/plugin-react`.
- **Limitations & Implications**: Bleeding-edge Node v26 may trigger peer dependency warnings with legacy npm packages. The project should use `pnpm` with explicit package overrides or pinned versions.

---

### 2.3 OpenTelemetry GenAI Semantic Conventions

- **Official Source**: OpenTelemetry Semantic Conventions for Generative AI (`https://github.com/open-telemetry/semantic-conventions-genai`, `https://opentelemetry.io/docs/specs/semconv/gen-ai/`)
- **Version / Date**: Specifications Version 2024–2026 (Migrated to dedicated repository)
- **Verified Capabilities**:
  - **Attribute Standards**: Standardized spans and metrics for AI operations (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`).
  - **Token Usage Metrics**: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`.
  - **Tool & Agent Spans**: Spans specifically track tool execution, agent step loops, and Model Context Protocol (MCP) interactions.
- **Evolutionary Shift**: `gen_ai.system` has been officially deprecated and superseded by `gen_ai.provider.name`.
- **Limitations & Implications**: The GenAI conventions remain in "Development" / experimental stability. Telemetry ingestion in ProofMesh must map incoming GenAI traces flexibly, shielding core domain schemas from minor upstream naming shifts.

---

### 2.4 Model Context Protocol (MCP) Specification & Security

- **Official Source**: Model Context Protocol Specification (`https://modelcontextprotocol.io/specification`, Anthropic / Open Source MCP Working Group)
- **Version / Date**: Specification Spec 2024-11 / 2026 Stable
- **Verified Capabilities**:
  - **JSON-RPC 2.0 Transport**: Supports both `stdio` (local subprocesses) and `SSE` / `HTTP` (remote servers).
  - **Core Primitives**: Resources (data/files), Prompts (templated workflows), and Tools (executable operations).
  - **Authorization**: Built on OAuth 2.1 (IETF draft), RFC 8414 (Server Metadata), and RFC 7591 (Dynamic Client Registration) for HTTP endpoints.
- **Security Guidance & Threat Models**:
  - **Confused Deputy Problem**: MCP proxy servers must not share static OAuth client credentials across untrusted clients.
  - **Prompt Injection Defense**: Tools and resource annotations must be treated as untrusted; applications must require explicit human confirmation for sensitive tool operations.
  - **Least Privilege**: Servers must define explicit, granular tool allowlists.
- **Limitations & Implications**: The MCP specification explicitly states that wire protocols cannot enforce security policies alone; ProofMesh must enforce runtime authorization, schema parsing, and policy admission at the boundary.

---

### 2.5 Agent Client Protocol (ACP) & Agent-to-Agent (A2A) Reconnect Semantics

- **Official Source**: Agent Client Protocol Specification (`https://agentclientprotocol.com/spec`), Linux Foundation / Open Agent Standards
- **Version / Date**: 2024–2026 Standard Drafts
- **Verified Capabilities**:
  - **Session Resume**: Explicit `session/resume` protocol verb allowing clients to reconnect across broken WebSockets/SSE connections without losing task state.
  - **State Snapshots**: Successful reconnection returns a complete state snapshot rather than empty acknowledgments, eliminating race conditions during reconnect windows.
  - **Authentication Re-Handshake**: Stale credentials trigger standard `-32000` / `auth_required` JSON-RPC errors, requiring clean token refresh before resume.
- **Limitations & Implications**: ProofMesh event collection must treat connection drops as normal occurrences and provide idempotent event catch-up endpoints.

---

### 2.6 NATS JetStream vs. Temporal Evaluation

- **Official Sources**:
  - NATS.io Documentation (`https://docs.nats.io/nats-concepts/jetstream`)
  - Temporal.io Documentation (`https://docs.temporal.io/`)
- **Architectural Comparison**:

| Evaluation Criterion        | NATS JetStream                                      | Temporal                                                                   |
| :-------------------------- | :-------------------------------------------------- | :------------------------------------------------------------------------- |
| **Primary Domain**          | High-throughput, low-latency streaming & pub/sub    | Stateful workflow orchestration & durable state machines                   |
| **Footprint / Binary**      | Ultra-lightweight (<20MB Go binary, low CPU/RAM)    | Heavy cluster (Frontend, History, Matching, Worker) + PostgreSQL/Cassandra |
| **Operational TCO**         | Low infrastructure cost, zero external dependencies | High infrastructure & DB IOPS cost; specialized cluster maintenance        |
| **State Machine Support**   | DIY (Requires custom sagas, retries, deduplication) | Native (Deterministic replay, timers, long-running durability)             |
| **Suited For in ProofMesh** | **Telemetry ingestion stream & event bus**          | **Complex multi-day human approval & governance workflows**                |

- **Recommendation**:
  - ProofMesh Phase 1–2 should adopt **NATS JetStream** (or PostgreSQL LISTEN/NOTIFY with table queues) for lightweight event streaming.
  - Avoid deploying Temporal during early phases to prevent premature infrastructure complexity (Rule 4: _"prefer the simplest reliable design; avoid needless microservices"_).

---

### 2.7 Open Policy Agent (OPA) Integration & Bundle Lifecycle

- **Official Source**: Open Policy Agent Documentation (`https://www.openpolicyagent.org/docs/latest/management-bundles/`)
- **Version / Date**: OPA v0.68+ / v1.0
- **Verified Capabilities**:
  - **Bundle Distribution**: OPA downloads policies (`.rego`) and static data (`.json`) as gzipped tarballs (`.tar.gz`) from an HTTP bundle service.
  - **Dynamic Hot-Reloading**: OPA polls bundle servers, compiles, verifies cryptographic signatures, and activates policies in-memory without restarting.
  - **Immutability Guarantee**: Policies loaded via bundles are read-only at the node level; local REST APIs cannot tamper with or mutate centrally distributed bundles.
  - **Deterministic Decision Output**: Pure input-to-output evaluation with zero side effects.
- **Limitations & Implications**: OPA policies execute in-memory; large external data sets must either be pushed into bundles or queried via external data fetch plugins. ProofMesh policy bundles must be versioned and signed.

---

### 2.8 Security Standards: OWASP ASVS, OWASP Agentic Top 10, NIST SSDF, SLSA

- **Official Sources**:
  - OWASP Top 10 for Agentic Applications & LLM Top 10 (`https://owasp.org/www-project-top-10-for-large-language-model-applications/`)
  - OWASP Application Security Verification Standard (ASVS v4.0.3)
  - NIST SP 800-218 (Secure Software Development Framework)
  - SLSA Specification v1.0 (`https://slsa.dev/spec/v1.0/`)
- **Verified Controls**:
  - **OWASP Agentic Security**:
    - _ASI01: Agent Goal Hijack_ (Prevent prompt manipulation from overriding system goals).
    - _ASI02: Tool Misuse_ (Sanitize inputs to tools; enforce strict parameter schemas).
    - _ASI03: Excessive Agency & Privilege Abuse_ (Never grant autonomous tools authoritative write access to system governance).
  - **OWASP ASVS**: Governs API authentication, session tokens, tenant scoping, and parameter validation.
  - **NIST SSDF & SLSA**: Mandates software bills of materials (SBOM), tamper-evident audit trails, and cryptographically verified build pipelines.
- **Architectural Implementation**: ProofMesh must enforce deterministic application service boundaries between LLM reasoning and system state changes.

---

### 2.9 Document Processing Libraries (PDF & Text Extraction)

- **Official Sources**: Mozilla PDF.js Repository, UnJS/unpdf (`https://github.com/unjs/unpdf`), npm package registries
- **Comparative Analysis**:

| Library          | Engine                  | License    | Native Dependencies      | Security & Serverless Posture                                                                        |
| :--------------- | :---------------------- | :--------- | :----------------------- | :--------------------------------------------------------------------------------------------------- |
| **`unpdf`**      | Modern PDF.js build     | **MIT**    | Zero native dependencies | High; optimized for Node/serverless; no native canvas compilation                                    |
| **`pdf-parse`**  | Legacy PDF.js wrapper   | Apache-2.0 | Often binds `canvas`     | Prone to build failures on serverless; older transitive dependencies                                 |
| **`pdfjs-dist`** | Upstream Mozilla PDF.js | Apache-2.0 | Requires DOM polyfills   | Powerful but requires manual worker configuration; affected by CVE-2024-4367 if unpatched (<v4.2.67) |

- **Recommendation**: Adopt **`unpdf`** for server-side evidence document extraction. It provides an MIT license, zero native compilation overhead, and regular security updates.
