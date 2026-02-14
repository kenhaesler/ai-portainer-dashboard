# TimescaleDB Backup Strategy

The dashboard uses a `pg_dump`-based backup sidecar (`prodrigestivill/postgres-backup-local:17`) that runs alongside the TimescaleDB container. Backups are compressed SQL dumps stored in a dedicated Docker volume.

## How It Works

| Setting | Default | Description |
|---------|---------|-------------|
| Schedule | `0 3 * * *` | Daily at 03:00 UTC |
| Daily retention | 7 | Keep 7 daily backups |
| Weekly retention | 4 | Keep 4 weekly backups |
| Monthly retention | 0 | Disabled (set via `TIMESCALE_BACKUP_KEEP_MONTHS`) |
| Compression | `-Z6` | gzip level 6 |
| Volume | `timescale-backups` | Docker named volume |

The sidecar connects to TimescaleDB over the internal `dashboard-net` network using the same `TIMESCALE_PASSWORD` credential. A health check endpoint on port 8080 reports backup status.

### Configuration

All settings are tunable via environment variables in `.env`:

```bash
TIMESCALE_BACKUP_SCHEDULE=0 3 * * *     # Cron expression
TIMESCALE_BACKUP_KEEP_DAYS=7            # Daily backups to retain
TIMESCALE_BACKUP_KEEP_WEEKS=4           # Weekly backups to retain
TIMESCALE_BACKUP_KEEP_MONTHS=0          # Monthly backups to retain
TIMESCALE_BACKUP_EXTRA_OPTS=-Z6 --no-comments  # Extra pg_dump flags
```

### Backup File Layout

Inside the `timescale-backups` volume (`/backups` in the container):

```
/backups/
├── daily/metrics/          # Last N daily backups
│   ├── metrics-2026-02-14T030000.sql.gz
│   └── metrics-2026-02-13T030000.sql.gz
├── weekly/metrics/         # Weekly snapshots (kept on Sunday)
│   └── metrics-2026-02-09T030000.sql.gz
├── monthly/metrics/        # Monthly snapshots (1st of month)
└── last/metrics/           # Symlink to most recent backup
    └── metrics-latest.sql.gz
```

## Manual Backup

Trigger an immediate backup without waiting for the cron schedule:

```bash
# Production
docker compose -f docker/docker-compose.yml exec timescale-backup /backup.sh

# Development
docker compose -f docker/docker-compose.dev.yml exec timescale-backup /backup.sh
```

## Restore from Backup

### 1. Identify the backup file

```bash
# List available backups
docker compose -f docker/docker-compose.yml exec timescale-backup ls -la /backups/daily/metrics/

# Or use the latest symlink
docker compose -f docker/docker-compose.yml exec timescale-backup ls -la /backups/last/metrics/
```

### 2. Stop the backend (prevent writes during restore)

```bash
docker compose -f docker/docker-compose.yml stop backend
```

### 3. Restore the database

```bash
# Drop and recreate the database
docker compose -f docker/docker-compose.yml exec timescaledb \
  psql -U metrics_user -d postgres -c "DROP DATABASE IF EXISTS metrics;"
docker compose -f docker/docker-compose.yml exec timescaledb \
  psql -U metrics_user -d postgres -c "CREATE DATABASE metrics OWNER metrics_user;"

# Restore TimescaleDB extension first
docker compose -f docker/docker-compose.yml exec timescaledb \
  psql -U metrics_user -d metrics -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# Restore from backup (using the latest backup as example)
docker compose -f docker/docker-compose.yml exec timescale-backup \
  sh -c 'zcat /backups/last/metrics/metrics-latest.sql.gz | psql -h timescaledb -U metrics_user -d metrics'
```

For a specific dated backup:

```bash
docker compose -f docker/docker-compose.yml exec timescale-backup \
  sh -c 'zcat /backups/daily/metrics/metrics-2026-02-14T030000.sql.gz | psql -h timescaledb -U metrics_user -d metrics'
```

### 4. Restart the backend

```bash
docker compose -f docker/docker-compose.yml start backend
```

### 5. Verify the restore

```bash
# Check table row counts
docker compose -f docker/docker-compose.yml exec timescaledb \
  psql -U metrics_user -d metrics -c "
    SELECT schemaname, relname, n_live_tup
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC;"

# Verify hypertables
docker compose -f docker/docker-compose.yml exec timescaledb \
  psql -U metrics_user -d metrics -c "SELECT * FROM timescaledb_information.hypertables;"
```

## Verify Backup Integrity

### Check backup health endpoint

```bash
# Returns JSON with last backup status, schedule, and timestamps
docker compose -f docker/docker-compose.yml exec timescale-backup curl -s http://localhost:8080/ | jq .
```

### Validate a backup file

```bash
# Check the file is non-empty and valid gzip
docker compose -f docker/docker-compose.yml exec timescale-backup \
  sh -c 'gzip -t /backups/last/metrics/metrics-latest.sql.gz && echo "OK: valid gzip" || echo "ERROR: corrupt"'

# Peek at the SQL contents (first 20 lines)
docker compose -f docker/docker-compose.yml exec timescale-backup \
  sh -c 'zcat /backups/last/metrics/metrics-latest.sql.gz | head -20'
```

### Test restore on a disposable container

For production safety, restore to a temporary database first:

```bash
# Create a throwaway TimescaleDB container
docker run -d --name tsdb-test \
  -e POSTGRES_DB=metrics \
  -e POSTGRES_USER=metrics_user \
  -e POSTGRES_PASSWORD=test123 \
  timescale/timescaledb:2.25.0-pg17

# Copy the backup out of the volume
docker cp "$(docker compose -f docker/docker-compose.yml ps -q timescale-backup)":/backups/last/metrics/ /tmp/tsdb-backup/

# Restore into the test container
zcat /tmp/tsdb-backup/metrics-latest.sql.gz | docker exec -i tsdb-test psql -U metrics_user -d metrics

# Verify
docker exec tsdb-test psql -U metrics_user -d metrics -c "SELECT count(*) FROM metrics_raw;"

# Clean up
docker rm -f tsdb-test
rm -rf /tmp/tsdb-backup/
```

## Exporting Backups to Host

To copy backups out of the Docker volume to the host filesystem:

```bash
# Copy latest backup to current directory
docker cp "$(docker compose -f docker/docker-compose.yml ps -q timescale-backup)":/backups/last/metrics/ ./timescale-backup-export/
```

For automated off-site backups, mount a host directory instead of (or in addition to) the Docker volume by editing the `timescale-backup` service in `docker-compose.yml`:

```yaml
volumes:
  - /path/on/host/timescale-backups:/backups
```
