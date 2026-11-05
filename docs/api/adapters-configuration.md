# ProofMesh Protocol & Platform Adapters Configuration Guide

This document is the authoritative integration guide for configuring and operating ProofMesh Protocol and Platform Adapters implemented in Phase 5:

- **Switch Adapter** (Matrix/Switch Room Protocol v6 via persistent WebSocket & Agent Bridge)
- **REST & Webhook Adapter** (HMAC-SHA256 authenticated, replay-defended ingest)
- **OpenTelemetry Collector & Relay Adapter** (OTLP JSON traces, GenAI Semantic Conventions v1.38+, privacy redaction)
- **Adapter Health Diagnostics & Monitoring**

---

## 1. Architectural Principles

ProofMesh protocol adapters sit at the network edge behind the API Gateway. They translate platform-specific events into ProofMesh's authoritative, append-only **Canonical Event Envelopes** ([`CanonicalEventEnvelopeSchema`](file:///packages/contracts/src/events/canonical-envelope.schema.ts)) without contaminating domain services with protocol quirks.

Key Invariants:

1. **Server-Side Tenant Derivation**: Adapters never trust an unauthenticated tenant ID header. All tenant scopes are derived from cryptographic tokens or registered credentials.
2. **Deterministic Actor Identification**: External user handles (e.g., Switch MXIDs or Webhook sources) are deterministically mapped to RFC 4122 UUIDs for authoritative lineage tracking.
3. **Observation vs. Causality**: Telemetry events (traces, spans, observed room messages) are labeled `captureMethod: 'captured'`. Telemetry traces **never** infer declared claim dependencies (Domain Rule 5).
4. **Privacy by Default**: Prompt and completion contents are stripped or redacted by default (`metadata_only`). Ingestion of full model prompts requires explicit tenant opt-in (`allowContentCapture: true`).

```
 +-----------------------------------------------------------------------------------+
 |                             EXTERNAL ECOSYSTEMS                                   |
 |                                                                                   |
 |  +-----------------------+  +------------------------+  +----------------------+  |
 |  |     Switch Rooms      |  |  Git / CI / Webhooks   |  | OpenTelemetry / LLM  |  |
 |  |    (Protocol v6 WS)   |  |     (HMAC-SHA256)      |  |   (OTLP JSON Traces) |  |
 |  +-----------+-----------+  +-----------+------------+  +----------+-----------+  |
 +--------------|--------------------------|--------------------------|--------------+
                | Persistent WS            | Signed POST              | OTLP HTTP
                v                          v                          v
 +-----------------------------------------------------------------------------------+
 |                        PROOFMESH ADAPTER LAYER (apps/api)                         |
 |                                                                                   |
 |  +-----------------------+  +------------------------+  +----------------------+  |
 |  |     SwitchAdapter     |  |     WebhookAdapter     |  | OpenTelemetryAdapter |  |
 |  |  - Ping/Pong Liveness |  |  - Constant-time HMAC  |  |  - GenAI SemConv 1.38|  |
 |  |  - Cursor & Gaps      |  |  - Skew < 300s Replay  |  |  - Metadata Privacy  |  |
 |  |  - Unaddressed Filter |  |  - Schema Validation   |  |  - Coverage Gap Rep  |  |
 |  +-----------+-----------+  +-----------+------------+  +----------+-----------+  |
 |              |                          |                          |              |
 |              +--------------------------+--------------------------+              |
 |                                         | Canonical Envelopes                     |
 |                                         v                                         |
 |                         +-------------------------------+                         |
 |                         |     AdapterHealthService      |                         |
 |                         |   (Metrics, Lag, Diagnostics) |                         |
 |                         +---------------+---------------+                         |
 |                                         |                                         |
 +-----------------------------------------|-----------------------------------------+
                                           v
 +-----------------------------------------------------------------------------------+
 |                       TRANSACTIONAL INBOX (packages/db)                           |
 |      (PostgreSQL RLS, Deduplication by Idempotency Key, Priority Lanes)           |
 +-----------------------------------------------------------------------------------+
```

