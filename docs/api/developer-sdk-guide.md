# ProofMesh Developer SDK & MCP Guide

This guide describes how to integrate AI applications, autonomous agents, and RAG pipelines with ProofMesh using the official TypeScript SDK (`@proofmesh/sdk`), Python SDK (`proofmesh`), and Model Context Protocol (MCP) Server.

---

## 1. Core Architecture: Progressive Governance

ProofMesh adopts a two-tier evidence architecture:

1. **Automatic Observation (`captured`)**: Automated instrumentation via decorators, OpenTelemetry spans, or LangChain callbacks provides operational execution visibility without human intervention. Telemetry captures _what happened_, but does _not_ prove claim correctness or policy compliance.
2. **Explicit Semantic Declaration (`declared` / `attested`)**: Explicit SDK and MCP calls assert factual claims, curated context packets, and causal dependencies between evidence and decisions.
   - Authoritative transitions to `attested` are restricted to human-in-the-loop verification (Core Non-Negotiable Rule 2). Automated agents cannot self-attest claims.

```
+-------------------------------------------------------+
|                AI Application Workflow                |
+-------------------------------------------------------+
         |                                     |
         v                                     v
+-----------------------+           +-----------------------+
| Automatic Telemetry   |           |  Explicit Semantics   |
| (Non-blocking, OTel)  |           |  (Durable Contracts)  |
| captureMethod:        |           |  captureMethod:       |
| 'captured'            |           |  'declared'           |
+-----------------------+           +-----------------------+
         |                                     |
         +------------------+------------------+
                            v
               +-------------------------+
               |  ProofMesh Gateway/API  |
               +-------------------------+
```

---

## 2. TypeScript SDK (`@proofmesh/sdk`)

### Installation

```bash
pnpm add @proofmesh/sdk
# or npm install @proofmesh/sdk
```

### Client Initialization

```typescript
import { ProofMeshClient } from '@proofmesh/sdk';

const client = new ProofMeshClient({
  apiKey: process.env.PROOFMESH_API_KEY!,
  baseUrl: process.env.PROOFMESH_BASE_URL || 'https://api.proofmesh.io',
  tenantId: process.env.PROOFMESH_TENANT_ID, // Server-enforced tenant scope
  timeoutMs: 5000,
  maxRetries: 3,
  retryDelayMs: 200,
  failOpen: false // Telemetry fails open; semantic ops fail closed by default
});
```

### Workflow Context Scoping

ProofMesh tracks asynchronous task boundaries using Node.js `AsyncLocalStorage`:

```typescript
import { withWorkflow } from '@proofmesh/sdk';

await client.withWorkflow('onboarding-user-12345', async () => {
  // All SDK calls and observed functions automatically inherit:
  // workflowId, correlationId, traceId, spanId
  const claim = await client.claims.register({
    claimConceptKey: 'identity_verified',
    statement: 'Applicant passport details match national database.'
  });
});
```

### Curated Context Packets & Claims

```typescript
// 1. Register evidence context packet
const packet = await client.contextPackets.create({
  packetType: 'rag_retrieval',
  passages: [
    {
      content: 'Passage text retrieved from vector database...',
      score: 0.94
    }
  ],
  totalTokens: 120
});

// 2. Register factual claim linked to context packet
const claim = await client.claims.register({
  claimConceptKey: 'credit_score_above_700',
  statement: 'Applicant credit score is 745 as of current billing cycle.',
  contextPacketId: packet.id,
  captureMethod: 'declared'
});

// 3. Declare explicit prerequisite dependency
await client.dependencies.declare({
  dependentEntityId: claim.id,
  dependentEntityType: 'claim',
  prerequisiteEntityId: packet.id,
  prerequisiteEntityType: 'artifact',
  relationshipType: 'supports',
  declarationReason: 'Context passage provides ground truth credit score'
});
```

### Policy Admissibility & Decision Registration

