-- PostgreSQL migration: users table
-- Converted from SQLite migrations 015_users.sql + 016_default_landing_page.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'operator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  default_landing_page TEXT NOT NULL DEFAULT '/'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