---

## 2. Switch Adapter Integration

### 2.1 Overview & Protocol Alignment

ProofMesh integrates with Switch Rooms via the official **Agent Protocol v6** (Agent Bridge WebSocket). The older Server-Sent Events (SSE) interface is deprecated and not used.

Endpoints:

- **Registration**: `POST /v1/gateway/adapters/switch/register`
- **Inbound Event Stream**: `POST /v1/gateway/adapters/switch/events` (used by local bridge or persistent server WebSocket listener)
- **Outbound Review/Remediation Messages**: `POST /v1/gateway/adapters/switch/messages`

### 2.2 Agent Registration & Secret Management

Agents register once per tenant workspace. ProofMesh generates a high-entropy agent API key (`sw_live_...`) and stores it securely using `EnvelopeSecretManager` (`enc://v1/...`). The plaintext key is **never** returned to the browser or frontend client.

#### Registration Request Example

```http
POST /v1/gateway/adapters/switch/register HTTP/1.1
Host: api.proofmesh.local
Authorization: Bearer <JWT_TENANT_ADMIN>
Content-Type: application/json

{
  "name": "proofmesh-compliance-watcher",
  "description": "Watches Switch rooms for authoritative claims and audit statements",
  "connector_type": "switch_v6_agent",
  "integration_profile": {
    "connection_model": "always_on",
    "supported_events": ["message", "command", "room_join"],
    "capabilities": ["room_observation", "action_execution"],
    "message_exchange": true
  }
}
```

#### Registration Response (No Secret Leakage)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "proofmesh-compliance-watcher",
  "status": "registered",
  "connectionId": "7b8e192a-8c90-4e12-b98a-2e6f43e59001",
  "storedSecurely": true
}
```

### 2.3 WebSocket Frame Handling & State Machine

The Switch Adapter maintains connection state across network interruptions:

1. **Liveness Heartbeat (Ping/Pong)**:
   - Switch server sends `{"type": "ping"}` every 2 seconds.
   - ProofMesh answers immediately with `{"type": "pong", "cursor": <sequence_number>}`.
   - If pong is not received within 6 seconds, the connection is evicted (`heartbeat_lapsed`, recoverable on reconnect).
2. **Gap Frames (`gap`)**:
   - If the client reconnects with an old cursor, Switch emits `{"type": "gap", "from_sequence": 100, "resumed_at": 250}`.
   - The adapter resets its cursor to `resumed_at` and records that historical room catch-up is required.
3. **Eviction Codes (`evicted`)**:
   - `taken_over`: Another connection opened with the same agent/connection ID. The adapter permanently halts reconnection attempts to avoid a split-brain loop.
   - `heartbeat_lapsed` / `idle`: Recoverable eviction. The adapter performs exponential backoff reconnection.
4. **Room Observation vs. Response Filter**:
   - Unaddressed messages (`payload.addressed: false`) are captured for compliance observation if the room configuration permits.
   - Addressed messages (`payload.addressed: true` or `@mention`) mark `actionRequired: true`, notifying the agent to evaluate a response.
5. **Deduplication**:
   - All inbound messages are deduplicated using `message_id` within an LRU cache (10,000 capacity) and the database `idempotencyKey` (`switch_<room_id>_<message_id>`).

### 2.4 Posting Review Cases & Remediations Back to Switch

ProofMesh posts formatted markdown summaries back to human reviewers in Switch rooms:

```http
POST /v1/gateway/adapters/switch/messages HTTP/1.1
Host: api.proofmesh.local
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "kind": "review_case",
  "room_id": "!room123:server.switch",
  "review_case_id": "c1f7a012-3456-4abc-8def-0123456789ab",
  "title": "KYC Identity Discrepancy",
  "summary": "Applicant name on passport does not match tax filing record.",
  "claim_statement": "Applicant identity verified by Agent KYC-9.",
  "decision_policy": "policy_high_risk_onboarding_v2",
  "required_role": "compliance_officer"
}
```

---

## 3. REST & Webhook Adapter Integration

### 3.1 Overview

The Webhook Adapter accepts HTTP POST payloads from third-party services (GitHub, Slack, GitLab, CI/CD runners, and custom agent frameworks).

Endpoint: `POST /v1/gateway/adapters/webhooks/:source`

Supported sources: `generic_hmac`, `github`, `slack`, `custom_agent`.

### 3.2 Cryptographic Security Requirements

1. **HMAC-SHA256 Signature**:
   - Delivered via `X-ProofMesh-Signature` or `X-Hub-Signature-256`.
   - Format: `sha256=<hex_digest>` or `t=<timestamp>,v1=<hex_digest>`.
   - ProofMesh supports both payload-bound HMAC (`crypto.createHmac('sha256', secret).update(timestamp + '.' + rawPayload)`) and standalone raw payload HMAC with timestamp replay verification.
   - Signature verification is strictly **constant-time** (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
2. **Timestamp Skew Tolerance**:
   - Delivered via `X-ProofMesh-Timestamp`.
   - Unix epoch milliseconds, seconds, or ISO-8601 string.
   - Max allowed clock skew: **300 seconds (5 minutes)**. Timestamps older than 300 seconds are rejected with `401 Unauthorized` (`EXPIRED_TIMESTAMP`).
3. **Idempotency & Correlation**:
   - `Idempotency-Key` prevents duplicate webhook processing.
   - `X-Correlation-Id` is echoed in all response headers.

#### Example Webhook Request (GitHub Push Artifact)

```http
POST /v1/gateway/adapters/webhooks/github HTTP/1.1
Host: api.proofmesh.local
X-Tenant-Id: 550e8400-e29b-41d4-a716-446655440000
X-ProofMesh-Signature: sha256=d5e82b7c62c3e4f...
X-ProofMesh-Timestamp: 1730793600000
Idempotency-Key: idemp_gh_commit_9921
Content-Type: application/json

