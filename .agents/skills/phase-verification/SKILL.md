---
name: phase-verification
description: Guides comprehensive verification of a completed phase, including format, lint, typecheck, unit, integration, contract, and regression testing.
---

# Phase Verification Procedure

Use this skill to execute independent verification and quality auditing before marking any phase or feature complete.

## Verification Checklist & Steps

### Step 1: Static Analysis & Code Quality
1. **Formatting Check**: Verify code complies with repository style rules.
2. **Linting Check**: Run linter without suppressing rules or ignoring warnings.
3. **Type Checking**: Run strict TypeScript/Python type checks (`tsc --noEmit` or `mypy --strict`). Ensure zero type errors.

### Step 2: Automated Test Suite Execution
1. Run unit tests to verify domain service logic and boundary validations.
2. Run integration and contract tests against real test containers or database test instances.
3. Run negative tests: malformed payloads, invalid tokens, cross-tenant injection attempts, duplicate idempotency keys.
4. Verify that no tests were weakened, commented out, or bypassed.

### Step 3: Zero Incomplete Code Audit
Run automated scans to ensure no incomplete code exists in production paths:
```bash
# Check for TODO, FIXME, placeholder, or stub markers in production src
grep -rnE "(TODO|FIXME|XXX|placeholder|mock)" src/ || true
```
*Note: Mocks are strictly permissible only within designated test directories (`test/`, `fixtures/`).*

### Step 4: Verification Report Generation
Generate a structured report under `docs/phase-reports/`:
- Exact command lines executed and exit codes.
- Total tests executed, passed, failed, and skipped.
- Code coverage metrics (line, branch, function).
- Identified defects, severity, and remediation status.
