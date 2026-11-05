# ProofMesh API Contracts, Protocols & Integration Plan

**Document:** `docs/api/api-contract-plan.md`  
**Version:** 1.0.0-PROPOSED  
**Date:** 2026-11-04  
**Author:** Lead Software Architect and Engineering Orchestrator  
**Status:** Baselined Architecture Specification

---

## 1. OpenAPI 3.1 Overview & Standard Error Format

All synchronous ProofMesh HTTP APIs adhere to **OpenAPI 3.1.0** standards. All error responses strictly conform to **RFC 7807 Problem Details for HTTP APIs** (`application/problem+json`).

### Standard RFC 7807 Error Envelope

```json
{
  "type": "https://proofmesh.io/errors/invalid-state-transition",
  "title": "Invalid State Transition",
  "status": 409,
  "detail": "ClaimVersion in status 'rejected' cannot transition directly to 'attested'. A new version must be submitted.",
  "instance": "/v1/claims/c-123e4567/transition",
  "code": "INVALID_STATE_TRANSITION",
  "tenantId": "t-98765432",
  "timestamp": "2026-11-04T23:20:00Z",
  "invalidParams": [
    {
      "name": "targetState",
      "reason": "Terminal state violation"
    }
  ]
}
```

---

## 2. Core REST API Endpoints

### 2.1 Claims API (`/v1/claims`)

#### `POST /v1/claims`

- **Description**: Submits an AI-generated statement or compliance assertion.
- **Headers**: `Authorization: Bearer <jwt>`, `Idempotency-Key: <uuid>`.
- **Request Body**:
  ```json
  {
    "claimConceptKey": "applicant-credit-risk",
    "statement": "Debt-to-income ratio is 28%, meeting underwriting guidelines.",
    "qualifiers": { "domain": "lending", "confidence": 0.95 },
    "contextPacketId": "d3b07384-d113-46fb-a0e2-df081fc7e8a9"
  }
  ```
- **Responses**:
  - `201 Created`: Returns created `ClaimVersionDTO`.
  - `200 OK`: Returned when duplicate `Idempotency-Key` is provided.
  - `400 Bad Request`: Schema validation failure.

#### `POST /v1/claims/:id/transition`

- **Description**: Executes a guarded state transition on a `ClaimVersion`.
- **Request Body**:
  ```json
  {
    "targetState": "attested",
    "transitionReason": "All supporting evidence corroborated with zero disputes.",
    "evidenceAssessmentIds": ["a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"]
  }
  ```
- **Responses**:
  - `200 OK`: Transition successful.
  - `409 Conflict`: Guard condition violated.

---

### 2.2 Evidence API (`/v1/evidence`)

#### `POST /v1/evidence`

- **Description**: Ingests raw evidence, computes SHA-256 digest, and stores content.
- **Headers**: `Idempotency-Key: <uuid>`, `Content-Type: application/json` or `application/pdf`.
- **Responses**:
  - `202 Accepted`: Returns `{"evidenceItemId": "...", "contentHash": "sha256:..."}`.
  - `413 Payload Too Large`: Payload exceeds 50MB.

---

### 2.3 Synchronous Policy Evaluation API (`/v1/policy/evaluate`)

#### `POST /v1/policy/evaluate`

- **Description**: Evaluates an agent action against active OPA Rego policy bundles.
- **Request Body**:
  ```json
  {
    "action": "tool:execute:database_query",
    "claimVersionId": "c-123e4567-e89b-12d3-a456-426614174000",
    "parameters": {
      "table": "customer_accounts",
      "operation": "DROP"
    },
    "enforcementMode": "synchronous",
    "failPolicy": "fail_closed"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "evaluationId": "e9b1deb4-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "disposition": "deny",
    "rulesTriggered": ["prohibit_destructive_ddl"],
    "remediationNotes": "Destructive DDL is forbidden in governed environments.",
    "evaluationLatencyMs": 4
  }
  ```

---

### 2.4 Lineage DAG API (`/v1/lineage/claims/:id`)

#### `GET /v1/lineage/claims/:id?depth=5&direction=upstream`

- **Description**: Traverses the immutable lineage DAG via recursive CTE queries.
- **Response (`200 OK`)**:
  ```json
  {
    "rootNodeId": "c-123e4567-e89b-12d3-a456-426614174000",
    "nodes": [
      {
        "id": "c-123e4567-e89b-12d3-a456-426614174000",
        "type": "claim_version",
        "label": "Applicant credit risk",
        "status": "attested"
      },
      {
        "id": "e-98765432-12d3-e89b-a456-426614174000",
        "type": "evidence_item",
        "contentHash": "sha256:4a5b6c...",
        "evidenceType": "runtime_trace"
      }
    ],
    "edges": [
      {
        "sourceId": "e-98765432-12d3-e89b-a456-426614174000",
        "targetId": "c-123e4567-e89b-12d3-a456-426614174000",
        "edgeType": "supported_by",
        "captureMethod": "captured",
        "confidenceScore": 0.98
      }
    ],
    "coverage": {
      "status": "complete",
      "knownPercentage": 100.0
    }
  }
  ```

---

## 3. ProofMesh Client SDK Contract

The official TypeScript SDK (`@proofmesh/sdk`) encapsulates client communications, automatic retry backoffs, and local buffering:

