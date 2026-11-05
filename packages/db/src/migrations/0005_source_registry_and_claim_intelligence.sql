-- ProofMesh Phase 7 Migration: 0005_source_registry_and_claim_intelligence.sql
-- Implements Source Artifact Registry, Source Passages, Snapshots, Claim Occurrences, Propositions, and Human Corrections

-- 1. Enhance source_artifacts
ALTER TABLE source_artifacts
    ADD COLUMN IF NOT EXISTS original_uri VARCHAR(2048),
    ADD COLUMN IF NOT EXISTS resolved_uri VARCHAR(2048),
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'web_page',
    ADD COLUMN IF NOT EXISTS issuer VARCHAR(255),
    ADD COLUMN IF NOT EXISTS permission_context VARCHAR(30) NOT NULL DEFAULT 'internal',
    ADD COLUMN IF NOT EXISTS retention_state VARCHAR(30) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

-- Populate original_uri / resolved_uri from legacy uri if empty
UPDATE source_artifacts
SET original_uri = uri, resolved_uri = uri
WHERE original_uri IS NULL;

-- 2. Enhance source_versions
ALTER TABLE source_versions
    ADD COLUMN IF NOT EXISTS version_identifiers JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS publication_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS retrieval_timestamp TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    ADD COLUMN IF NOT EXISTS http_validators JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(30) NOT NULL DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS parser_metadata JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS raw_text TEXT;

-- 3. Source Passages
CREATE TABLE IF NOT EXISTS source_passages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    source_version_id UUID NOT NULL REFERENCES source_versions(id) ON DELETE RESTRICT,
    passage_index INT NOT NULL,
    content_text TEXT NOT NULL,
    content_hash VARCHAR(71) NOT NULL, -- sha256:...
    char_start INT,
    char_end INT,
    locator JSONB NOT NULL DEFAULT '{}',
    extraction_method VARCHAR(30) NOT NULL DEFAULT 'native_text',
    ocr_confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(source_version_id, passage_index)
);

-- 4. Source Snapshots
CREATE TABLE IF NOT EXISTS source_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    snapshot_hash VARCHAR(71) NOT NULL, -- sha256:...
    source_version_ids UUID[] NOT NULL,
    total_byte_size BIGINT NOT NULL DEFAULT 0,
    manifest JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 5. Claim Occurrences
CREATE TABLE IF NOT EXISTS claim_occurrences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    claim_version_id UUID NOT NULL REFERENCES claim_versions(id) ON DELETE RESTRICT,
    source_version_id UUID REFERENCES source_versions(id) ON DELETE RESTRICT,
    source_passage_id UUID REFERENCES source_passages(id) ON DELETE RESTRICT,
    agent_activity_id UUID,
    context_packet_id UUID,
    exact_passage_text TEXT NOT NULL,
    char_start INT,
    char_end INT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 6. Claim Propositions (Atomic decomposed and normalized claims)
CREATE TABLE IF NOT EXISTS claim_propositions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    claim_version_id UUID NOT NULL REFERENCES claim_versions(id) ON DELETE RESTRICT,
    proposition_type VARCHAR(30) NOT NULL, -- factual_claim, opinion, forecast, commitment, instruction
    raw_statement TEXT NOT NULL,
    normalized_subject VARCHAR(255) NOT NULL,
    normalized_predicate VARCHAR(255) NOT NULL,
    normalized_object TEXT NOT NULL,
    normalized_unit VARCHAR(50),
    qualifiers JSONB NOT NULL DEFAULT '{}',
    extraction_model VARCHAR(100) NOT NULL DEFAULT 'heuristic_decomposer',
    prompt_version VARCHAR(50) NOT NULL DEFAULT 'v1.0.0',
    confidence_score NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    confidence_category VARCHAR(20) NOT NULL DEFAULT 'high',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 7. Claim Corrections (Human review correction trail)
CREATE TABLE IF NOT EXISTS claim_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    claim_version_id UUID NOT NULL REFERENCES claim_versions(id) ON DELETE RESTRICT,
    corrected_by_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
    field_name VARCHAR(100) NOT NULL,
    original_value TEXT NOT NULL,
    corrected_value TEXT NOT NULL,
    correction_reason TEXT NOT NULL,
    corrected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 8. Indexes for Performance & Lineage Traversals
CREATE INDEX IF NOT EXISTS idx_source_artifacts_tenant_uri ON source_artifacts(tenant_id, original_uri);
CREATE INDEX IF NOT EXISTS idx_source_versions_tenant_hash ON source_versions(tenant_id, version_hash);
CREATE INDEX IF NOT EXISTS idx_source_passages_tenant_version ON source_passages(tenant_id, source_version_id);
CREATE INDEX IF NOT EXISTS idx_source_passages_tenant_hash ON source_passages(tenant_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_claim_occurrences_tenant_claim ON claim_occurrences(tenant_id, claim_version_id);
CREATE INDEX IF NOT EXISTS idx_claim_occurrences_tenant_passage ON claim_occurrences(tenant_id, source_passage_id);
CREATE INDEX IF NOT EXISTS idx_claim_propositions_tenant_claim ON claim_propositions(tenant_id, claim_version_id);
CREATE INDEX IF NOT EXISTS idx_claim_corrections_tenant_claim ON claim_corrections(tenant_id, claim_version_id);

-- 9. Row Level Security Policies
ALTER TABLE source_passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_passages FORCE ROW LEVEL SECURITY;
CREATE POLICY source_passages_tenant_isolation ON source_passages
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

ALTER TABLE source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY source_snapshots_tenant_isolation ON source_snapshots
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

ALTER TABLE claim_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY claim_occurrences_tenant_isolation ON claim_occurrences
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

ALTER TABLE claim_propositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_propositions FORCE ROW LEVEL SECURITY;
CREATE POLICY claim_propositions_tenant_isolation ON claim_propositions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

ALTER TABLE claim_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY claim_corrections_tenant_isolation ON claim_corrections
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
