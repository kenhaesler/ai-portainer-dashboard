-- Migration 028: stream_tickets table
--
-- Backs the SSE stream-ticket exchange (#1112). EventSource cannot set
-- Authorization headers, so previously the JWT was passed as a query
-- parameter, which leaked it to nginx access logs and browser history.
--
-- Flow:
--   1. Authenticated client POSTs /api/auth/stream-ticket with Bearer JWT.
--   2. Backend issues a single-use ticket (UUID), TTL 30s, scoped to user.
--   3. Client opens EventSource with ?ticket=<id> in the URL.
--   4. SSE handler atomically marks the ticket used (UPDATE … RETURNING)
--      and resolves the user. Once consumed it cannot be replayed.
--
-- The ticket row is opaque to anyone reading the URL: it carries no
-- credentials, expires in 30s, and burns on first use.

CREATE TABLE IF NOT EXISTS stream_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_tickets_expires_at ON stream_tickets(expires_at);
