CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('client', 'server', 'internal')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'unset')),
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_ms INTEGER,
  service_name TEXT NOT NULL,
  attributes TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_spans_trace ON spans(trace_id);
CREATE INDEX idx_spans_parent ON spans(parent_span_id);
CREATE INDEX idx_spans_service ON spans(service_name);
CREATE INDEX idx_spans_time ON spans(start_time);
