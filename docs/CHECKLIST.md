# LeadVirt Checklist

Last updated: 2026-07-07

## Next

- [ ] Add outbound Umnico delivery adapter for AI/operator replies through `POST /v1.3/messaging/<lead-id>/send` after inbound pilot is confirmed.

## Done

- [x] Added Umnico inbound compatibility through the existing Webhook/API public channel: `message.incoming` normalization, query-string `secret` support for providers without custom headers, ignored handling for non-inbound Umnico events, provisioning output for `UMNICO_WEBHOOK_URL`, and passing local `qa:umnico:webhook`.
- [x] Deployed Umnico inbound support to `leadvirt.ru`, passed live `qa:umnico:webhook` against `lvwh_8ebd05e2661fc484`, cleaned the disposable smoke lead/conversation/event, and registered Umnico webhook id `31397`.
- [x] Repointed Umnico webhook id `31397` to Artur Kamalov workspace through dedicated channel `lvwh_de926322af19b128`, passed live `qa:umnico:webhook`, and cleaned the disposable smoke record.
- [x] Fixed Umnico real Instagram payload parsing so inbound text is read from `message.message.text`, sender login becomes the customer name, and source resolves to `Umnico Instagram` instead of the fallback `Umnico message`.
- [x] Added Umnico outbound delivery for Inbox/AI replies through `POST /v1.3/messaging/<lead-id>/send`, queued manual Inbox messages into `channels.sendMessage`, and added `qa:umnico:outbound`.
- [x] Wired `WEBHOOK_API` integration settings to configure Umnico channel delivery credentials safely: API token is stored on the channel, integration settings return only `apiTokenStatus`, and `qa:umnico:settings` verifies no token leak.
- [x] Rewrote demo conversation copy so inbox threads follow coherent sales flows: intent, qualification, price/slot, confirmation, and next action.
- [x] Added a demo-only live conversation replay in `/demo/inbox/:conversationId`: client/AI messages appear with typing indicators, replay can be skipped or repeated, manual actions pause the script, and no API/DB boundary remains enforced.
- [x] Reworked `/demo` into an interactive no-API product demo across dashboard, inbox, leads, automations, analytics, audit, integrations, billing/settings, onboarding, and widget; local browser state resets on reload, and focused demo-boundary/browser smoke passed.
- [x] Started AI runtime Phase 1 with tenant-scoped business knowledge sources, `/api/knowledge/sources`, onboarding-to-knowledge sync, extended onboarding business fields, and focused API smoke coverage.
- [x] Implemented AI runtime Phase 2 foundation: Qdrant compose services, tenant knowledge chunks, deterministic local embeddings, reindex/search API, Qdrant-backed indexing, DB fallback search, and focused onboarding-to-RAG smoke coverage.
- [x] Started AI runtime Phase 3 with a queued LangGraph.js `ai.reply` worker path, named graph nodes, RAG context metadata, quality gate fallback, audit/usage logging, idempotent duplicate handling, and `qa:ai:graph` smoke coverage.
- [x] Added Phase 3 zod-validated AI tool schemas and tenant-scoped execution for lead update, lead note creation, status change, draft booking proposal, and handoff task creation; `qa:ai:graph` now verifies tool results, booking draft, note, status change, and duplicate idempotency.
- [x] Added Phase 3 worker reliability foundation with processor timeout wrapper, final-attempt DLQ audit capture, `worker:dlq:inspect`, and `qa:worker:dlq` timeout/failure smoke coverage.
- [x] Moved public Widget, Webhook/API, and Telegram AI reply intake to `ai.reply` queue mode when `AI_REPLY_MODE=queue`; added `qa:ai:queue-routing` route-level smoke for public endpoint queue publishing.
- [x] Added Phase 3 `channels.sendMessage` delivery worker for queued Webhook/API and Telegram AI messages with tenant/channel checks, adapter send, `QUEUED -> SENT/FAILED` status transitions, audit logging, and `qa:channels:delivery` smoke coverage.
- [x] Added `qa:ai:public-loop` smoke for the main clean-account scenario: session-backed clean tenant, onboarding knowledge, RAG reindex/search, public Webhook/API lead, queued LangGraph reply, `channels.sendMessage` delivery, booking draft, inbox, and dashboard verification.
- [x] Started Phase 4 LLMOps with `artifacts/evals/ai-golden-set.json` and `qa:ai:quality`, covering grounded pricing, booking draft, human handoff, and missing-grounding quality gate behavior with pass-rate/score/retrieval thresholds.
- [x] Added `qa:ai:quality` to the LeadVirt.ru GitHub Actions verify job with a Postgres service and migration step, and included `artifacts/evals` in deploy packages.
- [x] Expanded `qa:ai:quality` pilot-niche coverage to beauty, auto detailing, education/course booking, and clinic handoff cases; current deterministic golden set passes 7/7.
- [x] Added optional `qa:ai:real-eval` for real-provider golden-set runs with an LLM judge; it skips unless `AI_EVAL_ENABLE_REAL_PROVIDER=true` is set.
- [x] Added RAGAS-style retrieval metrics and persisted eval reports: `qa:ai:quality` now writes `artifacts/reports/ai-quality-gate-report.json`, `qa:ai:real-eval` writes a real/skip report, and GitHub Actions uploads AI eval reports as artifacts.
- [x] Started Phase 5 observability with a lightweight Prometheus metrics foundation: API `/metrics`, API HTTP request counters/latency, worker `/metrics`, worker job/DLQ counters, AI graph duration/status, and outbound channel delivery outcomes.
- [x] Added Phase 5 per-tenant AI token budget guard with `AI_TENANT_DAILY_TOKEN_BUDGET`, `AI_TENANT_MONTHLY_TOKEN_BUDGET`, pre-call blocking, `BUDGET_BLOCKED` usage logs, and `qa:ai:budget` coverage.
- [x] Added optional Prometheus/Grafana observability profile with local/staging scrape configs and a provisioned `LeadVirt AI Runtime` dashboard.
- [x] Added opt-in OpenTelemetry tracing foundation with OTLP HTTP exporter support and manual spans for API requests, queue publishing, worker jobs, LangGraph graph/nodes, and channel delivery.
- [x] Added Tempo to the optional observability profile and provisioned it as a Grafana trace datasource for OTLP HTTP traces.
- [x] Added richer AI runtime cost/quality panels and metrics: quality-gate outcome counters, budget-block counters, blocked-token counters, and dashboard panels for quality reasons plus budget blocks/tokens.
- [x] Started Phase 6 security hardening with `qa:ai:isolation` and `qa:ai:qdrant-isolation`, covering DB fallback and Qdrant tenant-filtered RAG isolation.
- [x] Added a shared PII/secret redaction helper for observability/runtime payloads, redacted HTTP log route actions, OpenTelemetry error messages/stacks, and AI graph tool-call metadata stored in message metadata, usage logs, lead events, and audit logs.
- [x] Added reusable API `@Roles`/`RolesGuard` RBAC enforcement and restricted knowledge source create/update/archive/reindex endpoints to OWNER, ADMIN, and MANAGER; `qa:rbac:knowledge` verifies VIEWER/AGENT denial and read access.
- [x] Extended Phase 6 RBAC/ABAC to channel create/update endpoints and AI tool execution: channel mutations require OWNER/ADMIN/MANAGER, tool calls verify tenant conversation ownership, lead-conversation consistency, and same-tenant assignees.
- [x] Extended the Phase 6 product RBAC matrix to billing, integrations, and workflows: billing plan/payment mutations require OWNER/ADMIN; integration actions and workflow mutations/tests require OWNER/ADMIN/MANAGER; `qa:rbac:product-matrix` verifies the matrix.
- [x] Added Phase 6 AI audit surface: tenant-scoped `/api/ai-audit`, `qa:ai:audit` redaction/isolation smoke, and `/app/audit` UI for usage logs, quality gates, tool calls, retrieved context, and AI-related audit events.
- [x] Added `qa:ai:audit-ui` Playwright coverage for `/app/audit`, verifying API-backed audit events, payload redaction, and forbidden-role error state.
- [x] Added Phase 6 PII tagging for observability payloads and prompt/eval artifact redaction: `redactAndTagSensitiveData`, sanitized quality/real-eval reports, sanitized real-provider judge payloads, and `qa:ai:eval-redaction`.
- [x] Fixed `RolesGuard` runtime injection so RBAC-protected endpoints use Nest `Reflector` correctly instead of returning 500; re-verified `qa:rbac:knowledge` and `qa:rbac:product-matrix`.
- [x] Added and passed `qa:ai:acceptance`: clean Telegram-auth workspace, onboarding knowledge/catalog/availability, Webhook/API intake, queued LangGraph reply, grounded price/slot answer, RAG evidence, tool calls, delivery, usage, audit, worker metrics, dashboard, inbox, lead detail, and activity timeline.
- [x] Added `qa:ai:acceptance` to the LeadVirt.ru GitHub Actions verify job with Redis, API/worker startup, worker build checks, deterministic Telegram auth token, queue mode, and DB fallback RAG.
- [x] Added `deploy/run-ai-acceptance.sh` and switched the staging env example to `AI_REPLY_MODE=queue` so post-deploy staging acceptance validates the real queued AI path inside Docker Compose.
- [x] Stabilized root TS smoke scripts by using `pnpm exec tsx` without the Windows-breaking extra `--`; re-verified `qa:ai:acceptance`, `qa:ai:quality`, and `qa:pii:redaction`.
- [x] Made draft booking tool planning deterministic for explicit booking requests with an available slot, so staging real-provider acceptance does not depend on the recommendation model choosing `create_booking_draft`.
- [x] Pushed and deployed the AI runtime branch to `leadvirt.ru`; GitHub Actions run `28768725262` passed verify, deploy, and required `qa:ai:acceptance`, then staging `deploy/run-ai-acceptance.sh` passed inside the worker container against the live Docker stack.
- [x] Kept public URL preflight as operator-local QA instead of installing Playwright browsers into deployment images; `release:public-ready` can run non-browser gates with `LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT=1` and marks the report accordingly.
- [x] Confirmed `leadvirt.ru` public auth is Telegram-only with `AUTH_CREDENTIALS_ENABLED=false`; credential-operator 2FA is deferred until password/staff login is intentionally re-enabled.
- [x] Restarted the local Master Budet backend on `localhost:4002` with the live LeadVirt bridge env, updated its side-by-side ports to `API_PORT=4002` and `CORS_ORIGIN=http://localhost:3002`, verified `/health`, and passed the focused `leadvirt-bridge.service.spec.ts`.
- [x] Verified Master Budet uses a real live LeadVirt Webhook/API channel (`lvwh_...`) instead of `demo-generic-webhook`; `qa:pilot:public` passed 3/3 against `https://leadvirt.ru` for Webhook/API, then the disposable `Pilot Webhook Public ...` lead/conversation were removed from staging.
- [x] Regenerated `docs/PILOT_PACKET.md` for `https://leadvirt.ru` and the real `lvwh_...` endpoint; live webhook secrets are redacted by default unless `LEADVIRT_PILOT_PACKET_INCLUDE_SECRETS=1` is explicitly set.
- [x] Updated the deploy workflow artifact upload action to `actions/upload-artifact@v7` to clear the Node 20 runtime deprecation warning.
- [x] Added `qa:release-readiness` to guard pilot packet secret redaction and skipped public-preflight report mode.
- [x] Added `qa:release-readiness` to the LeadVirt.ru GitHub Actions verify job.
- [x] Added and verified `qa:meta:instagram`: Meta Page `LeadVirt.ai`, connected IG `@leadvirt.ai`, granted messaging permissions, Page token, and Instagram conversations query pass without logging secrets.
- [x] Added `META_REQUIRE_INSTAGRAM_CONVERSATION=1` mode for `qa:meta:instagram` so real Instagram DM smoke fails unless at least one conversation is visible.
- [x] Documented the AI runtime implementation plan in `docs/AI_RUNTIME_IMPLEMENTATION_PLAN.md` and recorded the LangGraph/Qdrant production-runtime decision in `docs/DECISION_LOG.md`.
- [x] Fixed Landing initial-load stutter while preserving animations: landing now renders mostly as server HTML, product providers moved off the root layout, expensive blur/image work was reduced, Niches motion loads on scroll, and focused performance/scroll Playwright smokes were added.
- [x] Optimized only the Landing first-screen hero appearance by moving hero entrance/visual animation frames from Framer Motion to CSS keyframes while preserving the animated cards, central node, and gradient SVG flow line; verified with web typecheck/lint/build and Playwright screenshots on `localhost:3001`.
- [x] Fixed the Landing hero SVG flow-line first-load micro-freeze by starting the dash animation inside its cycle and verified locally that the freeze is gone.
- [x] Created a local root `.env` for LeadVirt `localhost:3001`/`localhost:4001` development and scrubbed `AI_API_KEY` from `.env.example`.
- [x] Added shared root `.env` loading for API, worker, AI smoke, and public-release readiness scripts without overriding already-provided process environment variables.
- [x] Made OpenAI `AI_REASONING_EFFORT` and `AI_VERBOSITY` runtime-configurable through `@leadvirt/config` and the shared `OpenAiProvider`.
- [x] Fixed `qa:ai:provider` to run through an API package script and use a clean ASCII smoke prompt.
- [x] Added the `AI_ENABLE_REAL_PROVIDER` safety gate so local `AI_PROVIDER=openai` config stays on mock AI until real provider calls are explicitly enabled.
- [x] Verified env-aware AI configuration with `@leadvirt/config`, `@leadvirt/ai`, `@leadvirt/api`, and `@leadvirt/worker` typecheck/lint/build; with the current local `.env`, `qa:ai:provider` passes on mock AI with one warning because `AI_ENABLE_REAL_PROVIDER=false`.
- [x] Fixed clean-workspace Integrations so copied design defaults no longer count disconnected providers as connected before tenant API data loads.
- [x] Fixed clean-workspace Analytics so no response samples return `0` average/p90 seconds, no fake scenario run counts, and no static AI insights.
- [x] Added focused empty-state Playwright coverage for Integrations connected counts and Analytics response-time KPI.
- [x] Verified the clean Integrations/Analytics fixes with API/Web typecheck, lint, build, focused Playwright `integrations-api` + `analytics-api` specs, and a restarted web dev server on `localhost:3001`.
- [x] Stabilized the clean-user data-separation smoke for cold Next dev route loads by using route content readiness instead of `networkidle` and giving the multi-route audit enough time to complete.
- [x] Ran the full regression QA after clean-user verification: `qa:api` passed 43/43 and `qa:visual` passed 32/32 against LeadVirt `localhost:3001`/`localhost:4001` and design reference `localhost:5173`.
- [x] Ran `release:public-ready` dry run after real OpenAI smoke; it fails closed at environment validation and writes `docs/PUBLIC_RELEASE_READY_REPORT.md` with AI configured and public/provision env still missing.
- [x] Generated a dedicated local ED25519 SSH key for `leadvirt-staging-01` and documented the public key/fingerprint in `docs/SERVER_SETUP.md`.
- [x] Added `artifacts/scripts/server-post-install.sh` for Ubuntu 24.04 server bootstrap with deploy user, SSH hardening, UFW, fail2ban, unattended upgrades, Docker Engine, swap, and LeadVirt directories.
- [x] Bootstrapped the new VPS `193.187.92.88` as `leadvirt-staging-01`; verified `deploy` SSH, Docker/Compose, UFW, fail2ban, unattended upgrades, swap, and LeadVirt directories.
- [x] Added the staging Docker deployment kit: root `Dockerfile`, `.dockerignore`, nginx reverse proxy, `deploy/docker-compose.staging.yml`, and `deploy/env.staging.example`.
- [x] Deployed LeadVirt to `/opt/leadvirt/current` on `193.187.92.88` with Docker Compose, Postgres, Redis, API, worker, web, and nginx on public HTTP port 80.
- [x] Created the clean staging operator account `staging-admin@leadvirt.ai`; credentials are stored server-side in `/opt/leadvirt/secrets/operator-login.txt`.
- [x] Verified staging health, landing, `/demo`, no-cookie API `401`, `/app` unauth client redirect to `/login`, clean workspace zero metrics/lists, and strict auth readiness for `staging-admin@leadvirt.ai`.
- [x] Bootstrapped the FR AI gateway VPS `147.90.14.240` as `fr-vmnano`, deployed the AI gateway on `https://147-90-14-240.sslip.io:8443/v1`, and restricted OpenAI proxy access to the main staging server IP.
- [x] Switched staging `AI_BASE_URL` to the FR AI gateway and verified real OpenAI `qa:ai:provider` passes from the staging API container with `gpt-5.5`.
- [x] Reran staging public-release checks after the AI gateway change: AI smoke, strict auth readiness, Webhook/API provisioning, and pilot packet generation passed; public URL preflight passed locally 3/3 because the runtime API container does not include a Playwright browser.
- [x] Removed disposable public-preflight `Pilot ...` records from the staging operator tenant after verification.
- [x] Chose the production domain split: `leadvirt.ru` for the current Russian-market release and `leadvirt.ai` for the later English/global version.
- [x] Replaced Caddy with nginx in deploy configs and on the running main staging server.
- [x] Replaced the FR AI gateway runtime with nginx, issued a certbot certificate for `147-90-14-240.sslip.io`, kept `xray` on port `443`, and re-verified real OpenAI smoke through the gateway.
- [x] Prepared `leadvirt.ru` HTTPS cutover kit: nginx HTTPS template, certbot webroot, port `443` mapping, cutover script, and cert renewal script on staging.
- [x] Enabled production HTTPS on `https://leadvirt.ru` and `https://www.leadvirt.ru`, switched staging/public env to `https://leadvirt.ru`, installed cert renewal, and verified health, redirects, auth readiness, AI smoke, and public URL preflight.
- [x] Updated local Master Budet backend bridge env to send order intake to the live LeadVirt Webhook/API channel at `https://leadvirt.ru`.
- [x] Verified the Master Budet LeadVirt bridge contract with focused Jest, backend typecheck, a real `https://leadvirt.ru` webhook smoke, and cleanup of the disposable smoke records.
- [x] Added RU auth identifier policy: signup/login accept Russian email domains or Russian `+7` phone numbers, reject non-RU mailbox domains, and keep `leadvirt.ai` as a staff exception.
- [x] Added `User.phone`, the additive `user_phone` migration, phone-aware auth payloads, and phone display in the product shell.
- [x] Documented `AUTH_IDENTIFIER_POLICY`, `AUTH_STAFF_EMAIL_DOMAINS`, and `AUTH_EXTRA_ALLOWED_EMAIL_DOMAINS` in `.env.example`.
- [x] Updated auth UI copy to "Почта или телефон", removed prefilled auth/reset emails, and refreshed auth QA defaults to Russian test addresses.
- [x] Added and verified `qa:auth:identifier-policy` for RU email/phone acceptance and non-RU email rejection.
- [x] Switched RU public auth to Telegram-only registration/login with `POST /auth/telegram`, signed payload verification, clean first-workspace creation, and `authMode: "telegram"`.
- [x] Replaced login/signup UI with Telegram auth only and redirected public password reset pages back to `/login`; credential auth remains a local/staff fallback behind `AUTH_CREDENTIALS_ENABLED`.
- [x] Added `TELEGRAM_LOGIN_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT`, and `qa:auth:telegram` coverage for invalid signatures, first login, repeat login, and Telegram auth mode.
- [x] Verified Telegram auth with API/Web typecheck, lint, build, `qa:auth:telegram`, focused Playwright `auth-flow`, and desktop/mobile screenshots.
- [x] Deployed Telegram auth to `https://leadvirt.ru` with `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT=LeadVirtAi_bot`, server-side Telegram login token, `AUTH_CREDENTIALS_ENABLED=false`, rebuilt containers, and verified health, no-cookie `401`, password-login disablement, password-reset redirect, and production `qa:auth:telegram`.
- [x] Verified BotFather `/setdomain` for `@LeadVirtAi_bot`: `https://leadvirt.ru/login` now renders the real Telegram login button instead of `Bot domain invalid`.
- [x] Re-ran production Telegram auth smoke inside the API container after BotFather setup; signature verification, first workspace creation, repeat login, and cleanup passed.
- [x] Replaced the visible nested Telegram button with a real Telegram iframe underneath and a LeadVirt green visual mask above it using `pointer-events: none`; verified web typecheck/lint/build, production deploy, health, no-cookie `401`, final `https://leadvirt.ru/login` screenshot, and click-through popup opening to Telegram OAuth.
- [x] Added GitHub Actions auto-deploy for `leadvirt.ru`: verify shared types/API/Web, upload a release over SSH, switch `/opt/leadvirt/current`, rebuild Docker Compose, and verify health plus no-cookie `401`.
- [x] Generated a dedicated `leadvirt-github-actions` ED25519 key, installed its public key for `deploy@193.187.92.88`, and verified SSH/Docker access with that key.
- [x] Installed GitHub CLI locally, added `LEADVIRT_DEPLOY_SSH_KEY` to `artur-kamalov/LeaedVIrtAi`, fixed the deploy package path, and verified GitHub Actions run `28728555134` deploys `leadvirt.ru` successfully.
- [x] Updated the deploy workflow to current GitHub Actions runtime majors (`actions/checkout@v7`, `actions/setup-node@v6`) and verified run `28728749943` deploys successfully without the Node 20 deprecation warning.
- [x] Enforced the demo/real-data boundary: `/app/**` now requires a real user session and renders only tenant DB data, while `/demo` is a static read-only preview.
- [x] Removed anonymous demo fallback from tenant-scoped API/UI paths; missing sessions return `401` or redirect to `/login` instead of loading demo tenant data.
- [x] Added `qa:demo-boundary` and Playwright clean-user separation coverage; verified full `qa:api` passes 38/38 with credentials-only app access.
- [x] Removed remaining Settings/Profile fake defaults, copied demo team members, fake API keys, and hardcoded Analytics recommendation numbers from real product pages.
- [x] Updated visual smoke to authenticate protected app routes as a clean user and verified `qa:visual` passes 32/32.
- [x] Re-verified the demo/real-data cleanup with `@leadvirt/web` typecheck, lint, production build, `qa:demo-boundary`, focused clean-user/settings specs, full `qa:visual` 32/32, and full `qa:api` 38/38.
- [x] Removed the unused copied `design/product/data.ts` fixture file and added a guardrail that fails if demo fixtures return to the real product design area.
- [x] Renamed the backend credentials-only guard from `DemoAuthGuard` to `WorkspaceAuthGuard` and re-verified protected API routes with full `qa:api` 38/38.
- [x] Fixed `@leadvirt/api start` to use the actual compiled entry and verified API start on `localhost:4001` with `/health` and `/health/ready`.
- [x] Audited `apps/web/src/legacy-functional` in `docs/LEGACY_FUNCTIONAL_AUDIT.md` and confirmed active app code does not import legacy UI or `features/mock`.
- [x] Extended `qa:demo-boundary` to fail if active app code imports `legacy-functional` or `features/mock`.
- [x] Removed the implicit `demo-website-widget` fallback from production widget frame/embed paths; `/widget/demo` remains the explicit demo surface.
- [x] Added widget coverage that verifies embed/frame require an explicit public key and re-verified full `qa:api` 39/39.
- [x] Renamed integration sample payloads/actions from demo-looking values to explicit `sample` values and extended `qa:demo-boundary` to catch regressions in integration samples.
- [x] Added Settings Security TOTP 2FA setup, QR rendering, enable/disable actions, hashed recovery codes, 2FA-aware login, and encrypted TOTP secret storage.
- [x] Added and applied the additive `user_two_factor` DB migration locally, plus `AUTH_2FA_ENCRYPTION_KEY` in `.env.example`.
- [x] Verified 2FA hardening with DB validate/generate/migrate, DB/API/Web typechecks, API/Web lint/build, focused Settings Playwright smoke, full `qa:api` 39/39, and a live API 2FA smoke.
- [x] Added self-service password reset request/confirm flow with hashed reset tokens, local/mock reset URL delivery, session revocation, and `/forgot-password` plus `/reset-password` UI.
- [x] Added and applied the additive `password_reset_tokens` DB migration locally.
- [x] Verified password reset with DB validate/generate/migrate, DB/API/Web typechecks, API/Web lint/build, focused Auth Playwright smoke, and a live API reset smoke.
- [x] Added in-memory auth rate limiting for login, signup, password-reset request, and password-reset confirm endpoints, with `AUTH_RATE_LIMIT_DISABLED` as a local escape hatch.
- [x] Added `qa:auth:rate-limit` and verified repeated password reset requests return `429`.
- [x] Added and locally verified `qa:auth:staging-ready` to validate auth migrations, seed credential ownership, no-cookie API guard behavior, and staging/public auth env posture before external release.
- [x] Decided Webhook/API via the Master Budet order bridge as the first real acquisition channel for external release.
- [x] Added `POST /channels` provisioning for Website, Telegram, and Webhook/API channels with generated non-demo public keys.
- [x] Added Settings > Channels Webhook/API setup details so operators can copy endpoint, public key, secret header, and secret for the Master Budet bridge.
- [x] Added and locally verified `qa:channels:provisioning` for creating a real Webhook/API channel on a temporary workspace and accepting public intake through it.
- [x] Added `provision:webhook-channel` to create/reuse a target workspace Webhook/API channel and print Master Budet bridge env values without persisting secrets by default.
- [x] Added `release:public-ready` to orchestrate strict auth readiness, Webhook/API provisioning, pilot packet generation, and public URL preflight for staging/public release.
- [x] Updated `qa:pilot:public` to support `LEADVIRT_PUBLIC_CHANNELS`, so the first real release can validate only `webhook` instead of requiring Telegram and Widget.
- [x] Verified `qa:pilot:public` with local public env and `LEADVIRT_PUBLIC_CHANNELS=webhook`, then removed the disposable pilot record with confirm-gated cleanup.
- [x] Added a non-production QA header bypass for auth login rate limiting so repeated Playwright clean-user logins stay stable while production and explicit rate-limit tests remain protected.
- [x] Re-verified the release smoke after auth/channel hardening with full `qa:api` passing 41/41, `qa:auth:rate-limit`, and `qa:auth:staging-ready` on `localhost:3001`/`localhost:4001`.
- [x] Verified `release:public-ready` fails closed without public/staging env and writes a redacted `docs/PUBLIC_RELEASE_READY_REPORT.md` listing the missing variables.
- [x] Added a real OpenAI AI provider behind `AI_PROVIDER=openai` using the Responses API with structured JSON outputs, while keeping `AI_PROVIDER=mock` as the local QA default.
- [x] Switched API sync paths and worker queue processing to the shared AI provider token so Conversation, Widget, Telegram, Webhook/API, and queued AI replies use the configured provider.
- [x] Updated `release:public-ready` to block public/staging release unless `AI_PROVIDER=openai` and `AI_API_KEY` are set, with AI secrets redacted in the readiness report.
- [x] Added `qa:ai:provider` to validate AI reply, extraction, recommendation, summary, and intent provider contracts locally with mock AI and on staging with real OpenAI.
- [x] Included `qa:ai:provider` in `release:public-ready` after env validation so invalid OpenAI keys/models fail before channel provisioning.
- [x] Verified the OpenAI provider abstraction with `@leadvirt/ai` lint/typecheck/build, `@leadvirt/config` lint/typecheck/build, `@leadvirt/api` lint/typecheck/build, `@leadvirt/worker` lint/typecheck/build, `qa:ai:provider`, `qa:channels:provisioning`, and full `qa:api` 41/41.
- [x] Copied UI/UX source from `LeadVirt-React-design-only` into `apps/web/src/design`.
- [x] Copied design styles and adapted them into `apps/web/src/styles`.
- [x] Kept `apps/web` as a Next 15 app instead of running Vite inside web.
- [x] Added Next route wrappers for landing, onboarding, app dashboard, inbox, conversation, leads, automations, analytics, integrations, settings, pricing, features, solutions, and demo.
- [x] Adapted copied `NavProvider` to map design routes to Next routes.
- [x] Added design dependencies required by copied components.
- [x] Extended Tailwind scanning and tokens for copied design components.
- [x] Archived old web UI areas under `apps/web/src/legacy-functional`.
- [x] Fixed copied UI compatibility issues found during migration:
  - [x] Windows `Button.tsx` / `button.tsx` case collision.
  - [x] shadcn button adapter for design variants and sizes.
  - [x] integrations disconnect handler.
  - [x] automation `AnimatePresence` fragment warning.
  - [x] local grain/noise style instead of broken external noise asset.
  - [x] mobile conversation header layout overlap.
  - [x] Next ESLint plugin detection warning.
