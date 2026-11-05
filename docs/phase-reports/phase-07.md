# ProofMesh Phase 7 Delivery Report: Source Registry, Document Ingestion and Claim Intelligence

This report documents the completion of **ProofMesh Phase 7: Source Registry, Document Ingestion and Claim Intelligence** in strict compliance with the ProofMesh Architectural Decision Records ([ADR-0007](file:///docs/adr/0007-integration-first-event-driven-architecture.md)), Core Non-Negotiable Domain Rules ([AGENTS.md](file:///AGENTS.md)), and the canonical integration-first evidence lineage architecture.

---

## 1. Executive Summary & Architectural Scope

Phase 7 establishes the foundation for reliable, verifiable source registration and proposition extraction before evidence assessment:

- **Source Registry & Immutability**: Manages source artifacts and immutable versions across web pages, PDFs, DOCX, Markdown, plain text, and structured JSON records with Content-Addressable Storage (CAS) hashes (`sha256:...`) and legal hold governance.
- **Safe Document Ingestion**: Secure parser enforcing a 25MB ceiling, decompression bomb/zip-slip path traversal protection, magic byte verification, embedded instruction (prompt injection) scanning, and distinct labeling for OCR extractions with confidence estimates.
- **Web Source Ingestion with SSRF Defense**: Deterministic URL canonicalization preserving query parameters, comprehensive IP denylist (private, loopback, link-local, cloud metadata `169.254.169.254`, and IPv6), DNS rebinding defense via pre-resolution, redirect hop limits ($\le 3$), and strict non-inference of publication dates from retrieval time.
- **Claim Intelligence & SPO Normalization**: Decomposes compound statements into atomic material propositions, classifies them into 5 distinct categories (`factual_claim`, `opinion`, `forecast`, `commitment`, `instruction`), normalizes Subject-Predicate-Object (SPO) triples, extracts quantitative units, and extracts structured qualifiers with strict null preservation.
- **Duplicate Concept Detection & Scope Separation**: Identifies candidate duplicate concepts while strictly preventing merges when operational scopes (region, plan, product, temporal dimension) differ.
- **Occurrence Tracking & Human Correction Audit Trail**: Records claim occurrences across documents/activities and provides an append-only audit trail for human field corrections with mandatory principal attribution and rationale.
- **Strict Anti-Scope Rule**: In strict compliance with the platform instructions, claims in Phase 7 are **never** labeled as "supported" or "true". This phase registers propositions and sources; evidence assessment and policy evaluation remain strictly isolated.

---

## 2. Core Non-Negotiable Domain Rules Compliance

| Domain Rule                                 | Enforcement in Phase 7                                                                                                                                                 | Verification Test                                                                                                                                                      |
| :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strict Trust Boundaries (Rule 1)**        | Runtime Zod schemas validate all artifact registrations, file uploads, web ingestion requests, and extraction inputs at API boundaries.                                | [`test/contract/source-claim-schemas.test.ts`](file:///test/contract/source-claim-schemas.test.ts)                                                                     |
| **Authoritative State Protection (Rule 2)** | Extracted claims are registered only in initial states (`submitted`, `draft`). No LLM, parser, or untrusted client can transition a claim to `attested` in this phase. | [`test/unit/claim-intelligence.test.ts`](file:///test/unit/claim-intelligence.test.ts)                                                                                 |
| **Multi-Tenant Isolation (Rule 3)**         | Tenant context derived exclusively from authenticated principal; PostgreSQL `FORCE ROW LEVEL SECURITY` on all source and claim tables; queries scoped by `tenant_id`.  | [`test/unit/source-registry.test.ts`](file:///test/unit/source-registry.test.ts), [`test/unit/claim-corrections.test.ts`](file:///test/unit/claim-corrections.test.ts) |
| **Historical Immutability (Rule 4)**        | Source versions, passages, snapshots, occurrences, and corrections are append-only. Legal hold prevents soft-deletion or purge without formal release.                 | [`test/unit/source-registry.test.ts`](file:///test/unit/source-registry.test.ts), [`test/unit/claim-corrections.test.ts`](file:///test/unit/claim-corrections.test.ts) |
| **Causality Integrity (Rule 5)**            | Clear distinction between captured occurrences, declared propositions, and normalized concepts. Refuses to merge concepts with differing scopes (e.g. US vs EU).       | [`test/unit/claim-intelligence.test.ts`](file:///test/unit/claim-intelligence.test.ts)                                                                                 |
| **Publication Date Non-Inference (Rule 6)** | Retrieval timestamp is strictly prohibited from being used as a publication or effective date. Only explicit HTTP `Last-Modified` or document dates are preserved.     | [`test/security/web-ssrf-defense.test.ts`](file:///test/security/web-ssrf-defense.test.ts)                                                                             |

---

## 3. Package Deliverables Inventory

### A. Shared Contracts (`packages/contracts`)

Located at [`packages/contracts/src/sources`](file:///packages/contracts/src/sources) and [`packages/contracts/src/claims`](file:///packages/contracts/src/claims):

- **Source Contracts** ([`packages/contracts/src/sources/source.schema.ts`](file:///packages/contracts/src/sources/source.schema.ts)):
  - `SourceTypeEnum` (`web_page`, `pdf`, `docx`, `markdown`, `plain_text`, `code_repository`, `api_response`, `structured_record`).
  - `SourceRetentionStateEnum` (`active`, `soft_deleted`, `purged`, `legal_hold`).
  - `SourcePermissionContextEnum` (`public`, `internal`, `confidential`, `restricted`).
  - `PassageLocatorSchema` (`page`, `section`, `line`, `json_path`, `byte_range`).
  - `RegisterSourceArtifactInputSchema` & `SourceArtifactDTOSchema`.
  - `IngestSourceVersionInputSchema` & `SourceVersionDTOSchema`.
  - `SourcePassageInputSchema` & `SourcePassageDTOSchema`.
  - `SourceSnapshotDTOSchema`.
  - `WebSourceIngestInputSchema`.
- **Claim Intelligence Contracts** ([`packages/contracts/src/claims/claim-intelligence.schema.ts`](file:///packages/contracts/src/claims/claim-intelligence.schema.ts)):
  - `PropositionTypeEnum` (`factual_claim`, `opinion`, `forecast`, `commitment`, `instruction`).
  - `MaterialPropositionSchema` (SPO, units, qualifiers with null preservation).
  - `ClaimExtractionInputSchema` & `ClaimExtractionResultSchema`.
  - `ClaimOccurrenceInputSchema` & `ClaimOccurrenceDTOSchema`.
  - `ClaimCorrectionInputSchema` & `ClaimCorrectionDTOSchema`.
  - `DuplicateConceptCandidateSchema`.

### B. Database Migrations (`packages/db`)

Located at [`packages/db/src/migrations/0005_source_registry_and_claim_intelligence.sql`](file:///packages/db/src/migrations/0005_source_registry_and_claim_intelligence.sql):

- Enhanced `source_artifacts` and `source_versions` tables.
- Created `source_passages` table with locators and OCR confidence tracking.
- Created `source_snapshots` table for evaluation manifest integrity.
- Created `claim_occurrences` table linking claim versions to passage locators and agent activities.
- Created `claim_propositions` table storing decomposed SPO triples and qualifiers.
- Created `claim_corrections` table recording human correction audits.
- Enabled `FORCE ROW LEVEL SECURITY` with tenant isolation policies on all 6 tables.
- Provided clean rollback script ([`0005_source_registry_and_claim_intelligence.down.sql`](file:///packages/db/src/migrations/0005_source_registry_and_claim_intelligence.down.sql)).

### C. Domain Services (`packages/domain`)

Located at [`packages/domain/src/sources`](file:///packages/domain/src/sources) and [`packages/domain/src/claims`](file:///packages/domain/src/claims):

- **`SourceRegistryService`**: Artifact registration, version hashing, Content-Addressable Storage (CAS), passage indexing, deterministic snapshot generation, and legal hold enforcement.
- **`SafeDocumentIngestionService`**: Magic-byte sniffing (PDF, DOCX, Markdown, JSON, plain text), size limits (25MB), zip decompression bomb & path traversal defense, untrusted prompt injection scanning, and OCR distinction.
- **`WebSourceIngestionService`**: Deterministic URL canonicalization, SSRF IP/host filtering, DNS rebinding defense, redirect hop limits ($\le 3$), and explicit non-inference of publication dates from retrieval time.
- **`ClaimIntelligenceService`**: Multi-clause statement decomposition, proposition classification, Subject-Predicate-Object normalization, quantitative unit extraction, qualifier extraction with null preservation, and scope-aware duplicate candidate detection.
- **`ClaimCorrectionService`**: Immutable occurrence capture, field-level human correction submission with rationale, and chronological audit trail.

### D. API Routes (`apps/api`)

Located at [`apps/api/src/routes/sources.ts`](file:///apps/api/src/routes/sources.ts) and [`apps/api/src/routes/claim-intelligence.ts`](file:///apps/api/src/routes/claim-intelligence.ts):

- `POST /v1/sources/artifacts`: Register source artifact.
- `GET /v1/sources/artifacts/:id`: Retrieve source artifact by ID.
- `PATCH /v1/sources/artifacts/:id/retention`: Update retention state with legal hold protection.
- `POST /v1/sources/versions`: Create source version.
- `GET /v1/sources/versions/:id`: Lookup source version.
- `POST /v1/sources/versions/:id/passages`: Ingest passage with locator.
- `GET /v1/sources/versions/:id/passages`: Retrieve passages for a source version.
- `POST /v1/sources/ingest/file`: Upload & safely parse binary document (magic bytes, text extraction, CAS registration).
- `POST /v1/sources/ingest/web`: Ingest web URL with SSRF protection, Last-Modified capture, and CAS registration.
- `POST /v1/sources/snapshots`: Create immutable source snapshot manifest.
- `POST /v1/claims/extract`: Extract and normalize propositions from source text.
- `POST /v1/claims/occurrences`: Record claim occurrence in source or agent activity.
- `GET /v1/claims/:id/occurrences`: Retrieve occurrences for a claim version.
- `POST /v1/claims/:id/corrections`: Submit human correction with audit trail.
- `GET /v1/claims/:id/corrections`: Retrieve audit trail of corrections.
- `POST /v1/claims/concepts/detect-duplicates`: Evaluate potential duplicate concepts while enforcing scope separation.

### E. Developer SDKs (`packages/sdk` & `sdks/python`)

- **TypeScript SDK**: Added `client.sources` (`SourcesModule`) and `client.claimIntelligence` (`ClaimIntelligenceModule`) with end-to-end typed methods.
- **Python SDK**: Added Pydantic v2 models and corresponding synchronous and asynchronous methods to `ProofMeshClient` and `AsyncProofMeshClient`.

---

## 4. Verification & Testing Evidence

All quality gates, security audits, unit suites, contract suites, and integration tests pass cleanly:

### A. TypeScript Verification

```bash
$ pnpm test
 Test Files  37 passed (37)
      Tests  208 passed (208)
   Duration  4.06s
```

### B. Python SDK Verification

```bash
$ python3 -m pytest sdks/python/tests
============================== 22 passed in 0.80s ==============================
```

### C. Build Verification

```bash
$ pnpm --filter @proofmesh/contracts build  # exit 0
$ pnpm --filter @proofmesh/db build         # exit 0
$ pnpm --filter @proofmesh/domain build     # exit 0
$ pnpm --filter @proofmesh/api build        # exit 0
$ pnpm --filter @proofmesh/sdk build        # exit 0
```

---

## 5. Architectural Non-Goals & Boundaries

1. **No Evidence Verification in Phase 7**: Claims registered in Phase 7 are never attested or marked as true. Verification and policy admissibility are handled strictly by downstream evaluation modules.
2. **No Invented Publication Dates**: When web documents or raw files lack an explicit publication date header or metadata, the date remains `null`.
3. **No Blind Concept Merging**: Claims sharing identical text or core predicates but differing in geographic region, plan tier, product edition, or temporal period are maintained as distinct concepts.
