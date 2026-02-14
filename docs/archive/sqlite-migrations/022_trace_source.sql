ALTER TABLE spans ADD COLUMN trace_source TEXT DEFAULT 'http';
CREATE INDEX idx_spans_source ON spans(trace_source);
