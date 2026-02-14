DELETE FROM actions
WHERE status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM actions newer
    WHERE newer.status = 'pending'
      AND newer.container_id = actions.container_id
      AND newer.action_type = actions.action_type
      AND (
        COALESCE(newer.created_at, '') > COALESCE(actions.created_at, '')
        OR (
          COALESCE(newer.created_at, '') = COALESCE(actions.created_at, '')
          AND newer.id > actions.id
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_pending_dedup
  ON actions(container_id, action_type)
  WHERE status = 'pending';
