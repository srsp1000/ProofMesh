# ADR-0009: Multi-Tenant Isolation & Cryptographic Audit Ledger Design

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Security Reviewer, Data Engineer  

---

## 1. Context & Problem Statement
ProofMesh is a multi-tenant enterprise governance platform. Cross-tenant data leakage is a catastrophic security failure. Furthermore, regulatory bodies and enterprise auditors demand non-repudiation: proof that historical claims, policy evaluations, and approvals were not secretly altered by database administrators, rogue applications, or compromised servers.

---

## 2. Alternatives Considered

### Alternative A: Separate PostgreSQL Database per Tenant
- Provision an isolated database for every enterprise customer.
- **Pros**: Complete physical isolation; impossible to accidentally query another tenant's tables.
- **Cons**: High operational overhead; slow tenant onboarding; database connection exhaustion; difficult schema migrations across hundreds of tenant databases.

### Alternative B: Application-Level Tenant Filtering Only (`WHERE tenant_id = ?`)
- Shared database where developers remember to add `WHERE tenant_id = ctx.tenantId` to every query.
- **Pros**: Easy to implement initially.
- **Cons**: Catastrophically prone to developer error; a single missing `WHERE` clause leaks cross-tenant data.

### Alternative C: Defense-in-Depth RLS + Cryptographic Merkle Audit Ledger (Chosen)
- Shared database with **kernel-enforced PostgreSQL Row-Level Security (RLS)**.
- Every table has a mandatory `tenant_id` foreign key.
- Database connection sessions set `SET LOCAL app.current_tenant_id = :tenant_id`, enforcing access boundaries at the query planner level.
- Audit records form an immutable linear SHA-256 hash chain sealed into hourly Merkle checkpoints and signed with tenant keys.
- **Pros**: Strong defense-in-depth; protection against developer query bugs; high operational efficiency; mathematically verifiable audit non-repudiation.
- **Cons**: RLS policies must be tested comprehensively for all query types, including joins.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative C: PostgreSQL Row-Level Security with Cryptographic Merkle Audit Chains**.

This implements the requirements of Operating Rule 17 (*"Enforce tenant access on the server and in the database. Never trust tenant IDs supplied by an untrusted client"*) and Operating Rule 20 (*"Preserve historical versions. Never silently overwrite history"*).

---

## 4. Consequences & Trade-offs

### Positive Consequences
- Zero cross-tenant data leakage even if an application controller has an authorization bug.
- Complete audit non-repudiation: any tampering with historical audit rows breaks the Merkle tree root and is immediately detected by offline verification tools.
- Single database schema simplifies migrations and connection pooling.

### Negative Consequences / Risks
- Developers must ensure background workers explicitly set `app.current_tenant_id` on pooled connections before executing tenant queries.
- Bypassing RLS requires superuser privileges; application database users must **never** be granted superuser or `BYPASSRLS` attributes.

---

## 5. Reconsideration Triggers
This decision will be formally reconsidered if:
1. Specific sovereign government clients require physical database air-gapping that legally prohibits shared cluster storage.
