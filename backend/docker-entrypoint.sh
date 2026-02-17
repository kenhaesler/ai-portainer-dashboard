#!/bin/sh
set -e

# Fix ownership of data directory (may be owned by root from previous runs)
if [ -d /app/data ]; then
  chown -R node:node /app/data
fi

# Drop privileges and exec the CMD
exec su-exec node "$@"