{
  "eventType": "io.proofmesh.source.artifact.registered.v1",
  "source": "github_actions",
  "occurredAt": "2026-11-05T12:00:00.000Z",
  "data": {
    "artifactId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "artifactVersion": 1,
    "uri": "https://github.com/proofmesh/core/commit/c0ffee123456",
    "mimeType": "application/json",
    "contentHash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "byteSize": 1024,
    "action": "registered"
  }
}
```

---

## 4. OpenTelemetry Adapter & Collector Relay

### 4.1 Overview & GenAI Semantic Conventions

ProofMesh exposes a standard OTLP JSON HTTP receiver:

- **Endpoint**: `POST /v1/gateway/adapters/opentelemetry/v1/traces`
- **Specification**: OTLP HTTP v1.38+ with OpenTelemetry GenAI Semantic Conventions and OpenInference standards.

### 4.2 Semantic Attribute Mapping Matrix

The adapter normalizes both OTLP KeyValue array formats and standard key-value maps:

| OpenTelemetry Attribute     | Target Event Family                       | Target Field                   | Redacted in `metadata_only` |
| :-------------------------- | :---------------------------------------- | :----------------------------- | :-------------------------- |
| `gen_ai.system`             | `io.proofmesh.agent.activity.v1`          | Identifies LLM runtime         | No                          |
| `gen_ai.request.model`      | `io.proofmesh.telemetry.span.received.v1` | `attributes.model`             | No                          |
| `gen_ai.prompt`             | `io.proofmesh.telemetry.span.received.v1` | `attributes.gen_ai.prompt`     | **Yes (Stripped)**          |
| `gen_ai.completion`         | `io.proofmesh.telemetry.span.received.v1` | `attributes.gen_ai.completion` | **Yes (Stripped)**          |
| `gen_ai.usage.total_tokens` | `io.proofmesh.telemetry.span.received.v1` | Token count                    | No                          |
| `gen_ai.tool.name`          | `io.proofmesh.agent.activity.v1`          | `toolName` (`tool_call`)       | No                          |
| `gen_ai.tool.input`         | `io.proofmesh.agent.activity.v1`          | `toolParameters`               | **Yes (Stripped)**          |
| `proofmesh.workflow_id`     | Envelope governance header                | `workflowId`                   | No                          |
| `proofmesh.decision_id`     | Envelope governance header                | `causationId`                  | No                          |
| `proofmesh.claim_id`        | Canonical envelope metadata               | Correlation link               | No                          |

### 4.3 OpenTelemetry Collector Dual-Export Configuration

To dual-export traces from your existing OpenTelemetry pipeline to ProofMesh, configure an OTLP HTTP exporter in `otel-collector-config.yaml`:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 256
  memory_limiter:
    check_interval: 1s
    limit_percentage: 75
    spike_limit_percentage: 20

exporters:
  # Existing Observability Backend (e.g. Jaeger / Datadog / Honeycomb)
  otlp/primary:
    endpoint: jaeger:4317
    tls:
      insecure: true

  # ProofMesh Governance Gateway
  otlphttp/proofmesh:
    endpoint: https://api.proofmesh.local/v1/gateway/adapters/opentelemetry
    headers:
      Authorization: 'Bearer ${PROOFMESH_SERVICE_TOKEN}'
      X-Tenant-Id: '${PROOFMESH_TENANT_ID}'
    encoding: json
    compression: gzip
    timeout: 5s

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/primary, otlphttp/proofmesh]
```

