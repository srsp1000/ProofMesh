# ADR-0004: Durable Workflow Orchestration Strategy (Temporal vs. Database State Machine)

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Backend Engineer, Integration Engineer  

---

## 1. Context & Problem Statement
ProofMesh manages human review cases, multi-party approval quorums, dispute resolutions, and automated remediation tasks. These governance workflows can remain active for days, weeks, or months, requiring durable timers, reminder notifications, escalation logic, and rollback sagas.

The team must determine how to orchestrate these long-running workflows without introducing unsustainable operational complexity.

---

## 2. Alternatives Considered

### Alternative A: Full Temporal Deployment from Phase 1
- Deploy a Temporal Server cluster (Frontend, Matching, History, Worker) backed by PostgreSQL to orchestrate all review workflows via Temporal Go/TypeScript SDKs.
- **Pros**: Native durable state machines, timers, deterministic history replay, built-in retry backoffs.
- **Cons**: High operational complexity (requires tuning history shards, managing gRPC connection pools, and operating multiple cluster daemons); excessive infrastructure overhead for initial vertical slice delivery.

### Alternative B: PostgreSQL-Driven State Machine Engine (Initial Tier)
- Implement durable workflows using PostgreSQL tables (`review_cases`, `approval_requests`, `workflow_timers`) with transaction-safe state machines and scheduled cron workers.
- **Pros**: Zero additional infrastructure dependencies; fully integrated into existing PostgreSQL backup/restore; transparent SQL auditing.
- **Cons**: Complex custom timer and saga logic must be authored and maintained by the engineering team.

### Alternative C: Two-Tier Strategy (Chosen)
- **Phase 1–3 (Core Platform)**: Implement workflow states directly in PostgreSQL using deterministic state machines and scheduled polling workers.
- **Phase 4–5 (Enterprise Governance)**: Provide a clean abstraction adapter allowing enterprise deployments to plug into Temporal for complex multi-week human approval workflows.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative C: Two-Tier Workflow Strategy**.

This respects Operating Rule 4 (*"avoid premature optimization and needless infrastructure"*) and Rule 24 (*"avoid premature introduction of complex infrastructure"*). 

The initial core releases will use lightweight, reliable PostgreSQL-backed state machines. An explicit domain interface (`WorkflowOrchestratorPort`) will ensure that when Temporal is integrated in Tier 2, the underlying domain logic remains completely untouched.

---

## 4. Consequences & Trade-offs

### Positive Consequences
- Low operational cost and immediate setup simplicity for early development and customer trials.
- Clean architectural seam for enterprise Temporal adoption without rewriting domain code.

### Negative Consequences / Risks
- Multi-day workflow timers in Phase 1 rely on database scheduler crons rather than native Temporal timers.
- Engineers must carefully model distributed timeouts and cancellation in SQL.

---

## 5. Reconsideration Triggers
This decision will be formally reconsidered if:
1. Workflow logic requires complex multi-step sagas across multiple external enterprise approval systems.
2. The number of concurrent active human review cases exceeds 50,000 per tenant.
