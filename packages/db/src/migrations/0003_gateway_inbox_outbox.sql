-- Migration 0003: Gateway, Inbox/Outbox and Durable Event Processing
-- Enforces transactional inbox/outbox patterns, lane prioritization, and dead-letter queues.

-- 1. Inbox Events Table (for incoming events with idempotency and lease processing)
CREATE TABLE IF NOT EXISTS inbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    event_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    priority_lane VARCHAR(50) NOT NULL DEFAULT 'bulk_telemetry',
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'processed', 'failed', 'dead_letter'
    payload JSONB NOT NULL,
    content_hash VARCHAR(128) NOT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_details TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inbox_tenant_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT uq_inbox_tenant_event UNIQUE (tenant_id, event_id),
    CONSTRAINT chk_inbox_lane CHECK (priority_lane IN ('high_priority', 'bulk_telemetry')),
    CONSTRAINT chk_inbox_status CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'dead_letter'))
);

CREATE INDEX IF NOT EXISTS idx_inbox_polling 
    ON inbox_events (tenant_id, priority_lane, status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_inbox_created 
    ON inbox_events (created_at DESC);

-- 2. Outbox Events Table (for atomic domain event dispatch)
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    event_id UUID NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    priority_lane VARCHAR(50) NOT NULL DEFAULT 'bulk_telemetry',
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'published', 'failed'
    payload JSONB NOT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    published_at TIMESTAMPTZ,
    error_details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_outbox_lane CHECK (priority_lane IN ('high_priority', 'bulk_telemetry')),
    CONSTRAINT chk_outbox_status CHECK (status IN ('pending', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_polling 
    ON outbox_events (priority_lane, status, created_at);

-- 3. Dead Letter Events Table (for failed events after retry exhaustion)
CREATE TABLE IF NOT EXISTS dead_letter_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    inbox_event_id UUID NOT NULL REFERENCES inbox_events(id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    failure_reason TEXT NOT NULL,
    retry_count INT NOT NULL,
    replayed_at TIMESTAMPTZ,
    replayed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_tenant 
    ON dead_letter_events (tenant_id, created_at DESC);

-- 4. Row-Level Security (RLS) Configuration
ALTER TABLE inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY['inbox_events', 'outbox_events', 'dead_letter_events'])
    LOOP
        EXECUTE format('
            DROP POLICY IF EXISTS tenant_isolation_policy ON %I;
            CREATE POLICY tenant_isolation_policy ON %I
                FOR ALL
                USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid);
        ', tbl, tbl);

        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    END LOOP;
END $$;

-- 5. Grant Permissions to proofmesh_app role
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proofmesh_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_events TO proofmesh_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO proofmesh_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON dead_letter_events TO proofmesh_app;
    END IF;
END $$;
