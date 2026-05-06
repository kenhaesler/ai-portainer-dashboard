-- Migration 030: add structured signature inputs to insights
--
-- The Insight model gained `metric_type` and `detection_method` to drive
-- the incident signature derivation (see signature.ts). New emissions
-- write these fields, but the previous schema dropped them on persist.
-- This migration adds the columns so values flow through to the table
-- and downstream tooling (backfill, dump-historical-titles) can read them.

ALTER TABLE insights ADD COLUMN IF NOT EXISTS metric_type TEXT;
ALTER TABLE insights ADD COLUMN IF NOT EXISTS detection_method TEXT;
