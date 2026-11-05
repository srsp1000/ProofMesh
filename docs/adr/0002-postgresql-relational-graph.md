# ADR-0002: PostgreSQL Relational Graph Storage vs. Dedicated Graph Database

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Data Engineer, Backend Engineer

---

## 1. Context & Problem Statement

ProofMesh constructs and traverses an immutable, append-only Directed Acyclic Graph (DAG) connecting source artifacts, evidence items, assessments, claims, and decisions.

The team must decide whether to introduce a dedicated graph database (e.g., Neo4j, Amazon Neptune) or model the lineage graph natively within PostgreSQL using an adjacency table and recursive Common Table Expressions (CTEs).

---

## 2. Alternatives Considered

### Alternative A: Dedicated Graph Database (Neo4j / Amazon Neptune)

- Ingest graph edges into a dedicated graph engine with native Cypher query capabilities.
- **Pros**: Native multi-hop graph algorithms; optimized for deep traversals (> 20 hops).
- **Cons**: Requires dual-write synchronization between relational metadata and graph nodes; breaks ACID atomicity; introduces additional stateful infrastructure cost and operational overhead; customer VPC deployments become complex.

### Alternative B: PostgreSQL Adjacency List with Recursive CTEs (Chosen)

- Store nodes as relational entities and edges in a `typed_dependency_edges` table with b-tree indexes on `(tenant_id, source_node_id)` and `(tenant_id, target_node_id)`. Traverse DAGs using PostgreSQL recursive CTEs.
- **Pros**: ACID transactions across claims, assessments, and lineage edges; single datastore to operate, backup, and restore; native Row-Level Security (RLS) enforcement; sub-100ms traversal for depths up to 10 hops.
- **Cons**: Path traversals beyond 15–20 hops require memory tuning and depth-limiting guards.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative B: PostgreSQL Adjacency List with Recursive CTEs**.

Lineage DAG queries in ProofMesh governance typically span 3 to 7 hops (Source Artifact -> Evidence -> Assessment -> Claim -> Decision). PostgreSQL handles this depth in under 20ms using indexed recursive CTEs. Introducing a dedicated graph database violates Operating Rule 4 (_"avoid premature optimization and needless infrastructure"_). Maintaining all lineage data in PostgreSQL guarantees ACID consistency and leverages Row-Level Security without distributed syncing.

---

## 4. Consequences & Trade-offs

### Positive Consequences

- Zero dual-write inconsistency between claim records and lineage edges.
- Row-Level Security automatically isolates graph traversals by tenant.
- Single backup, replication, and disaster recovery pipeline.

### Negative Consequences / Risks

- Queries must enforce depth limits (`LIMIT depth <= 10`) to prevent infinite recursion from malformed cycles.
- Cycle prevention must be enforced at insertion time using transaction-time ancestry checks.

---

## 5. Reconsideration Triggers

This decision will be formally reconsidered if:

1. Average lineage depth exceeds 15 hops across large multi-agent systems.
2. Graph query latency exceeds 250ms at p95 under standard production load.