- [x] Verified `@leadvirt/web` with typecheck, lint, and production build.
- [x] Added Playwright visual and interaction smoke spec at `artifacts/playwright/visual-check.spec.ts`.
- [x] Verified main desktop and mobile routes with fresh screenshots.
- [x] Verified desktop sidebar navigation and mobile bottom navigation route mapping.
- [x] Changed product sidebar and mobile bottom navigation from route buttons to real Next links while preserving copied visual styling.
- [x] Stabilized visual route-change assertions for cold Next dev compilation.
- [x] Verified visual smoke against web `localhost:3001` and design-only reference `localhost:5173`: 32/32 checks passed.
- [x] Verified `@leadvirt/web` production build after the product navigation link change and restarted Next dev on `localhost:3001`.
- [x] Re-verified ProductLayout identity, notifications, search, and logout smoke after the navigation link change: 4/4 checks passed.
- [x] Re-verified the full API-backed Playwright smoke suite after product navigation and port documentation cleanup: `qa:api` passed 34/34 on `localhost:3001`/`localhost:4001`.
- [x] Relaunched the local LeadVirt stack on `localhost:3001`/`localhost:4001` with Docker Postgres/Redis, applied migrations/seed, and verified web root, app dashboard, API health, and API readiness.
- [x] Created a fully clean local credential account through `/auth/signup` and verified its new tenant has 0 leads, 0 conversations, 0 workflows, 0 workflow runs, 0 webhook events, 0 channels, and 0 integrations.
- [x] Replaced copied Dashboard demo fallbacks with API-backed empty states for clean workspaces.
- [x] Added real `recentLeads` to `/dashboard/summary` so the Dashboard latest-leads card reads from the database.
- [x] Filtered user-facing Dashboard activity to product events so clean workspaces do not show auth login/signup audit rows.
- [x] Changed Dashboard average response time to return `0` instead of a fake default when no response samples exist.
- [x] Constrained product sidebar width/overflow so active nav borders, billing card, and account identity stay inside the drawer.
- [x] Replaced product-shell fake notification and billing/sidebar fallback content with API-backed empty states.
- [x] Added focused clean-workspace Dashboard/sidebar Playwright smoke at `artifacts/playwright/dashboard-clean-user.spec.ts`.
- [x] Added root QA scripts `qa:api`, `qa:visual`, and `qa:all` while keeping Playwright as an artifact-level `pnpm dlx` dependency.
- [x] Added project agent working rules in `agents.md`.
- [x] Added this checklist and decision log workflow.
- [x] Reconnected the copied design dashboard to the existing `/dashboard/summary` API with demo fallback.
- [x] Aggregated API channel performance by design channel id to avoid duplicate React keys.
- [x] Added real dashboard metric deltas to the `/dashboard/summary` API using current 7 days versus previous 7 days.
- [x] Replaced dashboard stat-card placeholder deltas with API-provided deltas while preserving copied design fallback.
- [x] Added Playwright dashboard API smoke at `artifacts/playwright/dashboard-api.spec.ts`.
- [x] Updated Playwright smoke to tolerate optional API-offline fallback for local visual QA.
- [x] Reconnected the copied design inbox list to `listInboxConversations()` with copied demo fallback.
- [x] Mapped API conversation ids into copied inbox rows so navigation can carry real conversation ids.
- [x] Localized known API seed/demo inbox strings to keep the Russian UI consistent.
- [x] Reconnected copied conversation detail to `getConversation()` with demo fallback.
- [x] Reconnected copied conversation send flow to `sendConversationMessage()` with optimistic local rendering.
- [x] Added `apps/web/src/design/product/apiAdapters.ts` for API-to-design lead/message mapping.
- [x] Fixed conversation auto-scroll so the chat scrolls internally without clipping the page back button.
- [x] Changed landing CTA buttons to real Next links so navigation works before React hydration.
- [x] Updated Playwright navigation smoke for link-based landing CTA.
- [x] Added Playwright send-flow smoke at `artifacts/playwright/conversation-send.spec.ts`.
- [x] Reconnected copied CRM pipeline to `getPipelineSummary()` with demo fallback.
- [x] Mapped API lead ids separately from optional conversation ids for safe pipeline actions and dialog navigation.
- [x] Reconnected pipeline stage advance to `updateLead()` with optimistic UI and rollback.
- [x] Reconnected pipeline quick actions to `sendLeadToCrm()`, `createLeadTask()`, `bookLeadAppointment()`, and `updateLead()`.
- [x] Improved mobile pipeline layout so kanban columns stack vertically on narrow screens.
- [x] Localized known API seed/source labels used by pipeline cards.
- [x] Added Playwright pipeline action smoke at `artifacts/playwright/pipeline-actions.spec.ts`.
- [x] Reconnected `/login` and `/signup` from redirect stubs to copied-design auth screens.
- [x] Added `getAuthMe()` API adapter for demo auth verification through `/auth/me`.
- [x] Stored demo session metadata locally after auth verification for later functional layering.
- [x] Added Playwright auth flow smoke at `artifacts/playwright/auth-flow.spec.ts`.
- [x] Added `/login` and `/signup` to the desktop/mobile visual smoke screenshot sweep.
- [x] Reconnected copied onboarding flow to `/onboarding/state` and `/onboarding/complete-step`.
- [x] Added onboarding state hydration, progress persistence, and local-change protection during late API hydration.
- [x] Added Playwright onboarding API smoke at `artifacts/playwright/onboarding-api.spec.ts`.
- [x] Updated visual smoke readiness so resumed onboarding steps remain valid.
- [x] Reconnected copied analytics page to `getAnalyticsOverview()` with copied demo fallback.
- [x] Mapped analytics API channel, KPI, trend, scenario, response-time, and AI-insight data into copied chart cards.
- [x] Added Playwright analytics API smoke at `artifacts/playwright/analytics-api.spec.ts`.
- [x] Reconnected copied integrations page to `listIntegrations()` with copied demo fallback.
- [x] Mapped copied integration cards to API providers for connect, disconnect, connection test, and sample inbound actions.
- [x] Added optimistic integration connect/disconnect UI with rollback on API failure.
- [x] Added Playwright integrations API smoke at `artifacts/playwright/integrations-api.spec.ts`.
- [x] Reconnected copied automation page to `listWorkflows()` with copied demo fallback.
- [x] Mapped API workflow steps into copied automation block cards.
- [x] Reconnected workflow test, save, publish, and pause behavior to the workflows API.
- [x] Localized known API workflow seed names, descriptions, and step labels for the Russian product UI.
- [x] Added Playwright automation API smoke at `artifacts/playwright/automation-api.spec.ts`.
- [x] Added backend workflow step persistence through `UpsertWorkflowDto.steps`.
- [x] Synced workflow step create/update/delete on `PATCH /workflows/:id`.
- [x] Reconnected automation block add/delete/toggle save to workflow step payloads.
- [x] Persisted automation block type, name, position, enabled state, and subtitle in workflow step config.
- [x] Extended Playwright automation smoke to verify saved step payloads.
- [x] Modeled copied automation right-panel settings as editable `WorkflowBlock.config`.
- [x] Reconnected trigger, AI greeting, qualification, condition, booking, follow-up, and CRM settings controls to block config.
- [x] Persisted detailed automation settings through workflow step `config`.
- [x] Extended Playwright automation smoke to verify settings config payloads.
- [x] Reconnected copied settings page to `/settings/account`, `/settings/team`, `/settings/security`, and `/settings/billing`.
- [x] Reconnected company profile save to `updateAccountSettings()`.
- [x] Mapped API team, security, and API key data into copied settings tabs with demo fallback.
- [x] Added Playwright settings API smoke at `artifacts/playwright/settings-api.spec.ts`.
- [x] Reconnected `/app/billing` to the copied settings billing tab with a route-specific title and initial tab.
- [x] Reconnected billing plan, subscription, and usage data to `listBillingPlans()`, `getCurrentSubscription()`, and `getBillingUsage()`.
- [x] Routed copied "upgrade plan" controls to `/app/billing` while keeping the settings nav item active.
- [x] Added Playwright billing API smoke at `artifacts/playwright/billing-api.spec.ts`.
- [x] Added `/app/billing` to the desktop/mobile visual screenshot sweep.
- [x] Added tenant-scoped `PATCH /channels/:id` for channel status and settings updates.
- [x] Reconnected the copied settings Channels tab to real `listChannels()` data.
- [x] Added website widget settings modal in Settings > Channels backed by channel `settings.widget`.
- [x] Added Playwright widget settings smoke at `artifacts/playwright/channels-widget-settings.spec.ts`.
- [x] Verified public website widget config and message send flow through mocked `/public/widget/:publicKey` API.
- [x] Verified widget embed script points the iframe at the requested public key.
- [x] Added Playwright widget API smoke and open-widget screenshot at `artifacts/playwright/widget-api.spec.ts`.
- [x] Reconnected conversation side-panel and mobile sticky lead actions to existing lead APIs.
- [x] Used the API `conversation.lead.id` for conversation actions instead of the conversation route id.
- [x] Added loading/disabled states for conversation CRM, task, appointment, and qualification actions.
- [x] Added Playwright conversation action smoke at `artifacts/playwright/conversation-actions.spec.ts`.
- [x] Reused shared `apiAdapters.ts` in Inbox, Dashboard, and Analytics instead of keeping duplicated channel/time/lead mapping helpers.
- [x] Reduced copied page bundle sizes by removing duplicate adapter code from API-backed product pages.
- [x] Decided and implemented inbox empty-state policy: API success with zero conversations shows a real empty state.
- [x] Kept copied demo inbox fallback only for API failure/offline visual QA.
- [x] Added Playwright inbox empty-state smoke at `artifacts/playwright/inbox-empty-state.spec.ts`.
- [x] Scanned copied design UI, docs, agent rules, and Playwright specs for replacement characters and common mojibake tokens after Russian-heavy UI edits.
- [x] Added shared `useApiResource()` for read-only API hydration with demo fallback behavior.
- [x] Refactored Dashboard and Analytics read-only API loads onto the shared resource hook while preserving copied UI structure.
- [x] Reconnected copied conversation menu actions to conversation handoff and status APIs.
- [x] Added an accessible label to the conversation action menu trigger.
- [x] Added Playwright conversation status action smoke at `artifacts/playwright/conversation-status-actions.spec.ts`.
- [x] Included conversation status action smoke in root `qa:api`.
- [x] Stabilized automation API smoke against late workflow hydration by waiting for seeded trigger settings before editing.
- [x] Replaced the hardcoded standalone AI reply controller with conversation-scoped AI draft replies through `ConversationsService`.
- [x] Added shared `AiDraftReply` type and web `draftAiReply()` API adapter.
- [x] Added copied conversation menu action "AI-подсказка" that drafts text into the composer without sending it automatically.
- [x] Added an accessible label to the copied conversation send button.
- [x] Added Playwright AI draft smoke at `artifacts/playwright/conversation-ai-draft.spec.ts`.
- [x] Included AI draft smoke in root `qa:api`.
- [x] Updated visual smoke to tolerate known offline API connection-refused noise while still comparing against the design-only reference server.
- [x] Reconnected copied conversation timeline to API `ConversationDetail.events` with copied demo timeline fallback.
- [x] Mapped lead event types to existing copied timeline icons and colors.
- [x] Added Playwright conversation events timeline smoke at `artifacts/playwright/conversation-events-timeline.spec.ts`.
- [x] Included conversation events timeline smoke in root `qa:api`.
- [x] Added tenant API adapter for `/current-tenant` and `/tenants`.
- [x] Reconnected copied product shell account identity to `/auth/me` and `/current-tenant` with copied demo fallback.
- [x] Added Playwright product shell identity smoke at `artifacts/playwright/product-layout-identity.spec.ts`.
- [x] Included product shell identity smoke in root `qa:api`.
- [x] Added `IntegrationAccount.settings` to shared types and API integration responses.
- [x] Reconnected copied integrations "Настроить" menu action to `PATCH /integrations/:provider/settings`.
- [x] Added copied integrations settings modal for display name, endpoint, token, sync mode, sync enabled, and notes.
- [x] Extended integrations API smoke to verify settings modal edits and PATCH payloads.
- [x] Fixed shared copied dropdown items so menus close after selecting an action.
- [x] Replaced copied conversation "Экспорт переписки" toast placeholder with a real `.txt` transcript download.
- [x] Added Playwright conversation export smoke at `artifacts/playwright/conversation-export.spec.ts`.
- [x] Included conversation export smoke in root `qa:api`.
- [x] Separated landing CTA routes: `Войти` opens `/login`, while `Смотреть демо` opens `/demo`.
- [x] Changed `/demo` from a duplicate landing page to a product demo dashboard.
- [x] Updated auth copy so `/login` reads as client cabinet access instead of demo workspace access.
- [x] Extended visual smoke to cover `/demo` and landing CTA route separation.
- [x] Added MVP workflow runtime executor in the API for active automation scenarios on inbound widget/webhook/telegram messages.
- [x] Replaced workflow test-run placeholder with real step-by-step `WorkflowRun` / `WorkflowRunEvent` execution.
- [x] Added workflow runtime usage counter increments and lead timeline events for completed automation runs.
- [x] Reconnected Inbox right-panel `В CRM` and `Создать задачу` quick actions to lead APIs using the API lead id.
- [x] Added persisted Settings team management for invite/create, role update, and member removal.
- [x] Added persisted Settings notification preferences through tenant settings.
- [x] Added persisted Settings API key creation and revoke endpoints with one-time secret display in the UI.
- [x] Added Playwright smoke coverage for Inbox quick actions and extended Settings API actions.
- [x] Stabilized the visual smoke route wait so the full copied UI sweep does not time out during long navigation checks.
- [x] Verified copied Next UI against the design-only reference with Playwright visual smoke: 32/32 desktop/mobile checks passed.
- [x] Replaced the copied Analytics `Экспорт` toast placeholder with a real CSV report download built from the current KPI, channel, scenario, trend, response-time, and AI-insight data.
- [x] Extended Analytics Playwright smoke to verify the exported CSV filename and API-backed report contents.
- [x] Audited active copied UI strings through UTF-8 reads; current mojibake seen in PowerShell output is terminal decoding noise, not stored broken text.
- [x] Added period-aware `/analytics/overview?period=7d|30d|quarter` backend aggregation for leads, bookings, orders, workflow runs, response time, and trend buckets.
- [x] Reconnected Analytics period controls to refetch API data instead of only changing local UI state.
- [x] Extended Analytics Playwright smoke to verify `period=30d`, `period=7d`, and CSV export content.
- [x] Kept copied Automation fallback scenario tabs visible alongside API workflows.
- [x] Added create-on-save behavior for copied Automation scenario tabs that do not yet have a backend workflow.
- [x] Let the database generate workflow step ids for newly created Automation scenarios to avoid collisions with copied static block ids.
- [x] Extended Automation Playwright smoke to verify workflow creation, publish, and generated-step-id payload behavior.
- [x] Added API-backed Automation `Дублировать` action that creates and publishes a copy of the current workflow without reusing copied step ids.
- [x] Added API-backed Automation `Архив` action that marks the current workflow `ARCHIVED` and returns the slot to a copied template.
- [x] Hid archived workflows from the default `/workflows` builder list.
- [x] Extended Automation Playwright smoke to verify duplicate and archive behavior.
- [x] Added Automation archive modal backed by `/workflows?includeArchived=true`.
- [x] Added Automation restore action that returns archived workflows to the builder as `PAUSED`.
- [x] Extended Automation Playwright smoke to verify archived listing and restore behavior.
- [x] Added Automation workflow status badges for template, active, draft, paused, archived, and restored states.
- [x] Extended Automation Playwright smoke to verify active, draft, paused, and restored badges.
- [x] Stabilized signup auth-flow smoke by giving the onboarding redirect the same timeout as login.
- [x] Added visible Automation unsaved-changes state by comparing the active builder draft with the last saved workflow snapshot.
- [x] Updated the Automation save button to show when it will save edited changes.
- [x] Extended Automation Playwright smoke to verify dirty state appears after edits and clears after save.
- [x] Added Playwright social intake visibility smoke for Telegram and Instagram leads across Inbox and Pipeline.
- [x] Included social intake visibility coverage in root `qa:api`.
- [x] Verified `qa:api` after a clean Next dev restart: 28/28 tests passed.
- [x] Added first social test-client pilot runbook at `docs/FIRST_CLIENT_PILOT_RUNBOOK.md`.
- [x] Added Playwright webhook/widget intake visibility smoke for public-entry leads across Inbox and Pipeline.
- [x] Included webhook/widget intake visibility coverage in root `qa:api`.
- [x] Verified `qa:api` after intake coverage expansion: 29/29 tests passed.
- [x] Added opt-in real local API pilot smoke at `artifacts/playwright/pilot-real-intake-api.spec.ts`.
- [x] Added root script `qa:pilot:intake` for seeded demo public intake validation.
- [x] Verified `qa:pilot:intake`: creates a temporary active workflow, posts Telegram/webhook/widget inbound messages, checks Inbox, Pipeline, workflow timeline events, manager follow-up, and archives the temporary workflow.
- [x] Added confirm-gated pilot cleanup utility at `packages/db/prisma/cleanup-pilot.ts`.
- [x] Added root script `db:cleanup:pilot` with dry-run default and documented `-- --confirm` usage in the pilot runbook.
- [x] Verified `db:cleanup:pilot` dry-run against local demo data and `@leadvirt/db` typecheck.
- [x] Surfaced API-provided Telegram/Webhook public endpoint metadata in the copied Integrations settings modal.
- [x] Added copy controls for endpoint URL, public key, secret header, and sample payload in the Integrations endpoint panel.
- [x] Extended Integrations Playwright smoke to verify pilot endpoint details render in the copied UI.
- [x] Verified Integrations endpoint panel with `@leadvirt/web` typecheck, lint, production build, focused integrations smoke, and full `qa:api` 29/29.
- [x] Added `/app/integrations` pilot readiness indicators for Telegram, Webhook/API, and the website widget using integration and channel API data.
- [x] Extended Integrations Playwright smoke to verify readiness keys for Telegram, Webhook/API, and Website widget.
- [x] Updated the first-client pilot runbook with the new Integrations readiness panel.
- [x] Verified Integrations readiness work with `@leadvirt/web` typecheck, lint, production build, focused Integrations smoke, focused Analytics warm-up, and full `qa:api` 29/29.
- [x] Added direct `Тестовый лид` actions for Telegram and Webhook/API inside the Integrations readiness panel.
- [x] Added direct `Открыть виджет` action from the Integrations readiness panel to the local widget demo.
- [x] Extended Integrations Playwright smoke to click readiness-panel sample actions and verify the sample-inbound API calls.
- [x] Verified actionable readiness panel with `@leadvirt/web` typecheck, lint, production build, focused Integrations smoke, and full `qa:api` 29/29.
- [x] Added opt-in public URL/tunnel pilot preflight at `artifacts/playwright/pilot-public-url-preflight.spec.ts`.
- [x] Added root script `qa:pilot:public` for external/public route and intake validation.
- [x] Documented public URL/tunnel preflight env vars in the first-client pilot runbook.
- [x] Verified `qa:pilot:public` skips without public URL env and passes against local web/API URLs with seeded demo keys.
- [x] Added `pilot:packet` generator for current operator links, public keys, intake endpoints, headers, sample payloads, QA commands, and cleanup commands.
- [x] Generated `docs/PILOT_PACKET.md` from the current local API readiness state.
- [x] Documented packet generation in the first-client pilot runbook.
- [x] Verified the packet generator with `node --check` and `corepack pnpm run pilot:packet`.
- [x] Added copy/paste PowerShell manual intake smoke commands for Telegram, Webhook/API, and Widget to the generated pilot packet.
- [x] Verified the generated manual intake commands against the local API and confirmed they return conversation/lead ids.
- [x] Verified `db:cleanup:pilot` dry-run still captures packet-created pilot records through existing cleanup prefixes.
- [x] Added read-only `pilot:doctor` preflight for local web/API routes, seeded public keys, connected intake integrations, widget config, and packet/base consistency.
- [x] Added `pilot:doctor` to the first-client pilot runbook and generated pilot packet.
- [x] Verified `pilot:doctor` against the current local web/API setup.
- [x] Added `pilot:ready` orchestration command for day-of-pilot readiness: packet generation, doctor, local real-intake smoke, optional public preflight, and cleanup dry-run.
- [x] Added `pilot:ready` to the generated packet and first-client pilot runbook as the recommended combined preflight.
- [x] Verified `pilot:ready` full local path and `LEADVIRT_READY_SKIP_LOCAL_INTAKE=1` dry path against the current local setup.
- [x] Added persistent `docs/PILOT_READY_REPORT.md` output from `pilot:ready` with step status, command tails, environment, skip reasons, and cleanup dry-run counts.
- [x] Documented the readiness report in the first-client pilot runbook and generated pilot packet.
- [x] Added Master Budet outbound LeadVirt bridge in `C:\Users\camal\.apps\master_ryadom\backend/src/leadvirt` so public website orders can mirror into LeadVirt Webhook/API intake.
- [x] Verified Master Budet bridge with backend typecheck and focused Jest coverage.
- [x] Documented the Master Budet connector in the Master project module docs/ADR/env examples and this LeadVirt pilot runbook.
- [x] Ran both products side by side locally; current convention is LeadVirt web/API on `localhost:3001`/`localhost:4001` and Master Budet on non-conflicting alternate ports such as `localhost:3002`/`localhost:4002`.
- [x] Applied Master Budet dev database migrations/seed so public order creation matches the current backend schema.
- [x] Verified live Master Budet order-to-LeadVirt webhook smoke: order `MR-20260623-B70628` mirrored to LeadVirt conversation `cmqr74dbf01oavwtwy7zwih7o`.
- [x] Verified Master Budet public order page renders against the local Master API; current side-by-side runs should use alternate Master ports such as `http://localhost:3002` with API `localhost:4002`.
- [x] Added `User.passwordHash` and `AuthSession` persistence for local credential auth.
- [x] Extended `db:migrate` to apply the additive auth session migration after the core schema exists.
- [x] Seeded the demo owner `admin@leadvirt.ai` with the local password `demo-demo`.
- [x] Added API credential `POST /auth/login`, `POST /auth/signup`, and `POST /auth/logout` endpoints with HTTP-only session cookies.
- [x] Updated guarded API context resolution to prefer credential sessions and keep demo tenant fallback when no session cookie is present.
- [x] Reconnected `/login` and `/signup` to real credential endpoints instead of `/auth/me` demo verification.
- [x] Updated the auth Playwright smoke to verify credential login/signup session creation.
- [x] Applied the auth session migration to the local LeadVirt database.
- [x] Verified credential auth with DB validate/generate, DB/API/Web/type package typechecks, API/Web lint, API/Web production builds, focused auth Playwright smoke, and a live API signup/auth-me/logout smoke on a temporary workspace.
- [x] Added auth session metadata fields for IP/user-agent and applied the additive local migration.
- [x] Added Settings Security APIs for password change, listing active sessions, revoking one session, and revoking other sessions.
- [x] Reconnected the copied Settings Security tab to real password/session APIs and removed fake static session rows.
- [x] Changed copied 2FA UI from a fake active toggle to an honest planned hardening state. Superseded by the implemented TOTP 2FA flow on 2026-07-02.
- [x] Extended Settings Playwright smoke to verify credential security mode, session rendering, password change payload, and session revoke action.
- [x] Verified Settings Security work with DB validate/generate, DB/API/Web typechecks, API/Web lint, API/Web production builds, local migration, and focused Settings Playwright smoke.
- [x] Added manual billing plan changes through `PATCH /billing/current-subscription` with tenant audit logging.
- [x] Reconnected the copied Billing plan selector to the subscription-change API, including loading/disabled/current-plan states.
- [x] Extended Billing Playwright smoke to verify the selected plan payload and updated current-plan UI.
- [x] Verified Billing plan changes with API/Web/shared-types typechecks, API/Web lint, focused Billing Playwright smoke on `localhost:3001`, and API/Web production builds.
- [x] Added manual billing subscription cancellation through `POST /billing/current-subscription/cancel` with tenant audit logging.
- [x] Reconnected the copied Billing cancel action to a confirmation dialog and API-backed canceled-subscription state.
- [x] Extended Billing Playwright smoke to verify cancel confirmation, cancel API call, and canceled-subscription UI.
- [x] Verified Billing cancellation with API/Web/shared-types typechecks, API/Web lint, focused Billing Playwright smoke on `localhost:3001`, and API/Web production builds.
- [x] Added API-backed manual billing payment method and payment-method change request audit flow.
- [x] Added API-backed billing invoice list derived from manual subscriptions.
- [x] Replaced the copied fake Visa payment card with honest manual invoice payment status and a real change-request action.
- [x] Replaced copied invoice download icon placeholders with real `.txt` invoice downloads generated from API invoice data.
- [x] Extended Billing Playwright smoke to verify payment-method request, invoice download filename, and invoice file contents.
- [x] Verified Billing payment/invoice work with API/Web/shared-types typechecks, API/Web lint, focused Billing Playwright smoke on `localhost:3001`, and API/Web production builds.
- [x] Fixed Landing CTA button styling so primary buttons use the emerald brand color and hero CTA buttons share the same compact standard height.
- [x] Verified Landing CTA compact-height fix with `@leadvirt/web` typecheck, lint, and a Playwright screenshot on `localhost:3001`.
- [x] Replaced the copied Integrations API/Webhook fake key and fake external URL with API-backed Webhook/API endpoint metadata.
- [x] Added direct `/app/settings?tab=api` routing so Integrations can open the API keys settings tab.
- [x] Extended Integrations Playwright smoke to verify Webhook/API endpoint metadata and the API keys settings link.
- [x] Verified Integrations API/Webhook cleanup with `@leadvirt/web` typecheck, lint, production build, focused Integrations Playwright smoke on `localhost:3001`, and a `/app/settings?tab=api` Playwright screenshot.
- [x] Added API-backed Settings Team password reset with generated temporary passwords, session revocation, and audit logging.
- [x] Reconnected the copied Team `Сбросить пароль` action to confirmation and one-time temporary password display in the UI.
- [x] Extended Settings Playwright smoke to verify Team password reset and capture `artifacts/playwright/settings-team-password-reset.png`.
- [x] Verified Team password reset with API/Web typecheck, API/Web lint, focused Settings Playwright smoke on `localhost:3001`, API/Web production builds, and a restarted Next dev server.
- [x] Added `User.passwordChangeRequired` with an additive local migration for temporary-password enforcement.
- [x] Marked team password resets as requiring a password change and cleared the flag after successful Settings Security password update.
- [x] Added product-shell routing to send temporary-password users to `/app/settings?tab=security` and highlighted the required password change in the Security tab.
- [x] Extended Settings Playwright smoke to verify forced temporary-password change behavior and capture `artifacts/playwright/settings-password-change-required.png`.
- [x] Verified forced password change with DB validate/generate/migrate, DB/types/API/Web typechecks, API/Web lint, focused Settings Playwright smoke on `localhost:3001`, API/Web production builds, and a restarted Next dev server.
- [x] Added server-side API guard enforcement so temporary-password credential sessions can only access auth/me, logout, current tenant, and Security password-change endpoints until the password is changed.
- [x] Added `qa:auth:guard` real local API smoke to verify temporary-password sessions are blocked from workspace APIs and unblocked after password change.
- [x] Verified API guard enforcement with `@leadvirt/api` typecheck, lint, build, and `qa:auth:guard` against the local API/DB.
- [x] Reconnected the product-shell account menu logout to the real `/auth/logout` API and cleared local auth/demo session hints before redirecting to `/login`.
- [x] Extended the product-layout Playwright smoke to verify API-backed tenant/user identity, logout API call, local session cleanup, and login redirect.
- [x] Verified product-shell logout with `@leadvirt/web` typecheck, lint, production build, restarted Next dev server on `localhost:3001`, and the focused product-layout Playwright smoke.
- [x] Fixed Settings API keys so an API-backed empty key list shows a real empty state instead of falling back to copied fake demo keys.
- [x] Extended the Settings Playwright smoke to verify the API keys empty state and increased the spec timeout for the long cold-dev settings flow.
- [x] Verified the API keys empty-state fix with `@leadvirt/web` typecheck, lint, production build, restarted Next dev server on `localhost:3001`, and the focused Settings Playwright smoke.
- [x] Connected the product-shell global search field to `/app/inbox?q=...` with a native form fallback and an Inbox initial search state.
- [x] Extended the product-layout Playwright smoke to verify global search navigation, query prefill, and Inbox filtering.
- [x] Verified global search with `@leadvirt/web` typecheck, lint, production build, restarted Next dev server on `localhost:3001`, and the focused product-layout Playwright smoke.
- [x] Reconnected the product-shell notifications dropdown to API-backed dashboard recent activity while preserving copied demo fallback only for API-offline visual mode.
- [x] Added an honest empty notification state for tenants with no recent activity.
- [x] Extended the product-layout Playwright smoke to verify dashboard activity appears in the notifications menu.
- [x] Verified notifications with `@leadvirt/web` typecheck, lint, production build, restarted Next dev server on `localhost:3001`, and the focused product-layout Playwright smoke.
- [x] Standardized LeadVirt local dev ports on `localhost:3001` for web and `localhost:4001` for API across agent rules, local defaults, `.env.example`, and README.
- [x] Relaunched Docker-backed LeadVirt web/API on `localhost:3001`/`localhost:4001` and verified web `200`, API health `200`, and API ready status.
- [x] Updated Playwright defaults, pilot scripts, active pilot runbook, generated pilot packet, and readiness report to use LeadVirt `localhost:3001`/`localhost:4001`.
- [x] Cleaned up port documentation so LeadVirt remains on `localhost:3001`/`localhost:4001` and Master Budet uses alternate side-by-side ports.
- [x] Increased `pilot:doctor` web-route timeout for cold Next dev route compilation.
- [x] Verified port migration cleanup with script syntax checks, `@leadvirt/web` typecheck, `pilot:ready` dry path, and focused Integrations Playwright smoke on `localhost:3001`.
- [x] Verified the full API-backed Playwright smoke suite after the port migration: `qa:api` passed 34/34 on `localhost:3001`.
- [x] Verified `qa:auth:guard` against the local API on `localhost:4001`.
- [x] Verified post-port-migration release checks with `@leadvirt/web` lint/build and `@leadvirt/api` lint/build, then restarted Next dev on `localhost:3001`.
- [x] Verified full local `pilot:ready` on `localhost:3001`/`localhost:4001`, including real seeded public intake smoke.
- [x] Removed disposable pilot records with `db:cleanup:pilot -- --confirm`; follow-up dry-run reports 0 leads, 0 conversations, 0 workflows, 0 workflow runs, and 0 webhook events.
- [x] Regenerated `docs/PILOT_PACKET.md` and `docs/PILOT_READY_REPORT.md` after cleanup with `LEADVIRT_READY_SKIP_LOCAL_INTAKE=1`; local doctor passed and cleanup counts remain zero.

