# ProofMesh Ecosystem & Platform Supported Versions Matrix

This document provides the authoritative runtime, protocol, and external framework compatibility matrix for ProofMesh Phase 5 and downstream governance integrations.

---

## 1. Core Runtime & Infrastructure Dependencies

| Component      | Minimum Version | Validated Version | Status     | Notes & Compatibility Constraints                              |
| :------------- | :-------------- | :---------------- | :--------- | :------------------------------------------------------------- |
| **Node.js**    | `>= 22.0.0`     | `v22.20.5`        | **Active** | LTS runtime; requires native `node:crypto` timing-safe APIs.   |
| **TypeScript** | `>= 5.5.0`      | `v5.5.4`          | **Active** | Strict mode enabled across all workspace packages.             |
| **pnpm**       | `>= 9.0.0`      | `v9.12.3`         | **Active** | Monorepo workspace orchestration with committed lockfile.      |
| **PostgreSQL** | `>= 16.0`       | `16-alpine`       | **Active** | Row-Level Security (`FORCE RLS`), JSONB, transactional outbox. |
| **Vitest**     | `>= 2.0.0`      | `v2.1.9`          | **Active** | Unit, contract, integration, and security test harnesses.      |
| **Zod**        | `>= 3.23.0`     | `v3.25.76`        | **Active** | Strict runtime contract schema validation.                     |

---

## 2. Switch Agent Protocol Compatibility Matrix

ProofMesh interfaces with Switch Rooms through the official Agent Bridge protocol.

