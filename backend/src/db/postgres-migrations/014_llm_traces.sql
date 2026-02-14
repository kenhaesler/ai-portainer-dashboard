-- PostgreSQL migration: llm_traces table
-- Converted from SQLite migrations 019_llm_traces.sql + 021_drop_llm_feedback.sql
-- Note: feedback_score and feedback_text columns were dropped in 021

CREATE TABLE IF NOT EXISTS llm_traces (
  id SERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  session_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  user_query TEXT,
  response_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_traces_created ON llm_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_traces_model ON llm_traces(model);
CREATE INDEX IF NOT EXISTS idx_llm_traces_session ON llm_traces(session_id);
