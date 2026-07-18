# LeadVirt.ai

LeadVirt.ai is a universal AI lead assistant for businesses. It responds to incoming customer messages, qualifies leads, books appointments, helps with orders, follows up, and prepares structured leads for CRM or managers.

This repository is a pnpm monorepo shaped as a scalable modular monolith:

Detailed current-state architecture: [Russian architecture atlas](docs/PROJECT_ARCHITECTURE_RU.md).

- `apps/web` - Next.js App Router frontend.
- `apps/api` - NestJS REST API.
- `apps/worker` - BullMQ-ready worker process.
- `packages/db` - Prisma schema, client, seed.
- `packages/ui` - shared UI primitives kept for package-level reuse.
- `packages/types` - shared product types.
- `packages/config` - environment helpers.
- `packages/ai` - AI provider abstraction and prompt templates.
- `packages/integrations` - channel/CRM/calendar adapter interfaces and stubs.

The active product UI lives in `apps/web/src/design`; the old design-only export has been removed from the runtime workspace.

## Local Development

```bash
corepack enable
corepack pnpm install
copy .env.example .env
docker compose up -d
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm dev
```

If `pnpm` is already available on your PATH, the same commands work without the `corepack` prefix.

Default ports:

- Web: `http://localhost:3001`
- API health: `http://localhost:4001/health`
- API routes: `http://localhost:4001/api`
- Postgres: `localhost:5432`
- Redis: `localhost:6380`

Website widget:

- Demo page: `http://localhost:3001/widget/demo`
- Public key: `demo-website-widget`
- Embed snippet: `<script async src="http://localhost:3001/widget/embed.js" data-leadvirt-key="demo-website-widget"></script>`

Telegram webhook demo:

- Endpoint: `http://localhost:4001/api/public/channels/telegram/demo-telegram-webhook/webhook`
- Secret header: `x-telegram-bot-api-secret-token: demo-telegram-secret`

Generic Webhook/API demo:

- Endpoint: `http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events`
- Secret header: `x-leadvirt-webhook-secret: demo-webhook-secret`

When starting the API manually, make sure the process has `DATABASE_URL` and `REDIS_URL`
from `.env.example`; Prisma reads `DATABASE_URL` from the process environment at startup.

Useful scripts:

- `corepack pnpm dev:web`
- `corepack pnpm dev:api`
- `corepack pnpm dev:worker`
- `corepack pnpm db:generate`
- `corepack pnpm db:migrate`
- `corepack pnpm db:seed`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm build`

AI replies run synchronously by default for local demo reliability. To exercise the BullMQ path, set `AI_REPLY_MODE=queue` for the API and `WORKER_ENABLE_PROCESSORS=true` for the worker with Redis running.