## Active / Next

- [x] Push/deploy the current AI runtime branch, confirm GitHub Actions `qa:ai:acceptance` passes, then run `qa:ai:acceptance` once inside staging with the real Telegram login token and intended AI provider settings before inviting external testers.
- [x] Resolved OpenAI access from staging via the FR AI gateway; direct staging host egress was blocked by `403 unsupported_country_region_territory`, but gateway egress returns valid OpenAI responses.
- [x] Verified real OpenAI provider smoke with `AI_PROVIDER=openai`, `AI_ENABLE_REAL_PROVIDER=true`, `AI_DEFAULT_MODEL=gpt-5.5`, `AI_REASONING_EFFORT=low`, and `AI_VERBOSITY=low`; `qa:ai:provider` passed all reply, extraction, recommendation, summary, and intent contract checks.
- [x] Enable 2FA for `staging-admin@leadvirt.ai` before broad external access, or confirm it is not applicable while `leadvirt.ru` remains Telegram-only with password login disabled.
- [x] Decide whether `release:public-ready` should install/use Playwright browsers in the deployment image or keep public URL preflight as an operator-local QA step.
- [x] Defer `leadvirt.ai` routing/localization until the English/global release track starts.
- [x] Restart/redeploy the Master Budet backend with the updated LeadVirt bridge env before inviting external testers.
- [x] Provision a real staging Webhook/API channel, copy its generated public key/secret into the Master Budet bridge env, and avoid `demo-generic-webhook` for external traffic.
- [x] Run `qa:pilot:public` against the first actual tunnel/staging URL before inviting external testers.
- [x] Regenerate `docs/PILOT_PACKET.md` after the first public tunnel/staging URL is configured, without committing live webhook secrets.
- [ ] Add focused tests for functional behavior once API-backed features return.

