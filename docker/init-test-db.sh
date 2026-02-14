#!/bin/bash
# Creates the test database alongside the main app database.
# Mounted into postgres-app via docker-entrypoint-initdb.d/.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE portainer_dashboard_test OWNER $POSTGRES_USER'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'portainer_dashboard_test')\gexec
EOSQL
