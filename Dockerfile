FROM node:22-bookworm-slim AS centragent-dev

WORKDIR /app

ENV NODE_ENV=development

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.scripts.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN corepack pnpm install --frozen-lockfile

COPY . .

RUN DATABASE_URL="postgresql://centragent:centragent@postgres:5432/centragent?schema=public" corepack pnpm db:generate
