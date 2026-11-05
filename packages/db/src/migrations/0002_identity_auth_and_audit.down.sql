-- Rollback Migration 0002: Identity, Multi-Tenancy, Authorization and Audit Foundation

DROP TRIGGER IF EXISTS trg_audit_checkpoints_immutable ON audit_checkpoints;
DROP TRIGGER IF EXISTS trg_role_assignment_agent_boundary ON role_assignments;
DROP FUNCTION IF EXISTS check_role_assignment_agent_boundary();

DROP TABLE IF EXISTS audit_checkpoints CASCADE;
DROP TABLE IF EXISTS connector_credentials CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS role_assignments CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;

ALTER TABLE audit_events DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE audit_events DROP COLUMN IF EXISTS policy_decision;
