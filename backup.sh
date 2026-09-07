#!/usr/bin/env bash
# Dumps the database into the data volume and deletes dumps older than 7 days.
# Run nightly by cron on the droplet, as the deploy user.
set -euo pipefail
cd "$(dirname "$0")"

docker compose -f docker-compose.prod.yml exec -T postgres sh -c '
  mkdir -p /data/backups
  pg_dump -U holocron holocron | gzip > "/data/backups/holocron-$(date +%Y%m%d-%H%M%S).sql.gz"
  find /data/backups -name "*.sql.gz" -mtime +7 -delete
'
