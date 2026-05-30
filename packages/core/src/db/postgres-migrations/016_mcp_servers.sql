-- PostgreSQL migration: mcp_servers table
-- Converted from SQLite migration 029_mcp_servers.sql

CREATE TABLE IF NOT EXISTS mcp_servers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'sse', 'http')),
  command TEXT,
  url TEXT,
  args JSONB,
  env JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_tools JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
