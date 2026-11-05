# API Specifications & Contracts

This directory contains external and internal API contracts, OpenAPI/Swagger specifications, AsyncAPI schemas, and client SDK interface definitions.

## Key Principles

1. **Strict Versioning**: Public contracts follow semantic versioning. Breaking changes require an ADR and deprecation plan.
2. **Runtime Schemas**: API specifications must be synchronized with runtime validation schemas (e.g., Zod).
3. **Tenant & Auth Contracts**: All endpoints must document required authentication scopes and tenant derivation methods.

## Documents

- [API Contract Plan](file:///docs/api/api-contract-plan.md)
- [Canonical Event Contracts](file:///docs/api/event-contracts.md)
- [Schema Evolution & Semantic Versioning](file:///docs/api/schema-evolution.md)
- [Protocol & Platform Adapters Configuration Guide](file:///docs/api/adapters-configuration.md)
