# Identity, Multi-Tenancy, Authorization & Audit Foundation

**Document:** `docs/security/identity-and-access.md`  
**Version:** 1.0.0-GA  
**Status:** Approved Architecture & Implementation Specification  
**Author:** Lead Software Architect & Security Reviewer  
**Classification:** Security Architecture Specification

---

## 1. Executive Security Architecture

ProofMesh implements a zero-trust, defense-in-depth security architecture governing multi-tenant isolation, principal identities, role-based access control (RBAC), credential management, and cryptographic audit non-repudiation.

```mermaid
flowchart TD
    Client["Client / Agent Request"] -->|Authorization: Bearer JWT or ApiKey| Gateway["Fastify Gateway"]

    subgraph Authentication ["1. Authentication & Context Derivation"]
        Gateway -->|Verify JWT / API Key Hash| Verifier["Constant-Time Verifier"]
        Verifier -->|Derive Tenant from Membership / Key| Context["RequestContext"]
        Context -->|Bind to AsyncLocalStorage| ALS["Node.js AsyncLocalStorage"]
    end

    subgraph Authorization ["2. RBAC & Agent Boundary Enforcement"]
        ALS -->|Evaluate Permission| RBAC["RBAC Policy Evaluator"]
        RBAC -->|Human-Only Gate| Guard{"Is Human-Only Action?"}
        Guard -->|Agent Principal| Deny["Deny (403) & Log Security Audit"]
        Guard -->|Human Principal| Allow["Allow Request"]
    end

    subgraph DatabaseLayer ["3. Kernel-Level Tenant Isolation"]
        Allow -->|SET LOCAL app.current_tenant_id| PG["PostgreSQL 16"]
        PG -->|Restricted Role: proofmesh_app| RLS["Row-Level Security (FORCE RLS)"]
        RLS -->|USING (tenant_id = current_setting)| Data["Isolated Tenant Rows"]
    end

    subgraph AuditLayer ["4. Append-Only Cryptographic Audit Ledger"]
        Allow -->|Append Event| Audit["Audit Service"]
        Audit -->|SHA-256 Payload Hash + Prev Hash Link| Chain["Linear Hash Chain"]
        Chain -->|Batch Hourly Seal| Merkle["Merkle Tree Root Checkpoint"]
    end
```

---

## 2. Multi-Tenant Lifecycle & Server-Side Tenant Derivation

### 2.1 Tenant Lifecycle State Machine

