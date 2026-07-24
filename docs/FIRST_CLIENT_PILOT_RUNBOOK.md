# First Social Test Client Pilot Runbook

Last updated: 2026-07-19

This runbook is for the first controlled pilot clients coming from social traffic. The goal is to prove the manager-facing product loop, not final production operations.

## Pilot Scope

Ready to test:

- Landing/demo routing and credential client-cabinet login flow.
- Credential sessions, TOTP 2FA setup/login, self-service password reset, temporary-password enforcement, and auth rate limiting.
- Dashboard, Inbox, Conversation, Pipeline, Automation, Analytics, Settings, Widget, and demo Billing UI.
- Telegram webhook demo intake.
- Generic webhook/API demo intake for social-adjacent sources and form/zap-style traffic.
- Website widget intake.
- Automation runtime MVP for active workflows on inbound widget, webhook, and Telegram messages.
- Manager actions: send messages, AI draft, handoff/status, CRM/task/booking actions, lead stage updates, transcript export, analytics CSV export.

Out of scope for this pilot:

- Production SSO/OAuth and enterprise identity-provider flows.
- Real Billing/checkout.
- Real OAuth or production social-account connection flows.
- Auto deployment and production infrastructure.
- Full external CRM/calendar sync beyond existing API stubs/actions.

## Local Preflight

1. Start infrastructure and seed demo data:

```bash
docker compose up -d
corepack pnpm db:migrate
corepack pnpm db:seed
```

2. Start the app:

```bash
corepack pnpm dev
```

3. Confirm the local URLs:

- Web: `http://localhost:3001`
- API health: `http://localhost:4001/health`
- API routes: `http://localhost:4001/api`
- Widget demo: `http://localhost:3001/widget/demo`

4. Run the combined readiness check before inviting a pilot client:

```bash
corepack pnpm run pilot:ready
corepack pnpm run qa:ai:provider
corepack pnpm run qa:auth:staging-ready
corepack pnpm run qa:channels:provisioning
corepack pnpm run provision:webhook-channel
corepack pnpm run release:public-ready
```

`pilot:ready` regenerates the packet, runs the fast doctor, runs the local real-intake smoke, skips public preflight unless public URL env vars are set, and prints a cleanup dry-run count.
It also writes the latest shareable readiness report to `docs/PILOT_READY_REPORT.md`.
`qa:ai:provider` validates the configured AI provider contract. Local runs use `AI_PROVIDER=mock`; staging/public runs should set `AI_PROVIDER=openai` and `AI_API_KEY`.
`qa:auth:staging-ready` validates the configured database and auth boundary. Local runs may warn about dev env values; for a staging/public release gate set `LEADVIRT_AUTH_READY_STRICT=1` with the target `DATABASE_URL`, public `APP_URL`, and non-mock email/rate-limit settings.
`qa:channels:provisioning` validates the first real-channel path by creating a temporary Webhook/API channel with a generated non-demo key and posting public intake through it.
`provision:webhook-channel` logs into the target workspace, creates or reuses the Webhook/API channel, and prints the exact Master Budet env values. Channel reads never expose stored secrets. A new channel returns its generated secret once; for an existing channel, set `LEADVIRT_PROVISION_WEBHOOK_SECRET` or `LEADVIRT_PUBLIC_WEBHOOK_SECRET` to reuse the known value, otherwise the command performs an audited OWNER/ADMIN rotation and prints the replacement once. On non-local APIs it refuses demo public keys.
`release:public-ready` is the public/staging one-command gate: strict auth readiness, real OpenAI provider env, Webhook/API provisioning, packet regeneration, and public URL preflight.

Production deploy images intentionally do not include Playwright browsers. Run the full `release:public-ready` gate from an operator machine. If a server/container run is needed for non-browser gates only, set `LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT=1`; then run `corepack pnpm run qa:pilot:public` separately from an operator machine before inviting testers.

For public/staging release, set real AI env before running the gate:

```bash
$env:AI_PROVIDER="openai"
$env:AI_API_KEY="..."
$env:AI_DEFAULT_MODEL="gpt-5.5"
```

Local QA can continue using `AI_PROVIDER=mock`.

For debugging individual pieces, run:

```bash
corepack pnpm run pilot:doctor
corepack pnpm --filter @leadvirt/web typecheck
corepack pnpm --filter @leadvirt/web lint
corepack pnpm --filter @leadvirt/web build
corepack pnpm run qa:api
corepack pnpm run qa:activation-evidence
corepack pnpm run qa:ai:provider
corepack pnpm run qa:auth:staging-ready
corepack pnpm run qa:channels:provisioning
corepack pnpm run provision:webhook-channel
corepack pnpm run qa:pilot:intake
```

After `next build`, restart `next dev` before browser QA. If localhost serves stale chunks, stop the web dev server, delete `apps/web/.next`, and restart `corepack pnpm dev:web`.

5. Generate the operator packet for the current local/public URL setup:

```bash
corepack pnpm run pilot:packet
```

The packet is written to `docs/PILOT_PACKET.md` and includes operator links, public keys, intake endpoints, headers, sample payloads, QA commands, and cleanup commands.
It also includes copy/paste PowerShell smoke commands for Telegram, Webhook/API, and Widget intake with unique pilot ids.

## Public URL / Tunnel Preflight

Use this when exposing the local pilot through a public tunnel or staging URL. The check is skipped unless both public base URLs are set.

Required:

```bash
$env:LEADVIRT_PUBLIC_WEB_BASE="https://your-public-web-url"
$env:LEADVIRT_PUBLIC_API_BASE="https://your-public-api-url/api"
$env:LEADVIRT_PUBLIC_CHANNELS="webhook"
corepack pnpm run qa:pilot:public
```

Optional overrides if the seeded demo keys are not used:

```bash
$env:LEADVIRT_PUBLIC_TELEGRAM_KEY="..."
$env:LEADVIRT_PUBLIC_TELEGRAM_SECRET="..."
$env:LEADVIRT_PUBLIC_WEBHOOK_KEY="..."
$env:LEADVIRT_PUBLIC_WEBHOOK_SECRET="..."
$env:LEADVIRT_PUBLIC_WIDGET_KEY="..."
```

The preflight verifies:

- Public web routes `/`, `/demo`, and `/widget/demo` load.
- Public API health is reachable.
- Widget config is reachable when `LEADVIRT_PUBLIC_CHANNELS` includes `widget`.
- Selected public intake endpoints accept traffic and create a conversation/lead response. Without `LEADVIRT_PUBLIC_CHANNELS`, the preflight checks `telegram,webhook,widget`; for the first Master Budet release use `webhook`.

If you run the preflight against local URLs, use:

```bash
$env:LEADVIRT_PUBLIC_WEB_BASE="http://localhost:3001"
$env:LEADVIRT_PUBLIC_API_BASE="http://localhost:4001/api"
$env:LEADVIRT_PUBLIC_CHANNELS="webhook"
corepack pnpm run qa:pilot:public
```

For the full public release gate, set the target DB/auth/provisioning env and run:

```bash
$env:DATABASE_URL="postgresql://..."
$env:APP_URL="https://your-public-web-url"
$env:NODE_ENV="production"
$env:APP_ENV="staging"
$env:AUTH_2FA_ENCRYPTION_KEY="..."
$env:EMAIL_PROVIDER="..."
$env:AUTH_RATE_LIMIT_DISABLED="false"
$env:LEADVIRT_PUBLIC_WEB_BASE="https://your-public-web-url"
$env:LEADVIRT_PUBLIC_API_BASE="https://your-public-api-url/api"
$env:LEADVIRT_PUBLIC_CHANNELS="webhook"
$env:LEADVIRT_PROVISION_EMAIL="owner@example.com"
$env:LEADVIRT_PROVISION_PASSWORD="..."
corepack pnpm run release:public-ready
```

