# Build from the repository root: docker build -f apps/frontend/Dockerfile .
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS build
WORKDIR /app
RUN npm install --global npm@11.6.0 --ignore-scripts --no-audit --no-fund
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/breeding-service/package.json ./apps/breeding-service/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY infrastructure/package.json ./infrastructure/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace=@anico/frontend
COPY apps/frontend/tsconfig.json apps/frontend/tsconfig.node.json apps/frontend/vite.config.ts apps/frontend/index.html ./apps/frontend/
COPY apps/frontend/src ./apps/frontend/src
RUN npm run build --workspace=@anico/frontend

FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
STOPSIGNAL SIGQUIT
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
