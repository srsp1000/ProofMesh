# ADR-0008: Object Storage & Evidence Snapshotting Strategy

**Date:** 2026-11-04  
**Status:** ACCEPTED  
**Deciders:** Lead Software Architect, Data Engineer, Integration Engineer

---

## 1. Context & Problem Statement

ProofMesh captures evidence payloads, source documents (PDFs up to 50MB), context packets, and compiled audit bundles.

Storing large binary blobs directly in PostgreSQL tables (`bytea`) leads to rapid database bloat, degrades WAL performance, and makes backups/restores expensive. The team must define the storage boundary between relational metadata and binary evidence snapshots.

---

## 2. Alternatives Considered

### Alternative A: Database Blob Storage (`bytea` / Large Objects in PostgreSQL)

- Store all raw evidence payloads directly inside columns in PostgreSQL.
- **Pros**: Single datastore; all data backed up together.
- **Cons**: Massive database bloat; vacuum degradation; slow queries; excessive IOPS costs on database instances.

### Alternative B: S3-Compatible Object Storage with Content-Addressable Storage (CAS) (Chosen)

- Store metadata, entity relationships, and SHA-256 digests in PostgreSQL.
- Stream raw binary payloads (PDFs, large JSON context packets, audit zip files) into an S3-compatible object store (Amazon S3, Google Cloud Storage, or MinIO for local/VPC testing).
- Key files by their content hash: `s3://proofmesh-evidence/<tenant_id>/<sha256_hash>`.
- Enable S3 Object Lock (Compliance Mode) to guarantee WORM (Write Once, Read Many) immutability.
- **Pros**: Unlimited horizontal storage scalability; cheap cold tiering; database remains small, fast, and nimble; regulatory WORM compliance.
- **Cons**: Requires managing an object storage bucket and credentials.

---

## 3. Decision & Technical Rationale

**Decision**: Adopt **Alternative B: S3-Compatible Content-Addressable Storage (CAS)**.

Relational tables in PostgreSQL will store entity attributes, relations, and the authoritative `content_hash` (`sha256:...`). The raw binary content will reside in object storage keyed by `tenant_id` and hash.

Content-addressable storage automatically deduplicates identical evidence files across claims while guaranteeing tamper-evident immutability via S3 Object Lock.

---

## 4. Consequences & Trade-offs

### Positive Consequences

- PostgreSQL database size remains compact and performance remains optimal.
- Storage costs are up to 90% cheaper than database provisioned IOPS.
- S3 Object Lock satisfies enterprise compliance mandates (e.g. SEC Rule 17a-4, FINRA).

### Negative Consequences / Risks

- Deleting test evidence during development requires testing bucket cleanups.
- Uploads and database commits must be orchestrated cleanly (upload blob first, then commit DB reference).

---

## 5. Reconsideration Triggers

This decision will be formally reconsidered if:

1. Average evidence payload size drops below 1KB across 99% of workloads, where inline relational storage might be more efficient.
