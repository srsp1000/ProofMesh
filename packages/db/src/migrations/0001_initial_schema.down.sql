-- Rollback script for 0001_initial_schema.sql

DROP TRIGGER IF EXISTS trg_evidence_items_immutable ON evidence_items;
DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
DROP FUNCTION IF EXISTS block_mutation_on_immutable_table();

DROP TABLE IF EXISTS inbox_events CASCADE;
DROP TABLE IF EXISTS outbox_events CASCADE;
DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS typed_dependency_edges CASCADE;
DROP TABLE IF EXISTS assessment_versions CASCADE;
DROP TABLE IF EXISTS claim_evidence_links CASCADE;
DROP TABLE IF EXISTS evidence_items CASCADE;
DROP TABLE IF EXISTS source_versions CASCADE;
DROP TABLE IF EXISTS source_artifacts CASCADE;
DROP TABLE IF EXISTS claim_versions CASCADE;
DROP TABLE IF EXISTS claim_concepts CASCADE;
DROP TABLE IF EXISTS principals CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
