-- Container lifecycle: one row per (endpoint, container) tracking whether the
-- container is currently running. Upserted each metrics-collection cycle so
-- fleet averages can exclude stopped/removed containers (#1394). Lives in
-- TimescaleDB alongside the metrics hypertable so read-path filters can join
-- in-database.
CREATE TABLE IF NOT EXISTS container_lifecycle (
  endpoint_id    INTEGER     NOT NULL,
  container_id   TEXT        NOT NULL,
  container_name TEXT        NOT NULL,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  running        BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (endpoint_id, container_id)
);

CREATE INDEX IF NOT EXISTS idx_container_lifecycle_running
  ON container_lifecycle (endpoint_id) WHERE running;
