# Testing Rules

These rules govern automated testing, verification harnesses, and quality baselines for ProofMesh.

## 1. Comprehensive Test Coverage

- **End-to-End Verification**: Do not mark a feature or phase complete unless it functions end-to-end and has comprehensive automated tests.
- **Contract & Integration Tests**: Verify public APIs, event payloads, and external interfaces with strict contract tests.
- **Edge Cases & Failure Paths**: Systematically test malformed payloads, invalid authorizations, boundary conditions, timeouts, and error handling.

## 2. Integrity of Test Suites

- **Never Weaken Tests**: Never delete, disable, skip, or weaken an existing test assertion simply to make a build or CI pass. If a test fails, fix the implementation or justify and document an authorized test update.
- **Strict Mock Isolation**: Mocks are permitted ONLY within explicitly named test directories and test fixtures (`test/`, `*.spec.ts`, `*.test.ts`, `fixtures/`). Mocks must never be imported into or bundled with production runtime code.
- **No Fake Integrations**: Test mocks must never be presented as production implementations.

## 3. Measurable Evidence

- **Report Measured Results Only**: Never claim a test passed or a feature works without verifiable evidence. Always provide exact command lines, exit codes, passed/failed test counts, and coverage reports.
