#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'dashboard_user') THEN
      CREATE USER dashboard_user WITH PASSWORD '${POSTGRES_APP_PASSWORD:-changeme}';
    END IF;
  END
  \$\$;

  SELECT 'CREATE DATABASE dashboard OWNER dashboard_user'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dashboard')\gexec

  GRANT ALL PRIVILEGES ON DATABASE dashboard TO dashboard_user;
EOSQL
