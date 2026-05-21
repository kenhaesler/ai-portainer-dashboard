-- Migration 034: oidc_user_groups — tracks (user_sub, group_name) pairs observed
-- via OIDC logins. Backs the admin-facing "discovered groups" dropdown in the
-- Settings → Security group-to-role mapping editor.
--
-- group_name stores the prefix-stripped form (same shape used by
-- packages/core/src/services/oidc.ts::stripGroupPrefix) so the value matches
-- what admins type into the mapping editor.
--
-- Sync semantics (see services/oidc-group-tracking.ts):
--   - INSERT … ON CONFLICT (user_sub, group_name) DO UPDATE SET last_seen_at = NOW()
--   - DELETE rows for the user whose group_name is no longer in the current claim set,
--     so leaving a group is reflected on next login.

CREATE TABLE IF NOT EXISTS oidc_user_groups (
  user_sub      TEXT NOT NULL,
  group_name    TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_sub, group_name)
);

CREATE INDEX IF NOT EXISTS idx_oidc_user_groups_group ON oidc_user_groups(group_name);
