---
name: release-readiness
description: Guides release readiness assessments, migration audits, documentation traceability, and operational checklist verification.
---

# Release Readiness Procedure

Use this skill before releasing a phase milestone, tagging a release version, or promoting changes to production.

## Release Readiness Checklist

### 1. Requirements Traceability

- Ensure every requirement in the phase specification links to corresponding code, tests, and documentation.
- Update `docs/product/traceability-matrix.md` with status, test coverage references, and completion dates.

### 2. Architectural & ADR Compliance

- Verify all architecture changes have approved ADRs in `docs/adr/`.
- Confirm no unapproved public API contract modifications occurred.
- Check that the `architecture-auditor` has signed off on the phase implementation.

### 3. Database Migration Safety

- Confirm migrations are non-destructive and backward-compatible.
- Verify migrations have been tested against production-like schemas with rollback scripts verified.
- Confirm zero manual database changes are needed.

### 4. Operational & Observability Readiness

- Verify structured logging, error tracking, and metrics are instrumented.
- Ensure health check endpoints (`/healthz`, `/livez`) reflect internal dependencies accurately.
- Document configuration parameters, environment variables, and fail-open/fail-closed behaviors in `docs/operations/`.

### 5. Final Phase Report & Sign-Off

- Publish the comprehensive phase report in `docs/phase-reports/`.
- Provide exact test command outputs, benchmark evidence, and security sign-off.
