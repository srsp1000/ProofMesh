-- Migration Down: 0004_adapter_connections.down.sql

DROP POLICY IF EXISTS tenant_isolation_policy ON adapter_connections;
DROP TABLE IF EXISTS adapter_connections CASCADE;
