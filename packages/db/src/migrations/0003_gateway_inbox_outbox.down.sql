-- Rollback Migration 0003: Gateway, Inbox/Outbox and Durable Event Processing

DROP TABLE IF EXISTS dead_letter_events CASCADE;
DROP TABLE IF EXISTS outbox_events CASCADE;
DROP TABLE IF EXISTS inbox_events CASCADE;
