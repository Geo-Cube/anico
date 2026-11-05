# Build from the repository root: docker build -f apps/breeder-service/Dockerfile .
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS manifests
WORKDIR /app
RUN npm install --global npm@11.6.0 --ignore-scripts --no-audit --no-fund
# Only the workspaces this image builds and runs.
COPY package.json package-lock.json ./
COPY apps/breeder-service/package.json ./apps/breeder-service/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/auth/package.json ./packages/auth/

FROM manifests AS build
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace=@anico/shared-schemas --workspace=@anico/auth --workspace=@anico/breeder-service
COPY tsconfig.base.json ./
COPY packages/shared-schemas/tsconfig.json ./packages/shared-schemas/
COPY packages/shared-schemas/src ./packages/shared-schemas/src
COPY packages/shared-schemas/catalogs ./packages/shared-schemas/catalogs
COPY packages/auth/tsconfig.json ./packages/auth/
COPY packages/auth/src ./packages/auth/src
COPY apps/breeder-service/tsconfig.json ./apps/breeder-service/
COPY apps/breeder-service/src ./apps/breeder-service/src
RUN npm run build --workspace=@anico/shared-schemas \
    && npm run build --workspace=@anico/auth \
    && npm run build --workspace=@anico/breeder-service

FROM manifests AS production-dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    --workspace=@anico/shared-schemas --workspace=@anico/auth --workspace=@anico/breeder-service

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/breeder-service ./apps/breeder-service
COPY --from=production-dependencies /app/packages/shared-schemas ./packages/shared-schemas
COPY --from=production-dependencies /app/packages/auth ./packages/auth
COPY --from=build /app/packages/auth/dist ./packages/auth/dist
COPY --from=build /app/apps/breeder-service/dist ./apps/breeder-service/dist
COPY apps/breeder-service/migrations ./apps/breeder-service/migrations
COPY apps/breeder-service/seeds ./apps/breeder-service/seeds
COPY --from=build /app/packages/shared-schemas/dist ./packages/shared-schemas/dist
COPY --from=build /app/packages/shared-schemas/catalogs ./packages/shared-schemas/catalogs
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/ready', { signal: AbortSignal.timeout(2000) }); process.exit(response.ok ? 0 : 1);"
STOPSIGNAL SIGTERM
CMD ["node", "apps/breeder-service/dist/server.js"]
