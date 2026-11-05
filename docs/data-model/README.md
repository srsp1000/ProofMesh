# Data Model & Storage Architecture

This directory documents the database schemas, entity relationship diagrams, append-only ledger designs, and migration strategies.

## Key Principles

1. **Append-Only Immutability**: Historical evidence, claim assessments, and decisions must never be destructively overwritten.
2. **Idempotency & Deduplication**: Event ingestion schemas must store idempotency keys and prevent duplicate processing.
3. **Causality Classification**: Explicitly distinguish between `captured`, `declared`, `attested`, `inferred`, and `unknown` relationships.
4. **Tenant Isolation**: Multi-tenant isolation enforced via schema boundaries or database Row-Level Security (RLS).
