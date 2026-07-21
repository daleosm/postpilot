# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

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

# Keep developer tooling (Playwright, TypeScript, Drizzle Kit, esbuild, and
# their transitive binaries) out of the deployed application image. It reduces
# both the attack surface and the image scan noise without affecting the build,
# migration, or demo-seed targets below.
FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# This image deliberately retains the migration CLI and Drizzle files. The
# Argo CD PreSync migration Job uses the same tested dependency graph as the
# application image rather than downloading tooling at deployment time.
FROM dependencies AS migrations

COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY src/lib/db/schema.ts ./src/lib/db/schema.ts
# Node's Alpine image creates this account with UID/GID 1000. Use the numeric
# identity so Kubernetes can verify runAsNonRoot before starting the container.
USER 1000:1000
CMD ["./node_modules/.bin/drizzle-kit", "migrate"]

# The demo seed is deliberately a separate, opt-in image/job. Application
# releases run migrations only; they never recreate fixture organisations.
FROM dependencies AS seed

COPY . .
USER 1000:1000
CMD ["./node_modules/.bin/tsx", "scripts/seed.ts"]

FROM gcr.io/distroless/nodejs22-debian13:nonroot AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

WORKDIR /app

COPY --chown=nonroot:nonroot --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=nonroot:nonroot --from=build /app/.next ./.next
COPY --chown=nonroot:nonroot --from=build /app/public ./public
COPY --chown=nonroot:nonroot package.json ./

USER nonroot
EXPOSE 3000
# Distroless uses Node as its entrypoint, so invoke Next's JavaScript CLI
# directly rather than the shell wrapper from node_modules/.bin.
CMD ["node_modules/next/dist/bin/next", "start"]