### 4.4 Instrumentation Coverage Gap Reporting

The OpenTelemetry Adapter surfaces missing attributes to detect governance blind spots via `InstrumentationCoverageGapReport`:

```json
{
  "traceId": "4bfb101ba4ee64ced6547f404e123456",
  "missingRequired": [],
  "missingRecommended": [
    "gen_ai.request.model",
    "gen_ai.usage.total_tokens",
    "proofmesh.workflow_id"
  ],
  "coverageScore": 0.65,
  "recommendations": [
    "Instrument LLM call with gen_ai.request.model and token usage attributes.",
    "Inject 'proofmesh.workflow_id' span attribute to establish causal evidence lineage."
  ]
}
```

---

## 5. Adapter Health Diagnostics & Monitoring

### 5.1 Endpoints

- **Aggregated Health**: `GET /v1/gateway/adapters/health`
- **Single Adapter Health**: `GET /v1/gateway/adapters/:adapterId/health`

### 5.2 Response Schema & Metrics

```json
{
  "adapterId": "switch_proofmesh-compliance-watcher",
  "protocol": "switch",
  "status": "connected",
  "lastEventReceivedAt": "2026-11-05T12:05:00.123Z",
  "currentCursor": 1054,
  "queueLag": 0,
  "metrics": {
    "totalEventsReceived": 8940,
    "totalEventsRejected": 2,
    "schemaIncompatibilities": 0,
    "droppedEvents": 0,
    "permissionErrors": 0
  },
  "healthMessage": "Operating normally"
}
```

---

## 6. Security & Operational Checklist

- [x] Agent registration API keys stored in `SecretManager` as encrypted references (`enc://v1/...`), never returned in plaintext.
- [x] Webhook signatures verified in constant-time with timing-safe comparisons.
- [x] Webhook timestamp skew verified (< 300s) to neutralize replay attacks.
- [x] Maximum payload size enforced (`413 Payload Too Large`) before parsing large trace batches.
- [x] Cross-tenant injection prevented by deriving tenant scope from server-validated tokens.
- [x] Spans and observed messages stamped with `captureMethod: 'captured'` (zero inferred dependencies).
- [x] Prompts and model completions stripped by default (`metadata_only`).
