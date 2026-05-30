-- Migration 029: add `signature` column to incidents
--
-- Backs the two-level rollup on the Health & Monitoring page.
-- Populated at insert time from the source insight's structured
-- fields (`category`, `metric_type`, `detection_method`).
--
-- Phase A only — column add, no indexes here. The
-- `CREATE INDEX CONCURRENTLY` step lives in
-- packages/ai-intelligence/scripts/create-incident-signature-indexes.ts
-- and is invoked outside any transaction at deploy time.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS signature TEXT;
