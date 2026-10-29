# Build from the repository root: docker build -f apps/breeding-service/Dockerfile .
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS manifests
WORKDIR /app
RUN npm install --global npm@11.6.0 --ignore-scripts --no-audit --no-fund
COPY package.json package-lock.json ./
COPY apps/breeding-service/package.json ./apps/breeding-service/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY infrastructure/package.json ./infrastructure/

FROM manifests AS build
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace=@anico/shared-schemas --workspace=@anico/breeding-service
COPY tsconfig.base.json ./
COPY packages/shared-schemas/tsconfig.json ./packages/shared-schemas/
COPY packages/shared-schemas/src ./packages/shared-schemas/src
COPY apps/breeding-service/tsconfig.json ./apps/breeding-service/
COPY apps/breeding-service/src ./apps/breeding-service/src
RUN npm run build --workspace=@anico/shared-schemas \
    && npm run build --workspace=@anico/breeding-service

FROM manifests AS production-dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    --workspace=@anico/shared-schemas --workspace=@anico/breeding-service

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/breeding-service ./apps/breeding-service
COPY --from=production-dependencies /app/packages/shared-schemas ./packages/shared-schemas
COPY --from=build /app/apps/breeding-service/dist ./apps/breeding-service/dist
COPY --from=build /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/ready', { signal: AbortSignal.timeout(2000) }); process.exit(response.ok ? 0 : 1);"
STOPSIGNAL SIGTERM
CMD ["node", "apps/breeding-service/dist/server.js"]