For server/container non-browser release checks only:

```bash
$env:LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT="1"
corepack pnpm run release:public-ready
```

That report is intentionally marked `passed-with-skipped-public-preflight`, not a final tester-ready pass.

After setting public URL env vars, regenerate the packet so it prints the public tester-facing links:

```bash
corepack pnpm run pilot:packet
```

## Traffic Entry Points

For the first external release, use Webhook/API as the first real acquisition channel. Instagram and WhatsApp are deferred until their provider permissions/review paths are ready.

For staging/public Master Budet traffic:

- Configure the target API and credential env, then run the provisioning helper:

```bash
$env:LEADVIRT_API_BASE="https://your-public-api-url/api"
$env:LEADVIRT_PUBLIC_API_BASE="https://your-public-api-url/api"
$env:LEADVIRT_PROVISION_EMAIL="owner@example.com"
$env:LEADVIRT_PROVISION_PASSWORD="..."
$env:LEADVIRT_PROVISION_2FA_CODE="123456" # only if 2FA is enabled
corepack pnpm run provision:webhook-channel
```

- Alternatively, sign in to the staging LeadVirt workspace and open Settings > Channels to enable/create `Webhook/API`.
- Use the generated non-demo public key, which starts with `lvwh_`.
- Use the generated webhook secret from channel settings as `LEADVIRT_WEBHOOK_SECRET`.
- Set Master Budet `LEADVIRT_WEBHOOK_URL` to `{publicApiBase}/public/channels/webhook/{publicKey}/events`.
- Do not use `demo-generic-webhook` for external tester traffic.

Operator-facing endpoint details are also visible in `/app/integrations`:

- The top `Готовность входящих каналов` panel shows whether Telegram, Webhook/API, and the website widget currently have active public keys/endpoints for pilot traffic.
- Use the `Тестовый лид` buttons in that panel to send Telegram or Webhook/API sample intake directly from the setup screen.
- Use `Открыть виджет` in that panel to open the local widget demo before showing it to a pilot client.
- Open a connected `Telegram` or `Webhook/API` card.
- Click `Настроить`.
- Use the `Публичный входящий endpoint` panel to copy the endpoint URL, public key, secret header name, or sample payload.

Telegram demo webhook:

- Endpoint: `http://localhost:4001/api/public/channels/telegram/demo-telegram-webhook/webhook`
- Header: `x-telegram-bot-api-secret-token: demo-telegram-secret`

Generic webhook/API demo:

- Endpoint: `http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events`
- Header: `x-leadvirt-webhook-secret: demo-webhook-secret`

Master Budet order-created bridge:

- Master project: `C:\Users\camal\.apps\master_ryadom`
- Bridge code: `backend/src/leadvirt`
- Keep LeadVirt web/API on `http://localhost:3001` and `http://localhost:4001`.
- Run Master Budet on non-conflicting ports, for example web `http://localhost:3002` and backend `API_PORT=4002`.
- Point Master Budet frontend to that backend with `NEXT_PUBLIC_API_BASE_URL=http://localhost:4002`.
- In Master Budet backend env set:
  - `LEADVIRT_AI_ADMIN_ENABLED=true`
  - `LEADVIRT_WEBHOOK_URL=http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events`
  - `LEADVIRT_WEBHOOK_SECRET=demo-webhook-secret`
- Submit a real Master Budet `/order/new` request and verify the lead appears in LeadVirt `/app/inbox` and `/app/leads`.

Website widget:

- Demo page: `http://localhost:3001/widget/demo`
- Public key: `demo-website-widget`
- Embed snippet:

```html
<script
  async
  src="http://localhost:3001/widget/embed.js"
  data-leadvirt-key="demo-website-widget"
></script>
```

## Pilot Script

