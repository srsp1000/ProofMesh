# ADR-0006: Content Capture, Privacy & Data Redaction Model

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Security Reviewer, Backend Engineer

---

## 1. Context & Problem Statement

ProofMesh captures evidence payloads, telemetry spans, user prompts, and agent completions from AI systems. These data streams frequently contain sensitive Personally Identifiable Information (PII) (e.g., SSNs, credit cards, healthcare records) and corporate secrets (e.g., API keys, bearer tokens).

The platform must provide verifiable governance and auditability without violating global privacy regulations (GDPR, CCPA, HIPAA) or creating toxic data liabilities.

---

## 2. Alternatives Considered

### Alternative A: Full Raw Content Ingestion Without Filtering

- Store all incoming prompts, tool outputs, and document passages verbatim.
- **Pros**: Complete historical context.
- **Cons**: Severe regulatory violation (GDPR Article 5 data minimization); massive risk of storing leaked API tokens and patient/customer PII; unacceptable to enterprise compliance teams.

### Alternative B: Blind Hashing Only (Zero Content Stored)

- Ingest only SHA-256 hashes of prompts and documents; store zero text.
- **Pros**: Complete privacy; zero PII stored.
- **Cons**: Renders human review, evidence verification, and lineage exploration impossible in the UI; compliance officers cannot see what was attested.

### Alternative C: In-Flight PII Redaction + Content-Addressable Encrypted Storage (Chosen)

- Compute a cryptographic SHA-256 digest of the raw stream to preserve provenance.
- Run an in-flight redaction filter that masks standard PII patterns and secrets.
- Store the sanitized payload in tenant-isolated encrypted storage (AES-256-GCM).
- Allow enterprise tenants to optionally supply their own customer-managed KMS keys (BYOK).

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative C: In-Flight Redaction with Content-Addressable Encrypted Storage**.

This guarantees both auditability and privacy compliance. Evidence integrity is anchored to the cryptographic hash, while the human-readable payload is sanitized to prevent toxic data accumulation. Enterprise tenants retain full sovereignty over their encryption keys.

---

## 4. Consequences & Trade-offs

### Positive Consequences

- Compliance with GDPR, CCPA, and HIPAA data minimization mandates.
- Accidental leaks of customer credentials (e.g. `sk-...` OpenAI keys in prompts) are neutralized before writing to disk.
- Lineage DAG and human review portal display meaningful contextual evidence safely.

### Negative Consequences / Risks

- In-flight redaction regex scanning introduces 1–2ms of compute overhead during ingestion.
- Overly aggressive redaction may obscure domain-specific data unless customized per project.

---

## 5. Reconsideration Triggers

This decision will be formally reconsidered if:

1. Specific regulatory frameworks mandate zero-text storage in favor of zero-knowledge proofs.
2. Ingestion latency requirements demand offloading redaction to asynchronous post-processing.
