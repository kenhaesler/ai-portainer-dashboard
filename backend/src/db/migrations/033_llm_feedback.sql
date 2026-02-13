CREATE TABLE IF NOT EXISTS llm_feedback (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  message_id TEXT,
  feature TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  comment TEXT,
  user_id TEXT NOT NULL,
  admin_status TEXT NOT NULL DEFAULT 'pending' CHECK (admin_status IN ('pending', 'approved', 'rejected', 'overruled')),
  admin_note TEXT,
  effective_rating TEXT CHECK (effective_rating IN ('positive', 'negative')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_llm_feedback_feature ON llm_feedback(feature);
CREATE INDEX IF NOT EXISTS idx_llm_feedback_rating ON llm_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_llm_feedback_user ON llm_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_feedback_status ON llm_feedback(admin_status);
CREATE INDEX IF NOT EXISTS idx_llm_feedback_created ON llm_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_feedback_trace ON llm_feedback(trace_id);

-- Prompt improvement suggestions table
CREATE TABLE IF NOT EXISTS llm_prompt_suggestions (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  current_prompt TEXT NOT NULL,
  suggested_prompt TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  evidence_feedback_ids TEXT NOT NULL DEFAULT '[]',
  negative_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed', 'edited')),
  applied_at TEXT,
  applied_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_llm_prompt_suggestions_feature ON llm_prompt_suggestions(feature);
CREATE INDEX IF NOT EXISTS idx_llm_prompt_suggestions_status ON llm_prompt_suggestions(status);
