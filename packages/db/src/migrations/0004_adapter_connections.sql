-- Migration: 0004_adapter_connections.sql
-- Description: Persistent state, cursors, and generations for external protocol adapters (Switch, Webhooks, OTLP)

CREATE TABLE IF NOT EXISTS adapter_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    adapter_type VARCHAR(50) NOT NULL,
    instance_id VARCHAR(100) NOT NULL,
    connection_id VARCHAR(100) NOT NULL,
    cursor_position BIGINT NOT NULL DEFAULT 0,
    generation VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'disconnected',
    state_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_event_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_adapter_connection_instance UNIQUE (tenant_id, adapter_type, instance_id)
);

-- Indexes for efficient cursor lookup and status monitoring
CREATE INDEX IF NOT EXISTS idx_adapter_connections_tenant ON adapter_connections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_adapter_connections_lookup ON adapter_connections (tenant_id, adapter_type, status);
CREATE INDEX IF NOT EXISTS idx_adapter_connections_conn_id ON adapter_connections (tenant_id, connection_id);

-- Enforce Row-Level Security
ALTER TABLE adapter_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE adapter_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON adapter_connections
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Grant permissions to restricted application role
GRANT SELECT, INSERT, UPDATE, DELETE ON adapter_connections TO proofmesh_app;
