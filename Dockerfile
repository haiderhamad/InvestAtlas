# Local Personal image; source-built, non-root runtime, no owner credentials.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run local:build
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=local_personal \
    INVESTATLAS_LOCAL_RUNTIME=true \
    PORT=3000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next-local ./.next-local
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/LICENSE /app/LICENSING.md /app/THIRD_PARTY_NOTICES.md ./
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json /app/tsconfig.local.json ./
COPY --from=build --chown=node:node /app/scripts/local-runtime.mjs /app/scripts/local-container.mjs ./scripts/
USER node
EXPOSE 3000
CMD ["node", "scripts/local-container.mjs"]
