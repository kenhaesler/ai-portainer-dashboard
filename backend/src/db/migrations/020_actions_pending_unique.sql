CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_pending_dedup
  ON actions(container_id, action_type)
  WHERE status = 'pending';