```typescript
export interface ProofMeshClientConfig {
  baseUrl: string;
  apiKey: string;
  tenantId: string;
  failPolicy?: 'fail_open' | 'fail_closed';
  timeoutMs?: number;
}

export interface ClaimInput {
  conceptKey: string;
  statement: string;
  qualifiers?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface PolicyEvaluationResult {
  evaluationId: string;
  disposition: 'admit' | 'deny' | 'require_human_review' | 'warn' | 'remediate';
  rulesTriggered: string[];
  remediationNotes?: string;
  evaluationLatencyMs: number;
}

export interface ProofMeshClient {
  submitClaim(input: ClaimInput): Promise<ClaimVersionDTO>;
  recordEvidence(payload: Uint8Array | object, type: EvidenceType): Promise<EvidenceItemDTO>;
  evaluatePolicy(action: string, params: Record<string, unknown>): Promise<PolicyEvaluationResult>;
  getLineage(claimVersionId: string, depth?: number): Promise<LineageGraphDTO>;
}
```

---

## 4. Model Context Protocol (MCP) Tool Contract

ProofMesh exposes an **MCP Proxy Gateway** acting as an inline Policy Enforcement Point.

### MCP Tool Definitions

1. **`proofmesh_evaluate_policy`**:
   - Evaluates whether an agent may call a specific tool.
   - Parameters: `toolName` (string), `arguments` (object), `failPolicy` (string).
2. **`proofmesh_record_assertion`**:
   - Records an assertion made by an agent directly into the claim pipeline.
   - Parameters: `statement` (string), `confidence` (number), `evidenceUris` (array).

### MCP Authorization Flow

1. MCP client requests tool execution over JSON-RPC.
2. ProofMesh intercepts request, evaluates OPA policy.
3. If `admit`: Proxies call to downstream tool server and streams response back to client.
4. If `deny`: Returns JSON-RPC Error code `-32003` with policy denial details.

---

## 5. OpenTelemetry-to-Domain Mapping Contract

The OpenTelemetry receiver maps incoming OTLP GenAI spans into canonical ProofMesh domain entities:

| OpenTelemetry Attribute      | ProofMesh Domain Mapping                            | Target Entity & Field                   |
| :--------------------------- | :-------------------------------------------------- | :-------------------------------------- |
| `gen_ai.operation.name`      | Operation Type (`chat`, `completion`, `embeddings`) | `EvidenceItem.qualifiers.operation`     |
| `gen_ai.provider.name`       | Model Provider (`openai`, `anthropic`, `bedrock`)   | `EvidenceItem.qualifiers.provider`      |
| `gen_ai.request.model`       | Model Identifier (e.g. `claude-3-5-sonnet`)         | `EvidenceItem.qualifiers.requestModel`  |
| `gen_ai.response.model`      | Actual Model Version executed                       | `EvidenceItem.qualifiers.responseModel` |
| `gen_ai.usage.input_tokens`  | Input Token Metric                                  | `AgentActivity.prompt_tokens`           |
| `gen_ai.usage.output_tokens` | Output Token Metric                                 | `AgentActivity.completion_tokens`       |
| Span ID & Trace ID           | Telemetry Correlation ID                            | `EvidenceItem.content_payload.traceId`  |

---

## 6. Switch Protocol & Session Resume Contract

For real-time agent connections (WebSocket/SSE), ProofMesh implements session persistence conforming to the Agent Client Protocol (ACP):

- **`session/resume` Method**:
  ```json
  {
    "jsonrpc": "2.0",
    "method": "session/resume",
    "params": {
      "sessionId": "s-12345-67890",
      "lastEventId": "evt-98765"
    },
    "id": 1
  }
  ```
- **Response**: Returns a full current-state snapshot of all active claims, pending review cases, and missed event notifications since `lastEventId`.

---

## 7. Dependency Graph Vocabulary

To prevent ambiguity, dependency graph edges must use only this approved vocabulary:

| Edge Type      | Valid Source Nodes                | Valid Target Nodes                | Semantic Meaning                                 |
| :------------- | :-------------------------------- | :-------------------------------- | :----------------------------------------------- |
| `derives_from` | `ClaimVersion`, `DecisionVersion` | `SourceArtifact`, `SourcePassage` | Claim text was extracted or derived from source. |
| `supported_by` | `ClaimVersion`                    | `EvidenceItem`                    | Evidence corroborates the statement.             |
| `refuted_by`   | `ClaimVersion`                    | `EvidenceItem`                    | Evidence contradicts the statement.              |
| `governed_by`  | `DecisionVersion`, `ClaimVersion` | `PolicyVersion`                   | Policy bundle evaluated against the node.        |
| `attested_by`  | `ClaimVersion`                    | `Approval`                        | Human or authorized principal attestation.       |

---

## 8. Versioning, Deprecation & Compatibility Rules

1. **Semantic Versioning**: All public APIs follow URI versioning (`/v1/`).
2. **Backward Compatibility**: Additive properties in JSON responses are non-breaking. Breaking changes require incrementing to `/v2/`.
3. **Deprecation Period**: Deprecated endpoints require a minimum **180-day grace period** with `Deprecation: @<timestamp>` and `Sunset: @<timestamp>` HTTP headers (RFC 8594).