Tenants progress through an explicit lifecycle governed by [`TenantLifecycle`](file:///packages/domain/src/identity/tenant-lifecycle.ts):

- `active`: Normal operations; all API and ingestion paths enabled.
- `suspended`: Temporary operational pause (e.g. billing hold, compliance freeze). Operational API calls are blocked; audit records remain queryable by admins.
- `deprovisioned`: Terminal state. All access is permanently denied ([`DeprovisionedTenantAccessError`](file:///packages/domain/src/identity/tenant-lifecycle.ts#L10-L16)). All historical audit records and compliance evidence remain permanently preserved for regulatory compliance.

### 2.2 Server-Side Tenant Derivation

Operating Rule 17 strictly forbids trusting client-supplied tenant identifiers:

1. **Human Users (OIDC JWT)**:
   - The server validates JWT signature, expiration, issuer, and audience using [`JwtSigner`](file:///apps/api/src/auth/jwt.ts).
   - The user's active tenant is resolved from verified database memberships ([`memberships`](file:///packages/db/src/migrations/0002_identity_auth_and_audit.sql#L6-L16)).
   - If an optional `X-Tenant-ID` header is passed (for multi-tenant users), the server cryptographically asserts that the principal possesses an active verified membership in that specific tenant before setting the session context.
2. **Machine & Agent Credentials (API Keys)**:
   - The server extracts the token, computes its SHA-256 hash, and looks up the active key record in [`api_keys`](file:///packages/db/src/migrations/0002_identity_auth_and_audit.sql#L56-L69).
   - The `tenant_id` is derived directly from the authoritative database record.
   - Any external tenant parameter is completely ignored.

---

## 3. Principal Identity & Agent Anti-Impersonation Boundary

### 3.1 Principal Identity Types

Principals are categorized into three distinct types:

1. `human_user`: Real human operators, compliance officers, and administrators authenticated via enterprise OIDC.
2. `service_account`: Backend microservices, CI/CD pipelines, and internal tools.
3. `agent_identity`: Autonomous AI agents, LLM pipelines, and LangChain/CrewAI/MCP worker runtimes.

### 3.2 Non-Negotiable Human-Only Boundary

To prevent AI agents from hallucinating or forging compliance approvals, ProofMesh enforces a strict boundary in both domain policy ([`RBACPolicy`](file:///packages/domain/src/auth/rbac.ts)) and database triggers ([`check_role_assignment_agent_boundary`](file:///packages/db/src/migrations/0002_identity_auth_and_audit.sql#L95-L114)):

| Role / Action            | Allowed Principal Types             | Rationale                                                           |
| :----------------------- | :---------------------------------- | :------------------------------------------------------------------ |
| **`admin`**              | `human_user`                        | Tenant administrative control cannot be held by autonomous LLMs.    |
| **`compliance_officer`** | `human_user`                        | Regulatory compliance decisions require human legal accountability. |
| **`claims:attest`**      | `human_user`                        | AI claims cannot be self-attested or verified by automated agents.  |
| **`claims:review`**      | `human_user`                        | Human-in-the-loop review cases require genuine human review.        |
| **`roles:assign`**       | `human_user`                        | Privilege grant and credential delegation must be human-authorized. |
| **`developer`**          | `human_user`, `service_account`     | Engineering management of projects and connectors.                  |
| **`agent_ingest`**       | `agent_identity`, `service_account` | Least-privilege telemetry and claim candidate submission.           |

> [!CAUTION]
> If an agent identity attempts to exercise a human-only permission (e.g. `claims:attest`), the request is immediately denied with HTTP 403 (`AGENT_HUMAN_IMPERSONATION_PROHIBITED`), and a security denial event is logged to the immutable audit ledger.

---

## 4. PostgreSQL Row-Level Security & Restricted Roles

### 4.1 Row-Level Security (RLS) Policy Architecture

Every tenant-scoped table is secured by kernel-level PostgreSQL RLS:

```sql
CREATE POLICY tenant_isolation_policy ON table_name
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

Furthermore, `FORCE ROW LEVEL SECURITY` is enabled across all tenant tables, guaranteeing that even table owners cannot bypass RLS during normal session queries.

### 4.2 Restricted Application Role (`proofmesh_app`)

The database user employed by the running application is provisioned with least privilege:

```sql
CREATE ROLE proofmesh_app WITH
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO proofmesh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proofmesh_app;

-- Append-Only Immutability Revocations:
REVOKE UPDATE, DELETE ON audit_events FROM proofmesh_app;
REVOKE UPDATE, DELETE ON audit_checkpoints FROM proofmesh_app;
REVOKE UPDATE, DELETE ON evidence_items FROM proofmesh_app;
```

---

## 5. Secret Management & Credential Lifecycle

### 5.1 Connector Credential References

Plaintext secrets, tokens, API keys, and connection strings are **never** stored in ordinary domain database columns or emitted in logs.

- [`connector_credentials`](file:///packages/db/src/migrations/0002_identity_auth_and_audit.sql#L72-L86) stores:
  - `credential_ref`: Opaque reference URI (e.g. `enc://v1/<iv>:<authTag>:<ciphertext>` or `vault://...` / `kms://...`).
  - `masked_identity`: Masked identity string for UI display (e.g. `client_id: ****9821`).

### 5.2 Authenticated Envelope Encryption (`EnvelopeSecretManager`)

The secret manager implementation ([`EnvelopeSecretManager`](file:///packages/db/src/secrets/secret-manager.ts)) provides authenticated AES-256-GCM encryption:

- Secrets are encrypted with unique 96-bit random IVs and authenticated with 128-bit authentication tags.
- Tampering with ciphertext or authentication tags immediately raises [`SecretDecryptionError`](file:///packages/db/src/secrets/secret-manager.ts#L10-L16).
- Token verification utilizes constant-time comparison (`timingSafeEqual`) to prevent timing side-channels.

### 5.3 Token & Key Lifecycle

- **Issuance**: Full secret token (e.g. `pm_live_<randomHex>`) is returned strictly once upon creation.
- **Storage**: Only the SHA-256 hash and a 12-character prefix (`pm_live_...`) are stored in the database.
- **Expiry**: Tokens expire after a configured duration (default: 90 days). Expired tokens are rejected.
- **Revocation**: Instant revocation via `POST /v1/auth/api-keys/:id/revoke`.
- **Rotation**: Atomic rotation issues a replacement key and invalidates the previous credential.

---

## 6. Cryptographic Audit Ledger & Tamper-Evident Merkle Checkpoints

### 6.1 Bitemporal Linear Hash Chaining

Every state modification emits an immutable [`AuditEvent`](file:///packages/contracts/src/audit/audit.schema.ts#L3-L17) record containing:

- Canonical SHA-256 payload hash: `payloadHash = sha256(canonicalizeJson(payload))`
- Cryptographic chain pointer: `prevEventHash = Event[N-1].payloadHash`
- `correlationId`, `principalId`, `tenantId`, and `policyDecision`

### 6.2 Hourly Merkle Checkpoints

Periodic background checkpoints seal uncheckpointed audit batches:

1. The system verifies the linear hash chain across all batch events using [`MerkleTree.verifyLinearChain`](file:///packages/domain/src/audit/merkle-tree.ts#L61-L77).
2. Computes the binary Merkle root hash across all leaf event hashes ([`MerkleTree.computeRoot`](file:///packages/domain/src/audit/merkle-tree.ts#L36-L56)).
3. Persists an immutable [`AuditCheckpoint`](file:///packages/contracts/src/audit/audit.schema.ts#L29-L40) record linking to the previous checkpoint root.
4. Database triggers permanently block `UPDATE` and `DELETE` on all checkpoint records.

---

## 7. Security Verification & Test Coverage Matrix

| Test Suite                         | Spec File                                                                                      | Checks Verified                                                                        | Status   |
| :--------------------------------- | :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- | :------- |
| **Tenant Isolation & Anti-IDOR**   | [`test/security/tenant-isolation.test.ts`](file:///test/security/tenant-isolation.test.ts)     | Cross-tenant 404 isolation, unauthenticated 401, expired token 401, revoked key 401    | **PASS** |
| **Agent Anti-Impersonation**       | [`test/security/tenant-isolation.test.ts`](file:///test/security/tenant-isolation.test.ts)     | Agent human attestation denial (403), agent admin role escalation denial (403)         | **PASS** |
| **Rate Limiting**                  | [`test/security/tenant-isolation.test.ts`](file:///test/security/tenant-isolation.test.ts)     | Brute-force threshold enforcement (429 Too Many Requests) with Retry-After header      | **PASS** |
| **Audit Immutability & Merkle**    | [`test/security/audit-immutability.test.ts`](file:///test/security/audit-immutability.test.ts) | Linear hash chaining, tamper detection on payload alteration, Merkle root sealing      | **PASS** |
| **Restricted Role & Database RLS** | [`test/security/audit-immutability.test.ts`](file:///test/security/audit-immutability.test.ts) | RLS policies, FORCE RLS, immutability triggers, `proofmesh_app` NOBYPASSRLS role       | **PASS** |
| **Authenticated Secret Manager**   | [`test/unit/secret-manager.test.ts`](file:///test/unit/secret-manager.test.ts)                 | AES-256-GCM encryption/decryption, auth tag tampering rejection, constant-time compare | **PASS** |
| **RBAC Domain Invariants**         | [`test/unit/identity-rbac.test.ts`](file:///test/unit/identity-rbac.test.ts)                   | Human-only permissions, agent privilege escalation errors, tenant lifecycle states     | **PASS** |
| **Redaction Filter**               | [`test/unit/identity-rbac.test.ts`](file:///test/unit/identity-rbac.test.ts)                   | In-flight masking of bearer tokens, API keys, passwords, and sensitive keys            | **PASS** |
