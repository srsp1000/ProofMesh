-- ProofMesh Migration 0002: Identity, Multi-Tenancy, Authorization and Audit Foundation
-- Establishes RBAC, Service Credentials, Secret References, and Tamper-Evident Checkpoints

-- 1. Memberships (Associates human principals with tenants)
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, invited, suspended
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant_id, user_principal_id)
);

-- 2. Roles (System global roles and tenant-scoped custom roles)
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT, -- NULL indicates global system role
    name VARCHAR(50) NOT NULL,
    description VARCHAR(255) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT false,
    allows_agents BOOLEAN NOT NULL DEFAULT false, -- Strict security barrier
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant_id, name)
);

-- Seed System Roles
INSERT INTO roles (id, tenant_id, name, description, permissions, is_system, allows_agents)
VALUES
    ('00000000-0000-4000-8000-000000000001', NULL, 'admin', 'Tenant Administrator', 
     '["tenants:manage","workspaces:manage","projects:manage","principals:manage","roles:assign","credentials:manage","claims:read","claims:submit","claims:evaluate","claims:review","claims:attest","evidence:read","evidence:ingest","policy:read","policy:manage","audit:read","audit:checkpoint"]'::jsonb, 
     true, false),
    ('00000000-0000-4000-8000-000000000002', NULL, 'compliance_officer', 'Compliance Officer for Review & Attestation', 
     '["claims:read","claims:review","claims:attest","evidence:read","policy:read","policy:manage","audit:read"]'::jsonb, 
     true, false),
    ('00000000-0000-4000-8000-000000000003', NULL, 'auditor', 'Read-Only Compliance & Forensic Auditor', 
     '["claims:read","evidence:read","policy:read","audit:read"]'::jsonb, 
     true, false),
    ('00000000-0000-4000-8000-000000000004', NULL, 'developer', 'Engineer for Integration & Claim Submission', 
     '["claims:read","claims:submit","evidence:read","evidence:ingest","policy:read"]'::jsonb, 
     true, true),
    ('00000000-0000-4000-8000-000000000005', NULL, 'agent_ingest', 'Least-Privilege Agent Telemetry Ingestion', 
     '["claims:submit","evidence:ingest"]'::jsonb, 
     true, true)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3. Role Assignments
CREATE TABLE IF NOT EXISTS role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    scope_type VARCHAR(20) NOT NULL DEFAULT 'tenant', -- tenant, workspace, project
    scope_id UUID,
    assigned_by UUID REFERENCES principals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_assignment 
ON role_assignments (tenant_id, principal_id, role_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 4. API Keys & Machine Credentials
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hex
    scopes JSONB NOT NULL DEFAULT '[]',
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 5. Connector Credentials (References external secret store, never plaintext)
CREATE TABLE IF NOT EXISTS connector_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    connector_type VARCHAR(50) NOT NULL,
    credential_ref VARCHAR(255) NOT NULL, -- KMS / Vault / Encrypted Ref
    masked_identity VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id, name)
);

-- 6. Audit Checkpoints (Hourly Merkle root seals for audit non-repudiation)
CREATE TABLE IF NOT EXISTS audit_checkpoints (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    start_event_id BIGINT NOT NULL,
    end_event_id BIGINT NOT NULL,
    event_count INT NOT NULL,
    merkle_root VARCHAR(71) NOT NULL, -- sha256:...
    prev_checkpoint_root VARCHAR(71),
    signature VARCHAR(512),
    sealed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Update audit_events table with correlation_id and policy_decision if not present
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS policy_decision VARCHAR(50);

-- 7. Agent Security Trigger: Prevent agents from being assigned human-only roles
CREATE OR REPLACE FUNCTION check_role_assignment_agent_boundary()
RETURNS TRIGGER AS $$
DECLARE
    p_type text;
    r_allows_agents boolean;
    r_name text;
BEGIN
    SELECT type INTO p_type FROM principals WHERE id = NEW.principal_id;
    SELECT allows_agents, name INTO r_allows_agents, r_name FROM roles WHERE id = NEW.role_id;

    IF p_type = 'agent_identity' AND r_allows_agents = false THEN
        RAISE EXCEPTION 'Security Violation: Agent identities cannot be assigned human role %', r_name;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_role_assignment_agent_boundary ON role_assignments;
CREATE TRIGGER trg_role_assignment_agent_boundary
    BEFORE INSERT OR UPDATE ON role_assignments
    FOR EACH ROW EXECUTE FUNCTION check_role_assignment_agent_boundary();

-- 8. Immutability Trigger on Audit Checkpoints
DROP TRIGGER IF EXISTS trg_audit_checkpoints_immutable ON audit_checkpoints;
CREATE TRIGGER trg_audit_checkpoints_immutable
    BEFORE UPDATE OR DELETE ON audit_checkpoints
    FOR EACH ROW EXECUTE FUNCTION block_mutation_on_immutable_table();

-- 9. Row-Level Security (RLS) Configuration
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Apply standard tenant isolation policies
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'memberships', 'role_assignments', 'api_keys', 
            'connector_credentials', 'audit_checkpoints'
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

-- Roles policy: Visible if global system role (tenant_id IS NULL) OR belongs to current tenant
DROP POLICY IF EXISTS roles_visibility_policy ON roles;
CREATE POLICY roles_visibility_policy ON roles
    FOR SELECT
    USING (
        tenant_id IS NULL OR 
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- Enforce FORCE ROW LEVEL SECURITY across all tenant tables so table owners cannot bypass RLS
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'workspaces', 'projects', 'principals', 'memberships',
            'role_assignments', 'api_keys', 'connector_credentials',
            'claim_concepts', 'claim_versions', 'source_artifacts',
            'source_versions', 'evidence_items', 'claim_evidence_links',
            'assessment_versions', 'typed_dependency_edges', 'audit_events',
            'audit_checkpoints', 'outbox_events', 'inbox_events'
        ])
    LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    END LOOP;
END $$;

-- 10. Restricted Database Application Role Setup
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'proofmesh_app') THEN
        CREATE ROLE proofmesh_app WITH 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE 
            NOINHERIT 
            NOBYPASSRLS;
    END IF;
END $$;

-- Grant permissions to restricted role
GRANT USAGE ON SCHEMA public TO proofmesh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proofmesh_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO proofmesh_app;

-- Strictly REVOKE UPDATE and DELETE on immutable audit and evidence tables
REVOKE UPDATE, DELETE ON audit_events FROM proofmesh_app;
REVOKE UPDATE, DELETE ON audit_checkpoints FROM proofmesh_app;
REVOKE UPDATE, DELETE ON evidence_items FROM proofmesh_app;
