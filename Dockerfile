# ChargeMesh gateway image: one image serves both the gateway and worker processes.
# Build with the repo root as context: docker build -f Dockerfile .
# The mock-csms image (packages/sim/Dockerfile) is separate and unaffected.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npm install --global turbo@2.10.13 && turbo prune gateway --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
RUN pnpm build

FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 1001 chargemesh \
  && useradd --system --uid 1001 --gid chargemesh --home-dir /app --shell /usr/sbin/nologin chargemesh
COPY --from=builder --chown=chargemesh:chargemesh /app/node_modules ./node_modules
COPY --from=builder --chown=chargemesh:chargemesh /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder --chown=chargemesh:chargemesh /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=builder --chown=chargemesh:chargemesh /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=builder --chown=chargemesh:chargemesh /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=chargemesh:chargemesh /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder --chown=chargemesh:chargemesh /app/packages/db/migrations ./packages/db/migrations
COPY --from=builder --chown=chargemesh:chargemesh /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder --chown=chargemesh:chargemesh /app/packages/ocpp/dist ./packages/ocpp/dist
COPY --from=builder --chown=chargemesh:chargemesh /app/packages/ocpp/node_modules ./packages/ocpp/node_modules
COPY --from=builder --chown=chargemesh:chargemesh /app/packages/ocpp/package.json ./packages/ocpp/package.json
# Numeric UID: the chargemesh user created above (uid/gid 1001).
USER 1001
EXPOSE 8080 50051
CMD ["node", "apps/gateway/dist/main.js"]
