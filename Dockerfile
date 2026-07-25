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
RUN pnpm build

# Keep developer tooling (Playwright, TypeScript, esbuild, and their transitive
# binaries) out of the deployed frontend image. It reduces both attack surface
# and image scan noise without affecting the FastAPI migration or seed images.
FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM gcr.io/distroless/nodejs22-debian13:nonroot AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

WORKDIR /app

COPY --chown=65532:65532 --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=65532:65532 --from=build /app/.next ./.next
COPY --chown=65532:65532 --from=build /app/public ./public
COPY --chown=65532:65532 package.json ./

# Kubernetes validates runAsNonRoot before starting the container. Use the
# distroless non-root UID/GID numerically rather than the named account.
USER 65532:65532
EXPOSE 3000
# Distroless uses Node as its entrypoint, so invoke Next's JavaScript CLI
# directly rather than the shell wrapper from node_modules/.bin.
CMD ["node_modules/next/dist/bin/next", "start"]
