# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# @holocron/shared ships compiled, not raw TypeScript, since the api and the
# worker run as plain compiled JS with no loader that could read it straight
# from source the way Vite does for tests.
RUN pnpm --filter @holocron/shared build && pnpm --filter api build && pnpm --filter web build

# Runs the API by default. The worker service in compose overrides the command.
FROM build AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]

# Serves the built web app and proxies /api to the api service.
FROM caddy:2-alpine AS caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
