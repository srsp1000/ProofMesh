# Security Rules

These rules govern security policies, tenant isolation, access control, and untrusted data handling for ProofMesh.

## 1. Multi-Tenant Isolation
- **Server and Database Enforcement**: Tenant isolation must be enforced on the server and directly at the database layer (e.g., Row-Level Security, mandatory tenant criteria on every query).
- **Never Trust Client Tenant Claims**: Never trust tenant IDs or permissions supplied by an external client, request header, or LLM agent. Tenant identity must be derived exclusively from verified, cryptographically signed authentication credentials.

## 2. Handling Untrusted Data & Model Safety
- **Zero-Trust Input Principle**: Treat all external documents, headers, webhooks, prompts, tool outputs, and model responses as completely untrusted data. Validate and sanitize before ingestion or persistence.
- **Authoritative State Protection**: Never permit an LLM or AI agent to directly mutate authoritative claim status, policies, approvals, tenant identities, permissions, or audit records.
- **Model Output as Drafts**: All model suggestions or evaluations must pass through deterministic domain application services for validation before transitioning system state.

## 3. Cryptography & Secrets Management
- **Modern Cryptography**: Use industry-standard, collision-resistant cryptographic hashing (SHA-256+) and modern signature algorithms (e.g., Ed25519, RSA-PSS).
- **Zero Secrets in Code**: Secrets, private keys, and API tokens must never be hardcoded or checked into version control. Load them strictly via environment variables or secret managers.
- **Data Redaction**: Sensitive personal data, credentials, and authentication tokens must be sanitized from error logs, traces, and public metrics.
