# tAImline container image — multi-stage, non-root.
# Debian (bookworm) rather than Alpine to avoid musl pain with the
# better-sqlite3 native module. node:24 matches the dev environment and
# provides native TypeScript stripping (used by the migrate runner).

# ---- base -------------------------------------------------------------------
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- build (needs dev deps for the Astro build) -----------------------------
FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- prod-deps (better-sqlite3 compiled against THIS image's node ABI) -------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_PATH=/data/taimline.db

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# src/db carries the migrate runner + SQL migrations for the init container.
COPY --from=build /app/src/db ./src/db
COPY package.json ./

EXPOSE 4321
# node:* images ship a non-root `node` user (uid 1000).
USER node

CMD ["node", "./dist/server/entry.mjs"]
