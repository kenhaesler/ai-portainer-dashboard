CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'sse', 'http')),
  command TEXT,
  url TEXT,
  args TEXT,
  env TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  disabled_tools TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
