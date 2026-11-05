# ProofMesh Agent & Engineering Governance

This document is the authoritative repository-wide instruction and governance guide for ProofMesh engineering agents and contributors. All agents and subagents operating within this repository must strictly adhere to the policies and workflows outlined here.

---

## 1. Product Context & Authority

ProofMesh is an integration-first evidence-to-decision governance platform for AI-powered applications.

- The **ProofMesh Implementation Playbook** and approved project documents in `docs/` serve as the absolute product source of truth.
- If existing code or proposals conflict with the product specifications, report the conflict and propose an Architectural Decision Record (ADR) under `docs/adr/`. Never silently choose an alternative.

---

## 2. Core Non-Negotiable Domain Rules

1. **Strict Trust Boundaries**: Treat all external inputs, telemetry payloads, documents, prompts, tool outputs, and agent messages as untrusted data. Validate at every boundary using runtime schema validation.
2. **Authoritative State Protection**: Never allow an LLM or untrusted client to directly mutate authoritative claim status, policies, approvals, tenant identities, permissions, or audit records. All state transitions must be executed by trusted domain/application services.
3. **Multi-Tenant Isolation**: Enforce tenant access control on the server and at the database layer (e.g., Row-Level Security or tenant-scoped queries). Never trust tenant IDs supplied by external clients or agents.
4. **Historical Immutability**: Historical claims, evidence, decisions, evaluation runs, and audit logs are append-only. Never overwrite or destructively modify historical records.
5. **Causality Integrity**: Telemetry and observation do not inherently prove causality. Clearly distinguish between **captured**, **declared**, **attested**, **inferred**, and **unknown** relationships.
6. **Asynchronous Observation**: Observation and event telemetry ingestion must be asynchronous and non-blocking by default. Synchronous policy enforcement is permitted only when explicitly configured with documented fail-open or fail-closed behavior.
7. **Idempotent Ingestion**: Event ingestion and side effects must be idempotent. Assume message transport is at-least-once.

---

## 3. Engineering Operating Rules

- **Zero Inventions**: Do not invent files, functions, dependencies, CLI commands, environment variables, APIs, or test outputs.
- **Official Documentation**: Before adopting an external dependency or platform API, verify its official documentation and compatibility with the host runtime.
- **No Incomplete Implementations**: Never leave TODO-only code, empty function stubs, fake integrations, mock services in production paths, or swallowed exceptions.
- **Legitimate Testing**: Mocks are strictly confined to test fixtures (`*.test.ts`, `*.spec.ts`, `fixtures/`). Never weaken or delete existing tests to pass builds.
- **Traceable Changes**: No public API, schema, or architectural contract change may occur without updating corresponding documentation, tests, and ADRs.
- **Database Migrations**: All schema modifications must occur via versioned database migrations.

---

## 4. Multi-Agent Orchestration & Roles

The Lead Software Architect is the sole integration owner and final decision maker. Specialized subagents operate in dedicated scopes:

| Subagent Role            | Definition File                                                           | Primary Responsibility                                              | Permissions           |
| :----------------------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------ | :-------------------- |
| **Research Analyst**     | [research-analyst.md](file:///.agents/agents/research-analyst.md)         | External API research, platform compatibility, standards lookup     | Read-only             |
| **Architecture Auditor** | [architecture-auditor.md](file:///.agents/agents/architecture-auditor.md) | Architectural integrity, ADR compliance, boundary validation        | Read-only             |
| **Security Reviewer**    | [security-reviewer.md](file:///.agents/agents/security-reviewer.md)       | Threat modeling, injection testing, tenant isolation verification   | Read-only             |
| **QA Engineer**          | [qa-engineer.md](file:///.agents/agents/qa-engineer.md)                   | Integration tests, edge case suites, regression harnesses           | Read & Test execution |
| **Backend Engineer**     | [backend-engineer.md](file:///.agents/agents/backend-engineer.md)         | Core domain services, application logic, migrations, strict APIs    | Code implementation   |
| **Data Engineer**        | [data-engineer.md](file:///.agents/agents/data-engineer.md)               | Event ingestion pipelines, transactional stores, audit immutability | Code implementation   |
| **Integration Engineer** | [integration-engineer.md](file:///.agents/agents/integration-engineer.md) | External connectors, webhooks, fail-open/fail-closed adapters       | Code implementation   |
| **Frontend Engineer**    | [frontend-engineer.md](file:///.agents/agents/frontend-engineer.md)       | Governance dashboards, evidence explorers, human review flows       | UI implementation     |

### Multi-Agent Git Isolation

- Parallel implementation agents must operate in isolated Git worktrees.
- Concurrent agents must never edit shared contracts or the same files simultaneously.
- Every agent must report: changed files, architectural rationale, tests run, test output, limitations, and commit/branch identifier.

---

## 5. Directory & Rules Structure

- **Scoped Rules**: Detailed constraints are organized under [`.agents/rules/`](file:///.agents/rules/):
  - [`code-quality.md`](file:///.agents/rules/code-quality.md)
  - [`architecture.md`](file:///.agents/rules/architecture.md)
  - [`testing.md`](file:///.agents/rules/testing.md)
  - [`security.md`](file:///.agents/rules/security.md)
  - [`data-integrity.md`](file:///.agents/rules/data-integrity.md)
- **Reusable Skills**: Operational runbooks are located in [`.agents/skills/`](file:///.agents/skills/):
  - [`phase-implementation`](file:///.agents/skills/phase-implementation/SKILL.md)
  - [`phase-verification`](file:///.agents/skills/phase-verification/SKILL.md)
  - [`security-review`](file:///.agents/skills/security-review/SKILL.md)
  - [`release-readiness`](file:///.agents/skills/release-readiness/SKILL.md)
- **Documentation**: All architectural artifacts, ADRs, and reports are baselined under [`docs/`](file:///docs/).
