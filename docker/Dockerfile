FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/filters/package.json packages/filters/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages packages
RUN npm run build --workspace @marketscope/server \
  && npm run build --workspace @marketscope/web \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ARG MARKETSCOPE_BUILD_VERSION=dev
ARG MARKETSCOPE_SOURCE_URL

LABEL org.opencontainers.image.title="MarketScope" \
  org.opencontainers.image.description="Local-first Facebook Marketplace filtering server" \
  org.opencontainers.image.source="${MARKETSCOPE_SOURCE_URL}" \
  org.opencontainers.image.version="${MARKETSCOPE_BUILD_VERSION}"

ENV NODE_ENV=production \
  MARKETSCOPE_VERSION=${MARKETSCOPE_BUILD_VERSION} \
  MARKETSCOPE_DATABASE_PATH=/data/marketscope.db \
  MARKETSCOPE_THUMBNAIL_DIRECTORY=/data/thumbnails \
  MARKETSCOPE_BACKUP_DIRECTORY=/backups \
  MARKETSCOPE_SESSION_KEY_PATH=/run/secrets/marketscope_session_key

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/migrations apps/server/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/filters/package.json packages/filters/package.json
COPY --from=build /app/packages/filters/dist packages/filters/dist
COPY --from=build /app/packages/shared-types/package.json packages/shared-types/package.json
COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/server/dist/src/index.js"]
