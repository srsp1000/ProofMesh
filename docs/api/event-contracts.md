# ProofMesh Event Contracts & Envelope Specification

**Document:** `docs/api/event-contracts.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Architecture Specification

---

## 1. Overview & CloudEvents Alignment

All asynchronous domain events, outbox messages, and webhook notifications in ProofMesh adhere to a standardized **Canonical Event Envelope** compliant with the **CNCF CloudEvents v1.0** specification.

### Core Architectural Guarantees

- **At-Least-Once Delivery**: Consumers must assume events can be delivered multiple times and enforce idempotency using `id` and `idempotencyKey`.
- **Tenant Context Isolation**: Every event envelope contains an immutable `tenantId` attribute derived exclusively from authenticated server context.
- **Causality & Tracing**: Every event includes `correlationId` and `causationId` to track causal execution trees across distributed agent boundaries.

---

## 2. Canonical Event Envelope Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/event-envelope.json",
  "title": "ProofMeshEventEnvelope",
  "type": "object",
  "required": [
    "specversion",
    "id",
    "source",
    "type",
    "time",
    "datacontenttype",
    "tenantId",
    "correlationId",
    "data"
  ],
  "properties": {
    "specversion": {
      "type": "string",
      "const": "1.0",
      "description": "CloudEvents specification version."
    },
    "id": {
      "type": "string",
      "format": "uuid",
      "description": "Globally unique event identifier (UUIDv4)."
    },
    "source": {
      "type": "string",
      "format": "uri-reference",
      "example": "/tenants/t-123/projects/kyc-bot",
      "description": "URI-reference identifying the context in which an event happened."
    },
    "type": {
      "type": "string",
      "pattern": "^io\\.proofmesh\\.[a-z0-9_-]+\\.[a-z0-9_-]+\\.v[1-9][0-9]*$",
      "example": "io.proofmesh.claim.submitted.v1",
      "description": "Namespaced event type with semantic version suffix."
    },
    "time": {
      "type": "string",
      "format": "date-time",
      "description": "Timestamp when the event occurred (ISO 8601 UTC)."
    },
    "datacontenttype": {
      "type": "string",
      "const": "application/json"
    },
    "tenantId": {
      "type": "string",
      "format": "uuid",
      "description": "Authoritative tenant identifier."
    },
    "correlationId": {
      "type": "string",
      "format": "uuid",
      "description": "End-to-end trace correlation identifier across agent execution."
    },
    "causationId": {
      "type": "string",
      "format": "uuid",
      "description": "Identifier of the prior command or event that directly triggered this event."
    },
    "idempotencyKey": {
      "type": "string",
      "description": "Client-supplied idempotency key for deduplication."
    },
    "data": {
      "type": "object",
      "description": "Typed domain event payload."
    }
  },
  "additionalProperties": false
}
```

---

## 3. Typed Domain Event Payloads

### 3.1 `io.proofmesh.claim.submitted.v1`

Emitted when an agent or client submits a new claim assertion.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/events/claim-submitted.json",
  "title": "ClaimSubmittedV1Payload",
  "type": "object",
  "required": [
    "claimConceptId",
    "claimVersionId",
    "versionSequence",
    "statement",
    "status",
    "qualifiers"
  ],
  "properties": {
    "claimConceptId": { "type": "string", "format": "uuid" },
    "claimVersionId": { "type": "string", "format": "uuid" },
    "conceptKey": { "type": "string" },
    "versionSequence": { "type": "integer", "minimum": 1 },
    "statement": { "type": "string" },
    "status": { "type": "string", "const": "submitted" },
    "qualifiers": {
      "type": "object",
      "properties": {
        "domain": { "type": "string" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "jurisdiction": { "type": "string" }
      },
      "additionalProperties": true
    },
    "contextPacketId": { "type": "string", "format": "uuid", "nullable": true },
    "submittedByPrincipalId": { "type": "string", "format": "uuid" }
  },
  "additionalProperties": false
}
```

---

### 3.2 `io.proofmesh.claim.transitioned.v1`

Emitted when a claim transitions between lifecycle states.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/events/claim-transitioned.json",
  "title": "ClaimTransitionedV1Payload",
  "type": "object",
  "required": ["claimVersionId", "fromStatus", "toStatus", "transitionReason", "actorPrincipalId"],
  "properties": {
    "claimVersionId": { "type": "string", "format": "uuid" },
    "fromStatus": {
      "type": "string",
      "enum": ["draft", "submitted", "evaluating", "attested", "disputed", "rejected"]
    },
    "toStatus": {
      "type": "string",
      "enum": ["draft", "submitted", "evaluating", "attested", "disputed", "rejected", "archived"]
    },
    "transitionReason": { "type": "string" },
    "actorPrincipalId": { "type": "string", "format": "uuid" },
    "linkedEvidenceIds": {
      "type": "array",
      "items": { "type": "string", "format": "uuid" }
    }
  },
  "additionalProperties": false
}
```

---

