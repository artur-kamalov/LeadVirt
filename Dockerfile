FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

ARG NEXT_PUBLIC_API_URL=http://localhost:4001/api
ARG NEXT_PUBLIC_APP_URL=http://localhost:3001
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3001
ARG NEXT_PUBLIC_DEMO_MODE=false
ARG NEXT_PUBLIC_TELEGRAM_LOGIN_BOT=

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_WEB_URL=${NEXT_PUBLIC_WEB_URL}
ENV NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE}
ENV NEXT_PUBLIC_TELEGRAM_LOGIN_BOT=${NEXT_PUBLIC_TELEGRAM_LOGIN_BOT}
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN corepack pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
COPY artifacts/scripts ./artifacts/scripts
COPY artifacts/evals ./artifacts/evals

RUN corepack pnpm --filter @leadvirt/db db:generate \
  && corepack pnpm -r --filter @leadvirt/api... --filter @leadvirt/worker... --filter @leadvirt/web... --if-present build

EXPOSE 3001 4001

CMD ["corepack", "pnpm", "--filter", "@leadvirt/web", "start"]
