-- Migration: Seed monitoring + AI tuning settings for issue #993
-- These settings move from env vars to the Settings UI as the primary source of truth.

-- Category A: Webhook settings (already have UI, but may not have DB seeds)
-- Keys match the frontend Settings UI (webhooks.* prefix)
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('webhooks.enabled', 'false', 'webhooks', NOW()),
  ('webhooks.max_retries', '5', 'webhooks', NOW()),
  ('webhooks.retry_interval', '60', 'webhooks', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — Anomaly Detection
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.anomaly_detection_method', 'adaptive', 'ai_tuning', NOW()),
  ('ai_tuning.anomaly_zscore_threshold', '3.5', 'ai_tuning', NOW()),
  ('ai_tuning.anomaly_moving_average_window', '20', 'ai_tuning', NOW()),
  ('ai_tuning.anomaly_min_samples', '10', 'ai_tuning', NOW()),
  ('ai_tuning.anomaly_cooldown_minutes', '30', 'ai_tuning', NOW()),
  ('ai_tuning.anomaly_threshold_pct', '85', 'ai_tuning', NOW()),
  ('ai_tuning.anomaly_hard_threshold_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.bollinger_bands_enabled', 'true', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — Predictive Alerting
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.predictive_alerting_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.predictive_alert_threshold_hours', '24', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — Anomaly Explanation
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.anomaly_explanation_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.anomaly_explanation_max_per_cycle', '5', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — Isolation Forest
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.isolation_forest_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.isolation_forest_retrain_hours', '6', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — NLP Log Analysis
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.nlp_log_analysis_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.nlp_log_analysis_max_per_cycle', '3', 'ai_tuning', NOW()),
  ('ai_tuning.nlp_log_analysis_tail_lines', '100', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — Smart Grouping & Incidents
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.smart_grouping_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.smart_grouping_similarity_threshold', '0.3', 'ai_tuning', NOW()),
  ('ai_tuning.incident_summary_enabled', 'true', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — Investigation
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.investigation_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.investigation_cooldown_minutes', '20', 'ai_tuning', NOW()),
  ('ai_tuning.investigation_max_concurrent', '2', 'ai_tuning', NOW()),
  ('ai_tuning.investigation_log_tail_lines', '50', 'ai_tuning', NOW()),
  ('ai_tuning.investigation_metrics_window_minutes', '60', 'ai_tuning', NOW()),
  ('ai_tuning.investigation_min_severity', 'warning', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- Category B: AI Tuning — General AI
-- Note: insights_retention_days lives in the infrastructure category (below), not here.
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('ai_tuning.ai_analysis_enabled', 'true', 'ai_tuning', NOW()),
  ('ai_tuning.max_insights_per_cycle', '500', 'ai_tuning', NOW()),
  ('ai_tuning.log_analysis_concurrency', '3', 'ai_tuning', NOW()),
  ('ai_tuning.max_llm_history_messages', '50', 'ai_tuning', NOW())
ON CONFLICT (key) DO NOTHING;

-- LLM_PROMPT_GUARD_STRICT, LLM_VERIFY_SSL, LLM_REQUEST_TIMEOUT, AI_SEARCH_MODEL
-- are Category C (security/performance knobs) — they stay env-only.

-- Metrics retention (infrastructure category)
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('infrastructure.metrics_retention_days', '7', 'infrastructure', NOW()),
  ('infrastructure.metrics_raw_retention_days', '7', 'infrastructure', NOW()),
  ('infrastructure.metrics_rollup_5min_retention_days', '30', 'infrastructure', NOW()),
  ('infrastructure.metrics_rollup_1hour_retention_days', '90', 'infrastructure', NOW()),
  ('infrastructure.metrics_rollup_1day_retention_days', '365', 'infrastructure', NOW()),
  ('infrastructure.insights_retention_days', '7', 'infrastructure', NOW()),
  ('infrastructure.image_staleness_check_enabled', 'true', 'infrastructure', NOW()),
  ('infrastructure.image_staleness_check_interval_hours', '24', 'infrastructure', NOW())
ON CONFLICT (key) DO NOTHING;
