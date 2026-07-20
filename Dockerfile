# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:${PATH}" \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
# Auth.js validates its secret while Next.js evaluates server modules during
# compilation. This placeholder is available only to this build layer; the
# running container receives the real NEXTAUTH_SECRET from Kubernetes.
RUN NEXTAUTH_SECRET="postpilot-build-only-not-a-runtime-secret" pnpm build

# This image deliberately retains the migration CLI and Drizzle files. The
# Argo CD PreSync migration Job uses the same tested dependency graph as the
# application image rather than downloading tooling at deployment time.
FROM dependencies AS migrations

COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY src/lib/db/schema.ts ./src/lib/db/schema.ts
USER node
CMD ["./node_modules/.bin/drizzle-kit", "migrate"]

# The demo seed is deliberately a separate, opt-in image/job. Application
# releases run migrations only; they never recreate fixture organisations.
FROM dependencies AS seed

COPY . .
USER node
CMD ["./node_modules/.bin/tsx", "scripts/seed.ts"]

FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json ./

USER node
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start"]
