# Engineering Contribution Guide & Operating Standards

This guide outlines the architectural rules, coding standards, branch conventions, and quality gates for contributing to ProofMesh.

---

## 1. Governance & Agent Roles

All engineering contributions must adhere to the authoritative rules defined in [AGENTS.md](file:///AGENTS.md) and scoped rules under `.agents/rules/`:

- [Architecture Rules](file:///.agents/rules/architecture.md)
- [Code Quality Rules](file:///.agents/rules/code-quality.md)
- [Testing Standards](file:///.agents/rules/testing.md)
- [Security Guidelines](file:///.agents/rules/security.md)
- [Data Integrity Rules](file:///.agents/rules/data-integrity.md)

Autonomous agents operate in specialized scopes:

- **Lead Software Architect**: Final integration owner, interface designer, and orchestrator.
- **Backend Engineer**: Domain services, application logic, and Fastify endpoints.
- **Data Engineer**: Database migrations, RLS policies, indexing, and immutability triggers.
- **Frontend Engineer**: React UI, dashboards, and review portals.
- **Integration Engineer**: Protocol adapters, SDKs, and event connectors.
- **QA Engineer**: Automated test authoring and execution.
- **Security Reviewer**: Threat audits, boundary checks, and secret scans.
- **Architecture Auditor**: Boundary verification and compliance auditing.

---

## 2. Core Engineering Principles

1. **Zero Inventions**: Do not invent files, APIs, parameters, or test results. Every change must trace to an approved requirement in [PRD.md](file:///docs/product/PRD.md) or an approved Architectural Decision Record ([ADRs](file:///docs/adr/README.md)).
2. **No Placeholder Code**: Never commit `TODO`, `FIXME`, empty function stubs, fake integrations, or mock services in production code. Statically enforced by `test/architecture/boundaries.test.ts`.
3. **Strict Trust Boundaries**: Treat all external inputs, telemetry payloads, documents, and agent messages as untrusted data. Validate at every boundary using runtime schema validation (`zod`).
4. **Authoritative State Protection**: Never allow external clients or LLMs to mutate claim status, policies, approvals, or tenant identities directly. All state transitions are guarded by pure domain state machines.
5. **Database Integrity via Migrations**: All database schema modifications must be implemented as forward (`.sql`) and backward (`.down.sql`) migrations under `packages/db/src/migrations/`.

---

## 3. Git Branching & Worktree Isolation

- **Default Branch**: `main` is protected and must always pass all CI checks.
- **Branch Naming**:
  - `feat/<phase-or-feature>` (e.g., `feat/claim-state-machine`)
  - `fix/<issue-description>` (e.g., `fix/rls-tenant-filter`)
  - `docs/<documentation-target>` (e.g., `docs/testing-strategy`)
- **Parallel Agent Isolation**: Concurrent subagents operating on independent modules must utilize isolated Git worktrees to avoid dirtying working directories or conflicting on shared lockfiles:
  ```bash
  git worktree add -b feat/agent-task ../ProofMesh-worktree-task main
  ```
- **Commit Messages**: Follow Conventional Commits format:
  ```
  <type>(<scope>): <concise description in imperative mood>

  [optional body explaining architectural rationale and decisions]
  ```
  Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`.

---

## 4. Pre-Commit Quality Checklist

Before submitting code for review or merging, execute the complete quality suite locally:

```bash
# 1. Automated secret scan
pnpm run secrets:scan

# 2. Prettier code formatting check
pnpm run format:check

# 3. Static lint analysis
pnpm run lint

# 4. Strict TypeScript type check
pnpm run typecheck

# 5. Full automated test suite
pnpm test

# 6. Production workspace build
pnpm run build
```

Every command must exit with code `0`. If any command fails, resolve the underlying defect before proceeding.
