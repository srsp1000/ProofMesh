# ADR-0007: Client SDK & Framework Adapter Strategy

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Integration Engineer, Backend Engineer  

---

## 1. Context & Problem Statement
AI developers use diverse frameworks (LangChain, LlamaIndex, Semantic Kernel, Model Context Protocol, raw OpenAI/Anthropic SDKs). ProofMesh must integrate smoothly into these developer workflows without forcing engineering teams to write repetitive boilerplate.

The team must determine whether to author separate custom client libraries for each ecosystem or build a single canonical core SDK with lightweight integration hooks.

---

## 2. Alternatives Considered

### Alternative A: Independent Ecosystem Libraries
- Build and maintain standalone libraries: `@proofmesh/langchain`, `@proofmesh/llamaindex`, `@proofmesh/mcp`, `@proofmesh/client`.
- **Pros**: Idiomatic API design per framework.
- **Cons**: Massive maintenance burden; duplicate business logic across SDKs violating Operating Rule 5; version drift and inconsistent error handling.

### Alternative B: Canonical Core SDK with Thin Adapter Extensions (Chosen)
- Build a single, zero-dependency canonical core SDK (`@proofmesh/sdk` in TypeScript, `proofmesh` in Python) providing typed clients, automatic retries, buffering, and fail-open/closed hooks.
- Provide thin, pluggable middleware adapters (e.g. `proofmesh/integrations/langchain`) that translate framework lifecycle callbacks into standard SDK calls.
- **Pros**: Single codebase to test, secure, and maintain; consistent authentication and error semantics; zero framework bloat in core SDK.
- **Cons**: Developers using specialized frameworks install the core SDK plus the lightweight adapter.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative B: Canonical Core SDK with Thin Adapter Extensions**.

This satisfies Operating Rule 5 (*"reuse an existing implementation when it is correct; do not create duplicate utilities"*) and Operating Rule 6 (*"keep business rules in application services, not duplicated in SDKs"*). 

The SDK remains lean, focusing exclusively on transport, authentication, schema validation, and fail-open/closed policies. Framework adapters simply map framework callback events (e.g., `on_tool_start`, `on_llm_end`) into canonical ProofMesh calls.

---

## 4. Consequences & Trade-offs

### Positive Consequences
- High reliability: core transport, retries, and cryptographic hashing are tested in a single library.
- Rapid support for new AI frameworks by writing only a 100-line callback mapper.
- Zero unnecessary dependencies in client applications.

### Negative Consequences / Risks
- Rapid breaking changes in third-party frameworks (e.g. LangChain minor version upgrades) require ongoing adapter compatibility testing.

---

## 5. Reconsideration Triggers
This decision will be formally reconsidered if:
1. Python or Go client adoption requires native idiomatic implementations that cannot share design patterns with the TypeScript core.
