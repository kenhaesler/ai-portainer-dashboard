-- PostgreSQL migration: created_at index for webhook_deliveries (#1505)
-- The daily retention sweep deletes webhook_deliveries rows by created_at;
-- every other pruned history table already carries a created_at index
-- (006_audit_log, 008_notification_log, 009_monitoring_telemetry,
-- 014_llm_traces) — webhook_deliveries was the only one missing it.

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);
