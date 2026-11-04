# Architecture Documentation

This directory documents the structural design, component boundaries, domain interfaces, and communication flows of ProofMesh.

## Key Focus Areas
- **System Overview & Context**: High-level block diagrams and context diagrams illustrating ProofMesh within an enterprise AI ecosystem.
- **Domain-Driven Design (DDD) Boundaries**: Pure domain models, application services, and external port/adapter definitions.
- **Asynchronous Telemetry & Ingestion**: Event pipeline architecture, message broker contracts, and decoupling mechanisms.
- **Enforcement & Policy Engine**: Synchronous and asynchronous policy evaluation pipelines, fail-open/closed hooks, and decision caching.