```typescript
// Check if claim satisfies admissibility criteria
const check = await client.admissibility.check({
  claimVersionId: claim.id,
  policyName: 'underwriting_sufficiency_v2'
});

if (check.isAdmissible) {
  // Authoritative decision registration
  await client.decisions.register({
    decisionType: 'loan_preapproval',
    outcome: 'approved',
    rationale: 'All prerequisite claims admissible under underwriting policy',
    contributingClaimIds: [claim.id]
  });
} else {
  // Escalate to human compliance review
  await client.reviews.request({
    title: 'Admissibility Escalation',
    summary: check.reasons.join('; '),
    requiredRole: 'compliance_officer',
    claimId: claim.id,
    priority: 'high'
  });
}
```

### Automated Decorators & LangChain Callback

```typescript
import { observeWorkflow, observeTool, ProofMeshLangChainCallback } from '@proofmesh/sdk';

// Decorators
const result = await observeWorkflow(client, 'rag_query_pipeline', async () => {
  return await observeTool(client, 'vector_search', async () => {
    return db.search(query);
  });
});

// LangChain integration
const callback = new ProofMeshLangChainCallback(client);
const chain = new RetrievalQAChain({ ... });
await chain.invoke({ query: '...' }, { callbacks: [callback] });
```

---

## 3. Python SDK (`proofmesh`)

### Installation

```bash
pip install proofmesh
```

### Client Initialization

```python
from proofmesh import ProofMeshClient, AsyncProofMeshClient

# Synchronous client
client = ProofMeshClient(
    api_key="pm_live_...",
    base_url="https://api.proofmesh.io",
    tenant_id="tenant-uuid-here"
)

# Asynchronous client
async_client = AsyncProofMeshClient(
    api_key="pm_live_...",
    base_url="https://api.proofmesh.io"
)
```

### Python Decorators & Context Management

```python
from proofmesh import observe_workflow, observe_tool, with_workflow

@observe_tool(name="retrieve_documents", client=client)
def retrieve_documents(query: str):
    return ["Doc passage 1", "Doc passage 2"]

@observe_workflow(name="rag_synthesis", client=client)
def generate_answer(query: str):
    docs = retrieve_documents(query)
    # Automatically tracks telemetry and attaches context
    return "Synthesized answer"
```

### Python LangChain Integration

```python
from proofmesh import ProofMeshLangChainCallbackHandler

handler = ProofMeshLangChainCallbackHandler(client)
chain.invoke({"input": "..."}, config={"callbacks": [handler]})
```

---

## 4. Model Context Protocol (MCP) Server

ProofMesh provides a Model Context Protocol server (`@proofmesh/mcp-server`) that equips autonomous AI agents (such as Claude Desktop, Cursor, or Antigravity) with governed evidence operations.

### Tools Provided

| Tool Name              | Type       | Description                                                                     |
| :--------------------- | :--------- | :------------------------------------------------------------------------------ |
| `lookup_claim`         | Read-only  | Retrieve statement, status, and qualifiers for a claim ID.                      |
| `register_claim`       | Declared   | Stage a new claim with initial status `submitted` and captureMethod `declared`. |
| `get_approved_context` | Read-only  | Retrieve curated passages from a verified context packet.                       |
| `declare_dependency`   | Declared   | Explicitly declare a prerequisite dependency between claims.                    |
| `check_admissibility`  | Read-only  | Evaluate claim admissibility against governance policies.                       |
| `get_impact_report`    | Read-only  | Query downstream blast radius and affected decisions.                           |
| `request_review`       | Escalation | Submit a formal review case for human sign-off.                                 |

### Core Security Boundary (Rule 2 Enforcement)

> [!CAUTION]
> **Authoritative State Protection**:
> Autonomous models and LLM agents cannot self-attest claims or approve policies. If an LLM attempts to pass `status: "attested"` via `register_claim`, the MCP server immediately intercepts and blocks the call with a security error. Transitions to `attested` are strictly restricted to authenticated human operators.

### Claude Desktop Configuration

Add the following configuration to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "proofmesh": {
      "command": "npx",
      "args": ["-y", "@proofmesh/mcp-server"],
      "env": {
        "PROOFMESH_API_KEY": "pm_live_your_api_key_here",
        "PROOFMESH_BASE_URL": "https://api.proofmesh.io",
        "PROOFMESH_TENANT_ID": "your-tenant-uuid-here"
      }
    }
  }
}
```
