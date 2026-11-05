---
name: security-review
description: Guides security audits and threat modeling across code changes, focusing on multi-tenant isolation, prompt injection defense, and cryptographic integrity.
---

# Security Review Procedure

Use this skill when conducting a security audit of code changes, architecture updates, or before release.

## Audit Workflow

### Step 1: Multi-Tenant Boundary Audit

1. Verify that all data access queries, cache keys, and storage paths include the authenticated tenant context.
2. Confirm that tenant identity is derived solely from verified server authentication (e.g., JWT claims, verified API session) and never from user-supplied request body or URL parameters.
3. Validate database policies (Row-Level Security) or query scoping across all persistence operations.

### Step 2: Untrusted Input & Injection Defense

1. **Schema Validation**: Verify that every endpoint parses incoming data with strict runtime schemas (Zod/Pydantic).
2. **Prompt Injection Mitigation**: Ensure untrusted data fed into LLM prompts is properly escaped or passed via structured data channels, never concatenated into system instructions.
3. **No Authoritative State Mutation by LLMs**: Confirm that model outputs are treated as suggestions/drafts and validated by deterministic application services before state mutation.
4. **Injection Vectors**: Check for SQL injection, SSRF in webhook dispatchers, command injection, and path traversal in artifact storage.

### Step 3: Cryptography & Secret Hygiene

1. Ensure secrets, API keys, and private tokens are loaded exclusively from environment variables or secret managers, never hardcoded.
2. Verify cryptographic hashing (e.g., SHA-256 for evidence hashes) and signature algorithms meet industry standards.
3. Confirm that sensitive fields (PII, credentials, authorization headers) are redacted from logs and error messages.

### Step 4: Security Sign-Off

Document findings in `docs/security/`:

- Risk evaluation summary.
- Confirmed findings and remediation status.
- Sign-off decision (Pass / Pass with Advisory / Block).