| Protocol Version   | Connection Transport | Liveness Heartbeat | Gap / Resumption | Support Status  | Implementation Details                                                                                                                                     |
| :----------------- | :------------------- | :----------------- | :--------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Protocol v6**    | Persistent WebSocket | `ping` / `pong` 2s | `gap` frame      | **Recommended** | Fully supported in [`SwitchAdapter`](file:///apps/api/src/gateway/adapters/switch.adapter.ts). Handles eviction codes `taken_over` and `heartbeat_lapsed`. |
| **Protocol v5**    | Persistent WebSocket | Ping frame         | Resend cursor    | **Compatible**  | Compatible via backward compatibility envelope mapping.                                                                                                    |
| **Protocol v4**    | WebSocket / HTTP     | Periodic polling   | Manual replay    | **Deprecated**  | Legacy client protocol; upgrade to v6 recommended.                                                                                                         |
| **Protocol v1-v3** | Server-Sent Events   | Keepalive comment  | Re-connect only  | **Unsupported** | Deprecated SSE streaming protocol; rejected by gateway.                                                                                                    |

### Protocol v6 Connection Lifecycle Specification

```
Switch Server                                            ProofMesh SwitchAdapter
      |                                                             |
      | ------ WS Connect (/agents/{id}/connection/ws) -----------> |
      | <----- 101 Switching Protocols ---------------------------- |
      |                                                             |
      | ------ {"type": "connection_state", cursor: 500} ---------> |
      |                                                             | (Persists cursor 500)
      | ------ {"type": "ping"} (every 2s) -----------------------> |
      | <----- {"type": "pong", "cursor": 500} -------------------- | (Liveness verified)
      |                                                             |
      | ------ {"event": "message", sequence: 501, payload} ------> |
      |                                                             | (Translates to Canonical
      |                                                             |  MessageObservedV1 envelope)
      |                                                             | (Persists cursor 501)
      |                                                             |
   [Network Glitch / Reconnect]
      |                                                             |
      | ------ WS Reconnect (last cursor: 501) -------------------> |
      | ------ {"type": "gap", from_seq: 501, resumed_at: 550} ---> |
      |                                                             | (Updates cursor to 550,
      |                                                             |  requests room catch-up)
```

---

## 3. OpenTelemetry & Semantic Conventions Compatibility

| Standard / Specification            | Specification Version | Supported Features                                         | ProofMesh Target Event Family             |
| :---------------------------------- | :-------------------- | :--------------------------------------------------------- | :---------------------------------------- |
| **OTLP HTTP / JSON**                | `v1.38+`              | ResourceSpans, ScopeSpans, Span, Events, Status            | `io.proofmesh.telemetry.span.received.v1` |
| **OpenTelemetry GenAI SemConv**     | `v1.38+`              | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`  | `io.proofmesh.telemetry.span.received.v1` |
| **OpenTelemetry Agent Invocations** | Experimental (v1.38+) | `gen_ai.tool.name`, `gen_ai.tool.input`, `gen_ai.agent.id` | `io.proofmesh.agent.activity.v1`          |
| **OpenInference (Arize / Phoenix)** | `v0.1.x` - `v0.5.x`   | `openinference.span.kind`, `input.value`, `output.value`   | `io.proofmesh.agent.activity.v1`          |
| **ProofMesh Trace Extensions**      | `v1.0.0`              | `proofmesh.workflow_id`, `proofmesh.decision_id`           | Stamped into CloudEvents envelope         |

### Privacy Redaction Constraints

By default, ProofMesh applies **`metadata_only`** privacy filtering to all incoming OpenTelemetry spans:

- `gen_ai.prompt` is deleted from attributes unless `allowContentCapture: true`.
- `gen_ai.completion` is deleted from attributes unless `allowContentCapture: true`.
- `gen_ai.tool.input` and `gen_ai.tool.output` are deleted from attributes unless `allowContentCapture: true`.
- Spans are marked with `captureMethod: 'captured'`. Telemetry **never** infers declared dependencies.

---

## 4. Webhook Platforms & Cryptographic Algorithms

| Webhook Source   | Signature Header        | Algorithm           | Replay Window | Support Status |
| :--------------- | :---------------------- | :------------------ | :------------ | :------------- |
| **Generic HMAC** | `X-ProofMesh-Signature` | HMAC-SHA256         | 300 seconds   | **Active**     |
| **GitHub**       | `X-Hub-Signature-256`   | HMAC-SHA256         | 300 seconds   | **Active**     |
| **Slack**        | `X-Slack-Signature`     | HMAC-SHA256 (`v0=`) | 300 seconds   | **Active**     |
| **Custom Agent** | `X-ProofMesh-Signature` | HMAC-SHA256         | 300 seconds   | **Active**     |

---

## 5. Developer SDKs, MCP & Framework Instrumentation (Phase 6)

| Ecosystem / Component      | Minimum Version | Validated Version  | Status     | Capabilities & Constraints                                                   |
| :------------------------- | :-------------- | :----------------- | :--------- | :--------------------------------------------------------------------------- |
| **TypeScript SDK**         | Node `>= 20.0`  | Node `v22.20.5`    | **Active** | `@proofmesh/sdk`: `AsyncLocalStorage`, retries, telemetry buffer.            |
| **Python SDK**             | Python `>=3.10` | Python `3.11.8`    | **Active** | `proofmesh`: `contextvars`, Pydantic v2, sync/async HTTPX, zero drift.       |
| **Model Context Protocol** | `2024-11-05`    | `2024-11-05`       | **Active** | `@proofmesh/mcp-server`: stdio & HTTP/SSE, 7 narrow governance tools.        |
| **LangChain (TypeScript)** | `>= 0.2.0`      | `v0.2.x` / `0.3.x` | **Active** | `ProofMeshLangChainCallback`: chain, tool, LLM hooks (`captured`).           |
| **LangChain (Python)**     | `>= 0.2.0`      | `v0.2.x` / `0.3.x` | **Active** | `ProofMeshLangChainCallbackHandler`: on_chain, on_tool, on_llm (`captured`). |

### Strict Security Invariants in SDK & MCP

1. **Telemetry vs. Semantic Declarations**: Automatic telemetry spans from LangChain or decorators are strictly stamped `captureMethod: 'captured'`. Explicit assertions via SDK or MCP are stamped `captureMethod: 'declared'`.
2. **Authoritative State Protection (Core Rule 2)**: LLMs and MCP clients cannot self-attest claims or directly transition status to `attested`. All authoritative transitions require human principal verification.

---

## 6. Deprecation & Sunset Policies

1. **Protocol Deprecation Notice**: Any supported protocol version deprecated by its upstream maintainer will enter ProofMesh `sunset` tracking for at least 6 months before de-registration.
2. **Backward Compatibility**: ProofMesh will maintain canonical envelope compatibility across schema major versions. If an external adapter format changes, a new adapter transformer will map to the stable canonical event family.
