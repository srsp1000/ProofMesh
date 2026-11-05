# ProofMesh Event Contracts & Envelope Specification

**Document:** `docs/api/event-contracts.md`  
**Version:** 1.1.0-GA  
**Date:** 2026-11-05  
**Author:** Lead Software Architect and Integration Engineer  
**Status:** Phase 4 Implemented & Verified

---

## 1. Overview & CloudEvents 1.0 Alignment

All asynchronous domain events, outbox messages, and telemetry spans ingested into the ProofMesh Integration Gateway adhere to the **Canonical Event Envelope** compliant with the **CNCF CloudEvents v1.0** specification.

### Core Architectural Guarantees

- **Zero Trust Tenant Derivation**: Every event envelope contains an immutable `tenantId` attribute derived exclusively from authenticated server context (JWT / API key). Client-supplied tenant overrides are strictly rejected.
- **At-Least-Once Delivery & Duplicate Safety**: Consumers must assume events can be delivered multiple times. Idempotency is enforced through `idempotencyKey` and `id` in the transactional inbox.
- **Causality & Tracing**: Every event includes `correlationId`, `causationId`, and optional OpenTelemetry `traceId` and `spanId` to track distributed causal execution trees.
- **Privacy by Default**: Ingestion defaults to `contentMode: 'metadata_only'`. Raw prompts, tool inputs, and outputs are sanitized or referenced securely.
- **Traffic Lane Segregation**: Governance events (approvals, reviews, decisions) are routed to the `high_priority` lane, preventing bulk telemetry from starving critical compliance workflows.

---

## 2. Canonical Event Envelope Schema

