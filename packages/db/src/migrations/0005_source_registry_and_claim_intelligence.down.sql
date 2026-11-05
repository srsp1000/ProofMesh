-- Rollback Migration: 0005_source_registry_and_claim_intelligence.down.sql

DROP TABLE IF EXISTS claim_corrections;
DROP TABLE IF EXISTS claim_propositions;
DROP TABLE IF EXISTS claim_occurrences;
DROP TABLE IF EXISTS source_snapshots;
DROP TABLE IF EXISTS source_passages;

ALTER TABLE source_versions
    DROP COLUMN IF EXISTS raw_text,
    DROP COLUMN IF EXISTS parser_metadata,
    DROP COLUMN IF EXISTS extraction_status,
    DROP COLUMN IF EXISTS http_validators,
    DROP COLUMN IF EXISTS retrieval_timestamp,
    DROP COLUMN IF EXISTS publication_date,
    DROP COLUMN IF EXISTS version_identifiers;

ALTER TABLE source_artifacts
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS metadata,
    DROP COLUMN IF EXISTS retention_state,
    DROP COLUMN IF EXISTS permission_context,
    DROP COLUMN IF EXISTS issuer,
    DROP COLUMN IF EXISTS source_type,
    DROP COLUMN IF EXISTS resolved_uri,
    DROP COLUMN IF EXISTS original_uri;