### 3.3 `io.proofmesh.evidence.ingested.v1`

Emitted when a raw evidence item is persisted and hashed.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/events/evidence-ingested.json",
  "title": "EvidenceIngestedV1Payload",
  "type": "object",
  "required": [
    "evidenceItemId",
    "evidenceType",
    "contentHash",
    "byteSize",
    "storageUri",
    "capturedAt"
  ],
  "properties": {
    "evidenceItemId": { "type": "string", "format": "uuid" },
    "evidenceType": {
      "type": "string",
      "enum": [
        "runtime_trace",
        "document_passage",
        "tool_result",
        "human_statement",
        "metric_sample"
      ]
    },
    "contentHash": { "type": "string", "pattern": "^sha256:[a-f0-9]{64}$" },
    "byteSize": { "type": "integer", "minimum": 0 },
    "storageUri": { "type": "string", "format": "uri" },
    "sourcePassageId": { "type": "string", "format": "uuid", "nullable": true },
    "capturedAt": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

---

### 3.4 `io.proofmesh.evidence.assessed.v1`

Emitted when an evidence item is evaluated against a claim.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/events/evidence-assessed.json",
  "title": "EvidenceAssessedV1Payload",
  "type": "object",
  "required": [
    "assessmentVersionId",
    "claimVersionId",
    "evidenceItemId",
    "outcome",
    "applicability",
    "confidenceScore"
  ],
  "properties": {
    "assessmentVersionId": { "type": "string", "format": "uuid" },
    "claimVersionId": { "type": "string", "format": "uuid" },
    "evidenceItemId": { "type": "string", "format": "uuid" },
    "outcome": {
      "type": "string",
      "enum": ["supports", "refutes", "inconclusive", "contradictory"]
    },
    "applicability": {
      "type": "string",
      "enum": ["direct", "analogous", "contextual", "inapplicable"]
    },
    "confidenceScore": { "type": "number", "minimum": 0, "maximum": 1 },
    "rationale": { "type": "string" },
    "evaluatedByPrincipalId": { "type": "string", "format": "uuid" }
  },
  "additionalProperties": false
}
```

---

### 3.5 `io.proofmesh.policy.evaluated.v1`

Emitted when a policy disposition is rendered.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/events/policy-evaluated.json",
  "title": "PolicyEvaluatedV1Payload",
  "type": "object",
  "required": [
    "policyEvaluationId",
    "policyVersionId",
    "actionType",
    "disposition",
    "evaluationLatencyMs"
  ],
  "properties": {
    "policyEvaluationId": { "type": "string", "format": "uuid" },
    "policyVersionId": { "type": "string", "format": "uuid" },
    "claimVersionId": { "type": "string", "format": "uuid", "nullable": true },
    "actionType": { "type": "string" },
    "disposition": {
      "type": "string",
      "enum": ["admit", "deny", "require_human_review", "warn", "remediate"]
    },
    "rulesTriggered": {
      "type": "array",
      "items": { "type": "string" }
    },
    "remediationNotes": { "type": "string", "nullable": true },
    "evaluationLatencyMs": { "type": "integer", "minimum": 0 }
  },
  "additionalProperties": false
}
```

---

### 3.6 `io.proofmesh.review.approved.v1`

Emitted when a human reviewer attests or rejects a case.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://proofmesh.io/schemas/v1/events/review-approved.json",
  "title": "ReviewApprovedV1Payload",
  "type": "object",
  "required": [
    "approvalId",
    "reviewCaseId",
    "claimVersionId",
    "approverPrincipalId",
    "verdict",
    "statement"
  ],
  "properties": {
    "approvalId": { "type": "string", "format": "uuid" },
    "reviewCaseId": { "type": "string", "format": "uuid" },
    "claimVersionId": { "type": "string", "format": "uuid" },
    "approverPrincipalId": { "type": "string", "format": "uuid" },
    "verdict": {
      "type": "string",
      "enum": ["approved", "rejected", "amended"]
    },
    "statement": { "type": "string" },
    "digitalSignature": { "type": "string", "nullable": true }
  },
  "additionalProperties": false
}
```

---

## 4. Schema Evolution, Compatibility & Deprecation Rules

### 4.1 Backward Compatibility Invariants

1. **Additive Changes Allowed**: Adding optional fields to an event payload or envelope is backward-compatible and does not increment major version.
2. **Breaking Changes Require New Version**: Removing a field, renaming an existing field, changing a field type, or modifying enum values requires a new major version suffix (`.v2`) and a new schema `$id`.
3. **Consumer Tolerance**: All consumers must ignore unrecognized fields (`additionalProperties: true` in consumers, `false` in producers).

### 4.2 Deprecation Lifecycle

1. When a new event version (`v2`) is introduced, the prior version (`v1`) enters **Deprecated** status.
2. Deprecated event versions continue to be emitted for a mandatory **180-day grace period**.
3. Monitoring alerts fire if deprecated event consumers are detected 30 days prior to sunset.
