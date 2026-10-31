# Build from repository root: docker build -f apps/animal-service/Dockerfile .
# Dockerfile.dockerignore provides the build allowlist, including workspace manifests.
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS source
WORKDIR /app
RUN npm install --global npm@11.6.0 --ignore-scripts --no-audit --no-fund
COPY . .

FROM source AS build
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace=@anico/shared-schemas --workspace=@anico/animal-service
RUN npm run build --workspace=@anico/shared-schemas \
    && npm run build --workspace=@anico/animal-service

FROM source AS production-dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    --workspace=@anico/shared-schemas --workspace=@anico/animal-service
RUN rm -rf apps/animal-service/src packages/shared-schemas/src

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/animal-service ./apps/animal-service
COPY --from=production-dependencies /app/packages/shared-schemas ./packages/shared-schemas
COPY --from=build /app/apps/animal-service/dist ./apps/animal-service/dist
COPY --from=build /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/ready', { signal: AbortSignal.timeout(2000) }); process.exit(response.ok ? 0 : 1);"
STOPSIGNAL SIGTERM
CMD ["node", "apps/animal-service/dist/server.js"]
