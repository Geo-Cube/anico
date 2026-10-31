# Build from repository root: docker build -f apps/__SERVICE_NAME__/Dockerfile .
# Dockerfile.dockerignore provides the build allowlist, including workspace manifests.
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS source
WORKDIR /app
RUN npm install --global npm@11.6.0 --ignore-scripts --no-audit --no-fund
COPY . .

FROM source AS build
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace=@anico/shared-schemas --workspace=@anico/__SERVICE_NAME__
RUN npm run build --workspace=@anico/shared-schemas \
    && npm run build --workspace=@anico/__SERVICE_NAME__

FROM source AS production-dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    --workspace=@anico/shared-schemas --workspace=@anico/__SERVICE_NAME__
RUN rm -rf apps/__SERVICE_NAME__/src packages/shared-schemas/src

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/__SERVICE_NAME__ ./apps/__SERVICE_NAME__
COPY --from=production-dependencies /app/packages/shared-schemas ./packages/shared-schemas
COPY --from=build /app/apps/__SERVICE_NAME__/dist ./apps/__SERVICE_NAME__/dist
COPY --from=build /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/ready', { signal: AbortSignal.timeout(2000) }); process.exit(response.ok ? 0 : 1);"
STOPSIGNAL SIGTERM
CMD ["node", "apps/__SERVICE_NAME__/dist/server.js"]