## Current Verification Commands

```bash
corepack pnpm --filter @leadvirt/web typecheck
corepack pnpm --filter @leadvirt/web lint
corepack pnpm --filter @leadvirt/web build
corepack pnpm --filter @leadvirt/types typecheck
corepack pnpm --filter @leadvirt/api typecheck
corepack pnpm --filter @leadvirt/api lint
corepack pnpm --filter @leadvirt/api build
corepack pnpm --filter @leadvirt/worker typecheck
corepack pnpm --filter @leadvirt/worker lint
corepack pnpm --filter @leadvirt/worker build
corepack pnpm --filter @leadvirt/db db:validate
corepack pnpm --filter @leadvirt/db db:generate
corepack pnpm --filter @leadvirt/db db:migrate
corepack pnpm --filter @leadvirt/db typecheck
corepack pnpm run pilot:ready
corepack pnpm run pilot:doctor
corepack pnpm run qa:api
corepack pnpm run qa:pilot:intake
corepack pnpm run qa:pilot:public
corepack pnpm run qa:channels:provisioning
corepack pnpm run provision:webhook-channel
corepack pnpm run qa:auth:guard
corepack pnpm run qa:auth:rate-limit
corepack pnpm run qa:auth:identifier-policy
corepack pnpm run qa:auth:telegram
corepack pnpm run qa:auth:staging-ready
corepack pnpm run qa:ai:provider
corepack pnpm run qa:ai:graph
corepack pnpm run qa:ai:queue-routing
corepack pnpm run qa:ai:public-loop
corepack pnpm run qa:ai:acceptance
corepack pnpm run qa:ai:quality
corepack pnpm run qa:ai:budget
corepack pnpm run qa:ai:isolation
corepack pnpm run qa:ai:qdrant-isolation
corepack pnpm run qa:ai:real-eval
corepack pnpm run qa:pii:redaction
corepack pnpm run qa:ai:eval-redaction
corepack pnpm run qa:rbac:knowledge
corepack pnpm run qa:rbac:channels
corepack pnpm run qa:rbac:product-matrix
corepack pnpm run qa:ai:tool-abac
corepack pnpm run qa:ai:audit
corepack pnpm run qa:ai:audit-ui
corepack pnpm run qa:channels:delivery
corepack pnpm run qa:worker:dlq
corepack pnpm run worker:dlq:inspect
corepack pnpm run release:public-ready
corepack pnpm run qa:release-readiness
corepack pnpm run db:cleanup:pilot
corepack pnpm run qa:visual
corepack pnpm dlx @playwright/test test artifacts/playwright/landing-performance.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/landing-scroll.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/visual-check.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/dashboard-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/dashboard-clean-user.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/auth-flow.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/onboarding-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/onboarding-knowledge-sources.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/onboarding-knowledge-ui.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/analytics-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/integrations-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/automation-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/settings-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/channels-widget-settings.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/billing-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/widget-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/inbox-empty-state.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/inbox-actions.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/social-intake-visibility.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/webhook-widget-intake-visibility.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/pilot-real-intake-api.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/pilot-public-url-preflight.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/conversation-send.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/conversation-actions.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/conversation-status-actions.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/conversation-ai-draft.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/conversation-events-timeline.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/conversation-export.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/pipeline-actions.spec.ts --reporter=line
corepack pnpm dlx @playwright/test test artifacts/playwright/product-layout-identity.spec.ts --reporter=line
```