1. Open `/demo` with the client to show the product without implying account access.
2. Use `/login` for the client cabinet flow. Complete the short onboarding, enter the company name and a brief description, and select Telegram as the customer channel.
3. In the guided Telegram dialog, connect the bot token, open the bot, and tap `Start` from the one-time guided link.
4. The signed `Start` sends an operator setup confirmation; a normal private message during the short fallback window receives customer-safe acknowledgement. The exact conversation appears in Inbox, while other slash commands remain menu events and never enter AI or generic workflows.
5. Open the detected conversation, send a manual reply, and wait for `Sent` or `Delivered` before treating the loop as complete. Do not use the internal sample as activation evidence.
6. Continue to Knowledge, apply the recommended safe settings, review and publish the exact candidate, then explicitly enable automatic replies. Services, prices, hours, FAQ, policies, and escalation rules are optional follow-up improvements unless the business needs the related behavior.
7. Verify the lead appears in `/app/inbox` and `/app/leads` with the correct customer, channel, source, and latest message.
8. Verify message history, timeline, AI draft, handoff/status actions, transcript export, and lead-stage movement.
9. Check `/app/analytics` after several real messages; internal samples must not appear in Dashboard totals or trend data.

## What To Watch

- Does the source label stay clear enough for a manager to understand where the lead came from?
- Does the social lead remain easy to find after navigation, refresh, and stage changes?
- Does the first AI draft sound usable enough for a manager to edit and send?
- Does Automation create useful lead timeline events without sending surprising duplicate replies?
- Are there any visible fallback/demo labels where the pilot expects real client context?
- Are any important manager actions still toast-only in the active pilot path?

## Pilot Cleanup

After repeated local pilot runs, inspect generated pilot records with:

```bash
corepack pnpm run db:cleanup:pilot
corepack pnpm run db:cleanup:pilot -- --tenant-slug demo-company
```

The cleanup utility is a dry-run by default. It only targets the seeded demo tenant and records with the `Pilot TG`, `Pilot Webhook`, `Pilot Widget`, and `Pilot Intake Workflow` prefixes.

Delete those prefixed pilot records only when you intentionally want to reset the local demo pilot data:

```bash
corepack pnpm run db:cleanup:pilot -- --confirm
corepack pnpm run db:cleanup:pilot -- --tenant-slug demo-company --confirm
```

## Current QA Coverage

Relevant smoke checks:

- `artifacts/playwright/pilot-real-intake-api.spec.ts`
- `artifacts/playwright/pilot-public-url-preflight.spec.ts`
- `artifacts/playwright/social-intake-visibility.spec.ts`
- `artifacts/playwright/webhook-widget-intake-visibility.spec.ts`
- `artifacts/playwright/integrations-api.spec.ts`
- `artifacts/playwright/widget-api.spec.ts`
- `artifacts/playwright/inbox-actions.spec.ts`
- `artifacts/playwright/conversation-send.spec.ts`
- `artifacts/playwright/conversation-ai-draft.spec.ts`
- `artifacts/playwright/conversation-events-timeline.spec.ts`
- `artifacts/playwright/pipeline-actions.spec.ts`
- `artifacts/playwright/automation-api.spec.ts`
- `artifacts/playwright/analytics-api.spec.ts`

Run all focused product smokes with:

```bash
corepack pnpm run qa:api
```

Run the seeded local public-intake smoke with:

```bash
corepack pnpm run qa:pilot:intake
```

`qa:pilot:intake` requires the local API, database, and seeded demo public keys. It creates a temporary active workflow, posts Telegram/webhook/widget inbound messages, verifies Inbox, Pipeline, workflow timeline events, and manager follow-up, then archives the temporary workflow.

Run the optional public URL/tunnel smoke with:

```bash
corepack pnpm run qa:pilot:public
```

`qa:pilot:public` requires `LEADVIRT_PUBLIC_WEB_BASE` and `LEADVIRT_PUBLIC_API_BASE`. Without them it skips. With them it posts public Telegram, webhook, and widget traffic through the configured public API URL.
