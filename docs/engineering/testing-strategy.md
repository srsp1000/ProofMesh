# Testing Strategy & Quality Assurance Framework

This document details the multi-tier testing strategy, test taxonomy, execution commands, and boundary enforcement rules for ProofMesh.

---

## 1. Testing Philosophy & Non-Negotiable Rules

In alignment with [AGENTS.md](file:///AGENTS.md) and [.agents/rules/testing.md](file:///.agents/rules/testing.md), testing in ProofMesh adheres to the following principles:

1. **Legitimate Testing**: Never weaken or delete existing tests to pass builds. Never mock internal domain models or application services in unit tests.
2. **Zero Mocks in Production**: Mocks and test doubles are strictly confined to test fixtures (`test/fixtures/`) and test specs (`*.test.ts`). Production code must never contain conditional mock branches or mock services.
3. **Deterministic Fixtures**: All tests must use reproducible data fixtures. No tests may depend on wall-clock time without deterministic time fakes or external network connectivity.
4. **Automated Boundary Verification**: Architectural constraints, domain isolation, and placeholder detection are verified by automated tests (`test/architecture/boundaries.test.ts`).

---

## 2. Test Taxonomy & Suite Organization

ProofMesh separates tests into distinct categories with dedicated runner commands:

```
test/
├── unit/                 # Pure domain logic, state machines, assessment matrices
├── contract/             # Zod schemas, event envelopes, RFC 7807 problem details
├── integration/          # HTTP API routes, database connectivity, health probes
├── security/             # Environment validation, SQL injection guards, tenant checks
└── architecture/         # Import boundary enforcement, zero-placeholder verification
```

### 1. Unit Tests (`test/unit/`)

- **Scope**: Evaluates pure domain business logic, state machines, and assessment calculations.
- **Rules**: Zero database, network, or transport dependencies. Execution is instantaneous (< 100ms).
- **Current Specs**:
  - `claim-state-machine.test.ts`: Verifies all legal claim transitions (`draft -> submitted -> evaluating -> attested/rejected/disputed -> archived`) and rejects illegal transitions.
  - `assessment-matrix.test.ts`: Verifies evidence assessment matrix logic (`supported`, `refuted`, `inconclusive`, `partially_supported`) and confidence degradation algorithms.
- **Command**: `pnpm run test:unit`

### 2. Contract Tests (`test/contract/`)

- **Scope**: Verifies input/output runtime schemas, event envelopes, and API payloads.
- **Rules**: Validates compliance with CloudEvents specifications, RFC 7807 Problem Details, and API contracts.
- **Current Specs**:
  - `event-envelope.test.ts`: Asserts standard ProofMesh CloudEvents envelope format (`id`, `source`, `type`, `data`, `time`, `datacontenttype`).
  - `claim-schemas.test.ts`: Validates `SubmitClaimSchema`, `TransitionClaimSchema`, and `ProblemDetailsSchema`.
- **Command**: `pnpm run test:contract`

### 3. Integration Tests (`test/integration/`)

- **Scope**: Exercises HTTP server lifecycle, Fastify plugins, routing, and database probes.
- **Rules**: Uses Fastify `.inject()` for lightweight, in-process HTTP requests without binding raw TCP ports.
- **Current Specs**:
  - `api-health.test.ts`: Verifies `/healthz` (liveness), `/readyz` (readiness with database fallback), and `/v1/claims` routes.
- **Command**: `pnpm run test:integration`

### 4. Security Tests (`test/security/`)

- **Scope**: Asserts defense-in-depth security controls, environment parsing, and tenant isolation.
- **Rules**: Validates fail-closed behavior, malformed input rejection, and SQL injection prevention.
- **Current Specs**:
  - `security-boundaries.test.ts`: Validates Zod environment parsing fail-fast rules and verifies `setTenantContext` SQL injection protection.
- **Command**: `pnpm run test:security`

### 5. Architecture Tests (`test/architecture/`)

- **Scope**: Statically verifies codebase boundaries and governance invariants.
- **Rules**: Scans production source files and migrations using Node.js filesystem inspection.
- **Current Specs**:
  - `boundaries.test.ts`:
    - Asserts `packages/domain` contains zero imports from web/transport frameworks.
    - Asserts `packages/contracts` contains zero imports from `packages/db` or `packages/domain`.
    - Asserts zero `TODO`, `FIXME`, `MOCK_DATA`, or `PLACEHOLDER` tokens in production source files.
    - Asserts database migrations enforce PostgreSQL Row-Level Security and immutability triggers.
- **Command**: `pnpm run test:architecture`

---

## 3. Test Runner Commands Reference

| Test Target            | CLI Command                  | Fast Feedback | Description                                      |
| :--------------------- | :--------------------------- | :------------ | :----------------------------------------------- |
| **All Tests**          | `pnpm test`                  | ~1s           | Runs entire test suite across all categories     |
| **Unit Tests**         | `pnpm run test:unit`         | ~300ms        | Runs pure domain logic tests                     |
| **Contract Tests**     | `pnpm run test:contract`     | ~300ms        | Runs schema and event envelope tests             |
| **Integration Tests**  | `pnpm run test:integration`  | ~500ms        | Runs Fastify HTTP route integration tests        |
| **Security Tests**     | `pnpm run test:security`     | ~300ms        | Runs security boundary and injection tests       |
| **Architecture Tests** | `pnpm run test:architecture` | ~300ms        | Runs boundary and zero-placeholder static checks |
| **Coverage**           | `pnpm run test:coverage`     | ~2s           | Generates code coverage metrics                  |

---

## 4. Continuous Integration (CI) Automation

The GitHub Actions CI pipeline (`.github/workflows/ci.yml`) executes all verification gates sequentially on every pull request and push to `main`:

1. `pnpm run secrets:scan`
2. `pnpm run format:check`
3. `pnpm run lint`
4. `pnpm run typecheck`
5. `pnpm test`
6. `pnpm run build`
