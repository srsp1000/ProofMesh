-- ProofMesh Initial Schema Migration: 0001_initial_schema.sql
-- Enforces Row-Level Security (RLS) and Historical Immutability

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants, Workspaces, Projects & Principals
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    key VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant_id, key)
);

CREATE TABLE IF NOT EXISTS principals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    type VARCHAR(30) NOT NULL, -- human_user, service_account, agent_identity
    identifier VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant_id, identifier)
);

-- 2. Claims Hierarchy
CREATE TABLE IF NOT EXISTS claim_concepts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    concept_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id, concept_key)
);

CREATE TABLE IF NOT EXISTS claim_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    concept_id UUID NOT NULL REFERENCES claim_concepts(id) ON DELETE RESTRICT,
    version_sequence INT NOT NULL,
    statement TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    qualifiers JSONB NOT NULL DEFAULT '{}',
    valid_from TIMESTAMPTZ,
    valid_to TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(concept_id, version_sequence)
);

-- 3. Source Artifacts
CREATE TABLE IF NOT EXISTS source_artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    uri VARCHAR(1000) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS source_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    source_artifact_id UUID NOT NULL REFERENCES source_artifacts(id) ON DELETE RESTRICT,
    version_hash VARCHAR(71) NOT NULL, -- sha256:...
    byte_size BIGINT NOT NULL,
    storage_location VARCHAR(1000) NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(source_artifact_id, version_hash)
);

-- 4. Evidence Items & Assessment Versions
CREATE TABLE IF NOT EXISTS evidence_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    evidence_type VARCHAR(50) NOT NULL,
    content_hash VARCHAR(71) NOT NULL,
    content_payload JSONB,
    source_passage_id UUID,
    captured_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS claim_evidence_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    claim_version_id UUID NOT NULL REFERENCES claim_versions(id) ON DELETE RESTRICT,
    evidence_item_id UUID NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(claim_version_id, evidence_item_id)
);

CREATE TABLE IF NOT EXISTS assessment_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    claim_evidence_link_id UUID NOT NULL REFERENCES claim_evidence_links(id) ON DELETE RESTRICT,
    outcome VARCHAR(30) NOT NULL,
    applicability VARCHAR(30) NOT NULL,
    confidence_score NUMERIC(5,4) NOT NULL,
    rationale TEXT NOT NULL,
    is_stale BOOLEAN NOT NULL DEFAULT false,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 5. Lineage Dependency DAG
CREATE TABLE IF NOT EXISTS typed_dependency_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    source_node_id UUID NOT NULL,
    source_node_type VARCHAR(50) NOT NULL,
    target_node_id UUID NOT NULL,
    target_node_type VARCHAR(50) NOT NULL,
    edge_type VARCHAR(50) NOT NULL,
    capture_method VARCHAR(50) NOT NULL,
    confidence_score NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_lineage_source ON typed_dependency_edges(tenant_id, source_node_id);
CREATE INDEX IF NOT EXISTS idx_lineage_target ON typed_dependency_edges(tenant_id, target_node_id);

-- 6. Audit & Inbox/Outbox
CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    principal_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    payload_hash VARCHAR(71) NOT NULL,
    payload_diff JSONB,
    prev_event_hash VARCHAR(71),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inbox_events (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) NOT NULL,
    response_payload JSONB NOT NULL,
    response_status INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(tenant_id, idempotency_key)
);

-- 7. Enable Row-Level Security (RLS) on Tenant-Scoped Tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE typed_dependency_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_events ENABLE ROW LEVEL SECURITY;

-- 8. Define Standard RLS Policies
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'workspaces', 'projects', 'principals', 'claim_concepts',
            'claim_versions', 'source_artifacts', 'source_versions',
            'evidence_items', 'claim_evidence_links', 'assessment_versions',
            'typed_dependency_edges', 'audit_events', 'outbox_events', 'inbox_events'
        ])
    LOOP
        EXECUTE format('
            DROP POLICY IF EXISTS tenant_isolation_policy ON %I;
            CREATE POLICY tenant_isolation_policy ON %I
                FOR ALL
                USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid);
        ', tbl, tbl);
    END LOOP;
END $$;

-- 9. Historical Immutability Triggers (Block UPDATE and DELETE on Append-Only Ledgers)
CREATE OR REPLACE FUNCTION block_mutation_on_immutable_table()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Violation: Mutating records in immutable table % is strictly prohibited.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION block_mutation_on_immutable_table();

DROP TRIGGER IF EXISTS trg_evidence_items_immutable ON evidence_items;
CREATE TRIGGER trg_evidence_items_immutable
    BEFORE UPDATE OR DELETE ON evidence_items
    FOR EACH ROW EXECUTE FUNCTION block_mutation_on_immutable_table();
