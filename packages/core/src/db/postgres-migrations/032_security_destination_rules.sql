-- Migration 032: Security destination rules (Issue #1240)
--
-- Stores allow/warn/deny rules used by the Security Audit "Observed
-- Destinations" panel to classify outbound traffic captured by Beyla.
-- Patterns are either a CIDR block (e.g. "10.0.0.0/8") or a hostname
-- suffix (e.g. ".internal"). The aggregator's default verdict for any
-- unmatched destination is 'warn'.

CREATE TABLE IF NOT EXISTS security_destination_rules (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('cidr', 'suffix')),
  verdict TEXT NOT NULL CHECK (verdict IN ('allow', 'warn', 'deny')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_destination_rules_verdict
  ON security_destination_rules(verdict);

INSERT INTO security_destination_rules (pattern, pattern_type, verdict, reason) VALUES
  ('10.0.0.0/8',     'cidr',   'allow', 'RFC1918 private network'),
  ('172.16.0.0/12',  'cidr',   'allow', 'RFC1918 private network'),
  ('192.168.0.0/16', 'cidr',   'allow', 'RFC1918 private network'),
  ('127.0.0.0/8',    'cidr',   'allow', 'loopback'),
  ('localhost',      'suffix', 'allow', 'loopback hostname'),
  ('.internal',      'suffix', 'allow', 'internal DNS suffix'),
  ('.svc',           'suffix', 'allow', 'Kubernetes service suffix')
ON CONFLICT DO NOTHING;
