---
name: phase-implementation
description: Guides the structured implementation of a project phase, enforcing prerequisites, ADR compliance, vertical slice delivery, and zero placeholder code.
---

# Phase Implementation Procedure

Use this skill whenever starting, executing, or integrating a development phase in ProofMesh.

## Phase Workflow Steps

### Step 1: Pre-Implementation Alignment

1. Read the product requirements in `docs/product/` and approved ADRs in `docs/adr/`.
2. Inspect the existing repository to ensure no duplicate services, utilities, or abstractions already exist.
3. Verify that all external dependencies, platform APIs, and versions are documented and compatible with the runtime.
4. Produce a short implementation plan detailing affected files, dependencies, potential risks, and required tests.

### Step 2: Worktree & Branch Setup

1. For parallel implementation tasks, create an isolated Git branch or worktree:
   ```bash
   git worktree add ../ProofMesh-feature-<phase> -b feature/<phase>
   ```
2. Confirm file ownership boundaries to ensure no two agents modify the same contracts simultaneously.

### Step 3: Vertical Slice Implementation

1. Implement the minimal complete vertical slice satisfying the requirements end-to-end.
2. Maintain strict separation of concerns:
   - Business logic in domain/application services.
   - Controllers/transports handle routing, authentication, and validation only.
3. Validate all inputs at trust boundaries with strict schemas (e.g., Zod).
4. For database changes, author forward-compatible, versioned migrations.
5. **Zero-Placeholder Mandate**: Do not leave TODO comments, mock services in production code, empty handlers, or swallowed exceptions.

### Step 4: Integrated Testing & Local Verification

1. Author unit and integration tests alongside code.
2. Run formatters, linters, type checks, and the full test suite.
3. Verify test coverage and error-handling paths.

### Step 5: Integration & Review

1. Request an independent review from `architecture-auditor` and `security-reviewer`.
2. Address all identified defects before merging into `main`.
3. Update the traceability matrix and relevant documentation.
