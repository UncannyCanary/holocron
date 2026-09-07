#!/usr/bin/env bash
# Deploys the current branch of this repo to the server it runs on.
# Run this from the repo folder on the droplet, as the deploy user.
set -euo pipefail
cd "$(dirname "$0")"

echo "Pulling latest code"
git pull

echo "Building images"
docker compose -f docker-compose.prod.yml build

echo "Running database migrations"
docker compose -f docker-compose.prod.yml run --rm api pnpm exec drizzle-kit migrate

echo "Restarting services"
docker compose -f docker-compose.prod.yml up -d

echo "Removing unused images"
docker image prune -f

echo "Done"