Implemented in [`CanonicalEventEnvelopeSchema`](file:///packages/contracts/src/events/canonical-envelope.schema.ts):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/event-envelope.json",
  "title": "ProofMeshCanonicalEventEnvelope",
  "type": "object",
  "required": [
    "specversion",
    "id",
    "source",
    "type",
    "time",
    "datacontenttype",
    "tenantId",
    "schemaVersion",
    "sourceIntegration",
    "instanceIdentity",
    "actor",
    "occurredAt",
    "receivedAt",
    "correlationId",
    "captureMethod",
    "contentMode",
    "idempotencyKey",
    "data"
  ],
  "properties": {
    "specversion": { "type": "string", "const": "1.0" },
    "id": { "type": "string", "format": "uuid" },
    "source": { "type": "string" },
    "type": { "type": "string", "pattern": "^io\\.proofmesh\\.[a-z0-9_.-]+\\.v[1-9][0-9]*$" },
    "time": { "type": "string", "format": "date-time" },
    "datacontenttype": { "type": "string", "const": "application/json" },
    "tenantId": { "type": "string", "format": "uuid" },
    "workspaceId": { "type": "string", "format": "uuid" },
    "projectId": { "type": "string", "format": "uuid" },
    "schemaVersion": { "type": "string", "example": "1.0.0" },
    "sourceIntegration": { "type": "string", "example": "opentelemetry" },
    "instanceIdentity": { "type": "string", "example": "otel_collector_01" },
    "actor": {
      "type": "object",
      "required": ["principalId", "principalType"],
      "properties": {
        "principalId": { "type": "string", "format": "uuid" },
        "principalType": {
          "type": "string",
          "enum": ["human_user", "service_account", "agent_identity"]
        }
      }
    },
    "occurredAt": { "type": "string", "format": "date-time" },
    "receivedAt": { "type": "string", "format": "date-time" },
    "correlationId": { "type": "string", "format": "uuid" },
    "causationId": { "type": "string", "format": "uuid" },
    "traceId": { "type": "string" },
    "spanId": { "type": "string" },
    "workflowId": { "type": "string" },
    "captureMethod": {
      "type": "string",
      "enum": ["captured", "declared", "attested", "inferred", "unknown"]
    },
    "contentMode": {
      "type": "string",
      "enum": ["metadata_only", "redacted", "full_content", "reference_only"]
    },
    "idempotencyKey": { "type": "string" },
    "payloadRef": { "type": "string" },
    "data": { "type": "object" }
  }
}
```

---

## 3. Typed Event Families (Phase 4 Verified)

All 11 typed event families are strictly defined in [`packages/contracts/src/events/event-families.schema.ts`](file:///packages/contracts/src/events/event-families.schema.ts) and validated at runtime via [`EventSchemaRegistry`](file:///packages/domain/src/gateway/schema-registry.ts):

|   #    | Event Type                                   | Priority Lane    | Description                                    | Key Payload Fields                                                                                                  |
| :----: | :------------------------------------------- | :--------------- | :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| **1**  | `io.proofmesh.telemetry.span.received.v1`    | `bulk_telemetry` | OpenTelemetry distributed trace spans          | `spanId`, `traceId`, `name`, `kind`, `startTimeUnixNano`, `endTimeUnixNano`, `attributes`, `status`                 |
| **2**  | `io.proofmesh.agent.activity.v1`             | `bulk_telemetry` | Agent tool calls, subagent spawns & planning   | `activityId`, `agentId`, `agentRole`, `activityType`, `toolName`, `toolParameters`, `executionStatus`, `durationMs` |
| **3**  | `io.proofmesh.message.observed.v1`           | `bulk_telemetry` | LLM conversation turns and prompt messages     | `messageId`, `conversationId`, `role`, `content`, `contentHash`, `tokenCount`, `model`                              |
| **4**  | `io.proofmesh.source.artifact.registered.v1` | `bulk_telemetry` | External source documents & evidence artifacts | `artifactId`, `artifactVersion`, `uri`, `mimeType`, `contentHash`, `byteSize`, `action`                             |
| **5**  | `io.proofmesh.claim.registered.v1`           | `high_priority`  | AI or human claim registered in system         | `claimConceptId`, `claimVersionId`, `conceptKey`, `statement`, `status`, `qualifiers`                               |
| **6**  | `io.proofmesh.context.packet.created.v1`     | `bulk_telemetry` | RAG retrieval / memory context packets         | `contextPacketId`, `packetType`, `passages` (array with `passageId`, `contentHash`, `score`), `totalTokens`         |
| **7**  | `io.proofmesh.dependency.declared.v1`        | `bulk_telemetry` | Typed dependency edge between entities         | `edgeId`, `sourceType`, `sourceId`, `targetType`, `targetId`, `dependencyType`, `captureMethod`                     |
| **8**  | `io.proofmesh.decision.registered.v1`        | `high_priority`  | Automated policy disposition or admission      | `decisionId`, `decisionType`, `disposition`, `targetEntityId`, `targetEntityType`, `rationale`                      |
| **9**  | `io.proofmesh.review.approval.v1`            | `high_priority`  | Human attestation or review verdict            | `approvalId`, `reviewCaseId`, `reviewerPrincipalId`, `verdict`, `statement`, `digitalSignature`                     |
| **10** | `io.proofmesh.remediation.event.v1`          | `high_priority`  | Automated or manual remediation execution      | `remediationId`, `caseId`, `remediationType`, `status`, `actionsTaken`                                              |
| **11** | `io.proofmesh.connector.health.v1`           | `high_priority`  | External connector heartbeat & health          | `connectorId`, `connectorType`, `status`, `latencyMs`, `errorCount`, `lastHeartbeat`                                |

---

## 4. Ingestion Gateway Endpoints

- `POST /v1/gateway/events`: Ingest single canonical event.
- `POST /v1/gateway/batch`: Atomic ingestion of up to 100 events.
- `POST /v1/gateway/adapters/opentelemetry`: Ingest OpenTelemetry ResourceSpans.
- `POST /v1/gateway/adapters/callbacks`: Ingest LangChain / MCP tool callbacks.
- `GET /v1/gateway/health`: Gateway diagnostics, queue lag, and circuit breaker status.
- `POST /v1/gateway/dead-letter/:id/replay`: Manual replay of failed dead-lettered events (restricted to human principals).

---

## 5. Schema Evolution & Compatibility

Detailed evolution rules, deprecation grace periods (180 days), and breaking change processes are specified in:
-> [Event Schema Evolution Policy](file:///docs/api/schema-evolution.md)