## Notes

- Current priority is visual fidelity and route correctness.
- The copied UI is intentionally static/demo-first until functionality is layered back in.
- `localhost:3001` should be restarted after `next build` before visual QA, because a running dev server can serve stale chunk references after `.next` changes.
- If Next dev reports missing vendor chunks after a production build, stop the dev server, delete `apps/web/.next`, and restart `next dev`; this is a build-cache reset, not a source change.
- `qa:visual` compares the copied Next UI with `LeadVirt-React-design-only` on `localhost:5173`; start the reference Vite server when running the full visual sweep.
- `qa:visual` can take around 3-6 minutes on a cold Next dev server because each route compiles before screenshots are captured.
- Stop `next dev` before `next build` if Next reports missing page modules during page-data collection; this can happen when dev and build write `.next` at the same time.
- Prisma CLI validation requires `DATABASE_URL` in the shell environment; the API runtime still has its local default through `AppConfigService`.
- API, worker, `qa:ai:provider`, and `release:public-ready` load the nearest root `.env` locally before reading AI/provider settings; deployment-provided environment variables still take precedence. `AI_PROVIDER=openai` uses mock AI until `AI_ENABLE_REAL_PROVIDER=true`.
- `qa:ai:real-eval` is budget-gated: it exits as skipped unless `AI_EVAL_ENABLE_REAL_PROVIDER=true`, `AI_PROVIDER=openai`, `AI_ENABLE_REAL_PROVIDER=true`, and `AI_API_KEY` are present. Use `AI_EVAL_CASE_IDS` and `AI_EVAL_MAX_CASES` to control cost.
- AI eval reports are generated under `artifacts/reports/` and ignored by git; the LeadVirt.ru verify workflow uploads them as `ai-eval-report`.
- Settings Security is API-backed for password changes, session revocation, and TOTP 2FA setup/disable/recovery-code flows.
- Billing plan selection, cancellation, manual payment-method change requests, and invoice downloads are API-backed for manual MVP subscriptions; hosted checkout/payment-provider enforcement remains follow-up billing work.
- `qa:auth:guard` is a real local API/DB smoke; run it with LeadVirt API available on `localhost:4001` or set `LEADVIRT_API_BASE`.
- Shared API-to-design mapping for product CRM surfaces belongs in `apps/web/src/design/product/apiAdapters.ts`.
- 2026-07-07: Channel delivery worker now preserves top-level `deliveryJobId` in message metadata for queued AI replies; verified with `qa:ai:acceptance`.
