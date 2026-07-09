# Decision Log

## 2026-07-09: Store Pilot Conversation Attachments In Message Records

Decision: Pilot conversation attachments support one compact PNG/JPG/PDF/TXT file per outbound message. The file is stored as a data URL in `MessageAttachment.url`.

Context: Users need the visible attachment button to work during the pilot, but general object storage and external-channel file delivery are still larger product work.

Consequences:

- File-only messages and text+file messages are visible in the transcript and survive API reloads.
- The pilot limit is 60 KB per file to stay within normal JSON request limits.
- External channel delivery remains text-first; broader attachment delivery/storage can be revisited after pilot feedback.

## 2026-07-09: Store Pilot Company Logos In Tenant Settings

Decision: Settings > Profile company logos are stored as compact PNG/JPG data URLs under tenant profile settings during the pilot.

Context: Pilot users need a working logo upload without introducing general file storage before launch.

Consequences:

- Logo upload/removal works immediately and survives reloads.
- The pilot logo limit is 60 KB to stay within normal JSON request limits.
- General conversation/file attachment storage remains separate backlog work.

## 2026-07-09: Prefer First-Touch Safe Navigation Controls

Decision: Pilot-critical navigation controls should use real links or native browser controls when possible. Dashboard quick actions, recent-lead rows, product shell primary navigation CTAs, notification rows, and conversation back controls are Next links; the Landing mobile menu uses native disclosure behavior.

Context: Pilot users may click before React hydration finishes or while a page is compiling locally. Visible controls should not depend on delayed client handlers for basic navigation.

Consequences:

- Public entry points, product shell CTAs, notifications, back navigation, and core product quick actions work more reliably on first click.
- New control smoke coverage lives in `pilot-core-controls.spec.ts` and `public-entry-controls.spec.ts`.

## 2026-07-09: Enforce Pilot Self-Service Integration Boundary

Decision: Request-only or soon integrations cannot be connected through the API during the pilot. `POST /integrations/:provider/connect` now rejects Instagram, WhatsApp Business, VK, Shopify, Shop-Script, and Other. Existing staging rows for those providers should stay disconnected.

Context: The pilot must not imply real one-click social or commerce setup when the channel still needs legal, platform, provider, or implementation work.

Consequences:

- The UI labels and backend state now agree: request-only cards cannot become connected through stale data or direct API calls.
- Missing catalog row creation remains available for self-serve integrations such as CRM/calendar/Webhook/API.
- Future native social work needs a separate implementation and verification path before it becomes self-serve.

## 2026-07-09: Show Feedback For Deferred Pilot Controls

Decision: Deferred controls that remain visible in the pilot must respond with explicit user feedback, not silently no-op. Conversation attachment and company logo upload now show "available after pilot" toasts and are tracked in the checklist backlog.

Context: Pilot users should never click a visible control and see nothing happen.

Consequences:

- The product can keep familiar controls visible without pretending the deferred feature is implemented.
- Deferred controls need checklist items until real upload behavior exists.

## 2026-07-09: Keep Widget Demo API-Backed

Decision: `/widget/demo` is a real public widget smoke surface and uses the API-backed widget endpoints. The local-only demo boundary applies to `/demo` and `/demo/**`, not `/widget/demo`.

Context: Public pilot preflight needs to validate widget config and message intake through the deployed API. Treating `/widget/demo` as local-only hid broken widget public-key setup.

Consequences:

- `qa:api` verifies `/widget/demo` against public widget config/message APIs.
- Demo routes still cannot create tenant API traffic.
- Public widget staging data must include an explicit widget channel key.

## 2026-07-08: Limit Pilot Self-Serve Integrations To Low-Friction Channels

Decision: Instagram and WhatsApp Business are not part of the pilot self-serve integration set. In the Integrations UI they are labeled `Подключение по запросу`; VK and Shopify are labeled `Скоро будет`.

Context: Pilot onboarding should avoid legal and platform-review complexity such as Meta Business Verification or App Review. Social channels that require third-party/provider setup must not look like one-click self-serve connections.

Consequences:

- Pilot readiness focuses on low-friction channels such as Telegram, Website Widget, and Webhook/API.
- Future native Meta integrations should become self-serve only after the required verification/review path is complete.

## 2026-07-08: Remove Retired Instagram Bridge From Pilot

Decision: The previously tested third-party Instagram bridge is removed from runtime code, Integrations UI, QA scripts, and operator docs. Webhook/API returns to generic inbound-only behavior.

Context: The pilot should avoid extra provider registration, hidden token storage, and any onboarding path that suggests Instagram can be connected without the required platform review or business setup.

Consequences:

- Integrations keeps Instagram and WhatsApp Business as request-only channels.
- Webhook/API remains useful for direct forms, partner backends, and manual smoke leads.
- Native social channel work must be implemented as a separate reviewed integration path later.

## 2026-07-08: Create Missing Integration Accounts On Connect

Decision: `POST /integrations/:provider/connect` creates a catalog-backed integration account when the tenant does not already have one, then marks it connected.

Context: Production HAR showed `POST /integrations/INSTAGRAM/connect` returning `404 Integration was not found` for a workspace where Instagram existed in the UI catalog but not in `integrationAccount`.

Consequences:

- Catalog integrations like Instagram can be connected from the UI without pre-seeded DB rows.
- Settings, disconnect, test, and sample endpoints still require an existing integration account.
- `qa:integrations:connect-missing` covers the missing-row connect path.

## 2026-07-08: Drop Telegram Account Switching From Public Login

Decision: `/login` and `/signup` keep a single ordinary Telegram Login Widget flow. LeadVirt renders a branded visual button above the official Telegram iframe, but no longer exposes `Другой Telegram аккаунт`, no longer opens `Telegram.Login.auth` for switching, and no longer tries to clear or reject Telegram-domain sessions.

Context: Telegram's website login keeps using the last account stored in Telegram cookies, and there is no reliable public widget parameter to force account selection. Real account switching will require a bot-based flow or another auth method later.

Consequences:

- The current public auth surface is simpler and matches what Telegram supports today.
- Users who need another Telegram account must switch it on Telegram's side first.
- Future login options should be added as separate auth methods rather than more widget workarounds.

## 2026-07-08: Open Telegram Account Switch With Official Popup API

Decision: The `/login` `Другой Telegram аккаунт` action now calls Telegram's official `Telegram.Login.auth` API when the numeric `botId` is available. It still clears LeadVirt local/session state and remounts the widget, but the same user click also opens Telegram's own popup. If Telegram immediately returns the same Telegram ID that was cached in the current LeadVirt session, LeadVirt rejects that callback instead of logging the user back into the previous account.

Context: Live diagnostics on `https://leadvirt.ru/login` showed the widget iframe loaded correctly and opened Telegram when clicked directly, while the LeadVirt switch button only remounted the iframe and showed a toast. LeadVirt cannot programmatically click a cross-origin Telegram iframe, so the supported path is Telegram's public widget API.

Consequences:

- The switch action can open the Telegram popup directly instead of requiring a second click on the iframe.
- Telegram's auto-return of the previous account no longer causes an accidental re-login.
- If the Telegram SDK is not ready, the fallback remains the official iframe button.
- Telegram still controls account selection and Telegram-domain cookies.

## 2026-07-08: Make Telegram Account Switching Best-Effort

Decision: `/login` now shows a `Другой Telegram аккаунт` action under the official Telegram widget. It clears only the LeadVirt session/local storage, calls `/auth/logout`, and remounts the official widget with a cache-busted script URL.

Context: Telegram does not expose an official website API to clear Telegram cookies or force account selection. The best we can do safely is reset LeadVirt state and let Telegram's own widget/popup handle whichever account is active on Telegram's domain.

Consequences:

- LeadVirt can reliably forget the current local app session before the next Telegram login attempt.
- Telegram account choice remains controlled by Telegram's browser session.
- The UI must not imply that LeadVirt can log the user out of Telegram itself.

## 2026-07-08: Return Public Auth To Telegram Login Widget

Decision: `/login` and `/signup` now render the official legacy Telegram Login Widget through `telegram-widget.js` with `data-telegram-login`, `data-onauth`, and `data-request-access=write`. The frontend no longer renders a custom visual button, no longer overlays a LeadVirt button on top of Telegram, and no longer opens a custom OIDC popup for public auth.

Context: The OIDC popup variants kept failing on staging before a stable backend login result. The legacy widget is Telegram's documented iframe widget path for returning signed `id`, `auth_date`, and `hash` payloads, and LeadVirt already has server-side HMAC verification for that payload.

Consequences:

- Public login uses `POST /auth/telegram` again and keeps the bot token server-side.
- `/auth/telegram/config` exposes the bot username from `TELEGRAM_LOGIN_BOT_USERNAME` or `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT` so the widget can render.
- `/auth/telegram/oidc` remains available for compatibility but is not used by `/login` or `/signup`.
- Account selection is delegated to Telegram's own widget UI; LeadVirt does not attempt to clear Telegram's browser session.

## 2026-07-07: Remove Archived UI References And Slim Deploy

Decision: LeadVirt no longer keeps the design-only React export, copied Figma reference tree, legacy functional UI, old prompt/docs bundle, or full design-only visual comparison in the active repo. `qa:ui:smoke` replaces the old design-reference `qa:visual` workflow.

Context: The active Next app now owns the production UI, and the archived/reference trees increased checkout size, TypeScript surface, dependency pressure, and deployment context without serving runtime traffic.

Consequences:

- Runtime API, database schema, and public env contracts stay unchanged.
- Docker builds install from manifest layers, copy only runtime source plus needed QA scripts/evals, and build only api/worker/web dependency trees.
- GitHub Actions uses pnpm cache through `actions/setup-node`; the VPS still builds locally from the release package.

## 2026-07-07: Use Explicit Telegram OAuth Origin

Decision: `/login` and `/signup` open a first-party `oauth.telegram.org/auth` popup URL instead of `Telegram.Login.auth`. The URL includes `origin`, `response_type=post_message`, the numeric Telegram client id, `/login` as `redirect_uri`, `openid profile telegram:bot_access` scope, and a nonce; the account-switch action also sends `prompt=login select_account`.

Context: Staging showed Telegram's `origin required` error before the API received any `/auth/telegram/oidc` request. Telegram's current `telegram-login.js` popup path does not include `origin`, while direct OAuth checks and community fixes confirm that `oauth.telegram.org/auth` now requires it.

Consequences:

- The API OIDC verification and session issuance stay unchanged.
- The page no longer depends on `telegram-login.js` loading or its popup URL builder.
- Account switching clears the LeadVirt session before submitting the new Telegram OIDC token, but Telegram account selection remains best-effort because Telegram owns its OAuth browser session.
- BotFather Web Login allowed URLs must include the site origin, e.g. `https://leadvirt.ru`.

## 2026-07-07: Let Users Switch Telegram Login Accounts

Decision: Telegram login now exposes the public numeric bot id through `/auth/telegram/config`. The `/login` and `/signup` pages use Telegram's official `telegram-login.js` SDK for primary login and the "different account" action, then send the returned OIDC `id_token` to `/auth/telegram/oidc`. The API verifies the token against Telegram JWKS and maps it to the same `telegram:<id>` user identity.

Context: The legacy Telegram Login Widget iframe and the hand-built OAuth popup path were brittle for account switching. Telegram's current browser integration exposes `Telegram.Login.auth(...)`, which opens the Telegram OIDC popup and returns an `id_token` callback suitable for a Next.js client component.

Consequences:

- The bot token remains server-only; only the public bot id is exposed.
- Regular production login uses the same OIDC server verification path as account switching.
- The old signed payload endpoint remains available for local/test fallback and backward compatibility.
- `/login` clears the LeadVirt session before opening the account-switch flow without relying on cross-domain cookie deletion.
- Hand-built `oauth.telegram.org/auth` URL construction and hidden iframe logout are avoided.

## 2026-07-06: Gate Native Instagram Work With Meta Preflight

Decision: Use `qa:meta:instagram` as the external Meta readiness gate before implementing a native Instagram DM channel in LeadVirt.

Context: The current product supports Instagram as a UI/channel type, but real inbound/outbound runtime delivery is implemented for Telegram and Webhook/API. Meta setup now has a visible Page, connected Instagram Professional account, granted messaging permissions, and a passing conversations query.

Consequences:

- Meta token checks can be repeated without logging user or page access tokens.
- A native LeadVirt Instagram adapter still needs separate implementation for webhook verification, inbound normalization, outbound send, channel provisioning, and app-review production behavior.
- First release can continue to rely on Telegram and Webhook/API until that adapter is built.

## 2026-07-06: Keep Demo Conversation Replay Client-Only

Decision: The demo inbox conversation uses a client-only replay layer with timed messages and typing indicators. It overlays local demo conversation data and stops or reveals the script when the user interacts.

Context: Sales demos need the first opened conversation to show the product's AI moment without creating fake records, background jobs, or API traffic.

Consequences:

- Replay is limited to `/demo/inbox/:conversationId` and does not affect `/app` conversations.
- Demo users can skip or repeat the scenario, and manual actions stay usable.
- The no-API demo boundary remains covered by `demo-data-boundary.spec.ts`.

## 2026-07-06: Run Demo As Local Browser Runtime

Decision: `/demo` uses the real product UI routes with a client-side local API runtime instead of a DB-backed demo user. Demo clicks can mutate in-memory browser state, but no demo route sends API requests or writes to the database; page reload restores the seeded sales scenario.

Context: Sales demos need the whole product to feel clickable across tabs, while production tenant data must stay isolated and demo exploration must not create cleanup work or pollute analytics.

Consequences:

- Demo routing mirrors product navigation under `/demo/**`, including inbox, leads, automations, analytics, audit, integrations, settings/billing, onboarding, and widget.
- Demo behavior must stay close to the real API contracts so copied UI remains realistic without network traffic.
- Any new product tab should add a demo route/local handler or intentionally route to signup.
- `qa:demo-boundary` plus the focused Playwright demo smoke guard against accidental API calls from demo routes.

## 2026-07-06: Keep GitHub Actions On Current Runtime Majors

Decision: The LeadVirt.ru deploy workflow uses current major versions for official GitHub Actions, including `actions/upload-artifact@v7`.

Context: CI passed, but GitHub warned that `actions/upload-artifact@v4` targets the deprecated Node 20 runtime and is being forced onto Node 24.

Consequences:

- The verify job still uploads AI eval reports with the same artifact name and retention.
- The workflow should no longer emit the Node 20 runtime warning for artifact upload.
- Future workflow maintenance should prefer current official action majors after confirming the tag exists.

## 2026-07-06: Treat 2FA As Credential-Auth Gate Only

Decision: `leadvirt.ru` stays Telegram-only for public auth with `AUTH_CREDENTIALS_ENABLED=false`. The staging credential operator's TOTP setup is not required for broad RU external access while password login is disabled.

Context: LeadVirt 2FA protects credential sessions. The current RU release path uses Telegram Login, and enabling credential auth only for maintenance would temporarily widen the public auth surface.

Consequences:

- Do not re-enable password login just to enable 2FA for the inactive `staging-admin@leadvirt.ai` credential path.
- If staff/credential login is re-enabled later, 2FA for privileged operator accounts becomes a required release gate.
- Telegram-only operator access remains the active auth model for `leadvirt.ru`.

## 2026-07-06: Keep Public URL Preflight Operator-Local

Decision: Deployment/runtime images will not install Playwright browsers. `release:public-ready` remains the full operator-local release gate by default, and server/container non-browser runs may set `LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT=1`.

Context: The production API/web/worker images should stay small and focused on runtime. Public URL preflight is a browser smoke that validates the tester-facing route through Playwright, so it belongs on an operator machine or dedicated QA runner with browser dependencies installed.

Consequences:

- `release:public-ready` still runs `qa:pilot:public` by default.
- When `LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT=1` is set, the report status becomes `passed-with-skipped-public-preflight`.
- A skipped public preflight is not enough before inviting testers; run `corepack pnpm run qa:pilot:public` separately from an operator machine.
- Docker deploy images do not need Chromium/Playwright browser installation.

## 2026-07-06: Staging AI Acceptance Uses Queue Mode

Decision: Post-deploy staging AI acceptance must run against the queued runtime path with `AI_REPLY_MODE=queue`.

Context: The main release scenario depends on public intake creating an `ai.reply` job, the worker running LangGraph, and `channels.sendMessage` delivering the AI response. A sync staging mode can make the acceptance smoke fail for the wrong reason or skip the worker path that production needs.

Consequences:

- `deploy/env.staging.example` now defaults `AI_REPLY_MODE` to `queue`.
- `deploy/run-ai-acceptance.sh` fails fast if the running API service is not in queue mode.
- The script runs `qa:ai:acceptance` inside the worker container with Docker-network API and local worker metrics URLs.

## 2026-07-06: Add Clean Telegram AI Acceptance Smoke

Decision: LeadVirt now has `qa:ai:acceptance` for the first full local AI runtime acceptance path. The smoke creates a clean Telegram-auth workspace, syncs onboarding knowledge, creates a tenant Webhook/API channel, sends public intake, waits for queued LangGraph and channel delivery, and verifies grounded price/slot output, RAG evidence, tool calls, usage/cost, AI audit, worker metrics, dashboard, inbox, lead detail, and activity timeline.

Context: The release gate needs one high-signal scenario that proves real workspace data flows from onboarding to RAG, AI actions, product APIs, and observability without demo fallback.

Consequences:

- Local acceptance can run deterministically with `AI_PROVIDER=mock`, `AI_REPLY_MODE=queue`, and DB fallback RAG.
- The LeadVirt.ru GitHub Actions verify job now starts Redis plus local API/worker processes and runs `qa:ai:acceptance` before deploy.
- The same smoke should be rerun against staging/production-like env with the intended Telegram token and AI provider before external testers.
- The smoke caught and fixed a runtime `RolesGuard` injection issue that made RBAC-protected endpoints return 500.

## 2026-07-06: Tag And Redact AI Eval Artifacts

Decision: LeadVirt now uses `redactAndTagSensitiveData` for AI prompt/eval-shaped artifacts. The deterministic quality gate report and real-provider eval report are sanitized before writing, and real-provider judge payloads are redacted before they are sent to the judge model. Reports include `piiTags` and `redactionApplied`.

Context: Phase 6 security hardening requires PII tagging before observability/eval handling and broader redaction for prompts and eval artifacts, not only runtime tool metadata.

Consequences:

- `qa:pii:redaction` verifies redaction plus tag detection for email, phone, token, and secret categories.
- `qa:ai:eval-redaction` verifies prompt/eval-shaped payload sanitization.
- `qa:ai:quality` continues to enforce golden-set gates while writing sanitized reports.

## 2026-07-06: Add Tenant-Scoped AI Audit Surface

Decision: LeadVirt now exposes `/api/ai-audit` for OWNER, ADMIN, and MANAGER roles and renders `/app/audit` as an API-backed product screen. The audit surface combines `AiUsageLog` rows with AI-related `AuditLog` rows and redacts sensitive metadata before returning it to the client.

Context: Operators need to inspect AI decisions, quality gates, tool calls, retrieved context references, delivery events, and DLQ failures without querying the database directly.

Consequences:

- `qa:ai:audit` verifies tenant isolation and redaction for audit data.
- `qa:ai:audit-ui` verifies the API-backed UI path, redacted payload display, and forbidden-role error state.
- The UI has empty/error states and never falls back to demo data.
- Follow-up work should add tighter PII tagging for prompts/eval artifacts.

## 2026-07-06: Extend Product RBAC Matrix

Decision: Billing mutations now require OWNER or ADMIN. Integration actions and workflow mutations/tests require OWNER, ADMIN, or MANAGER. Read endpoints remain available to authenticated workspace users unless a more sensitive policy is needed later.

Context: Phase 6 authorization should cover the main product mutation surfaces before the AI audit UI lands, while keeping existing read-heavy product screens usable for lower-privilege roles.

Consequences:

- `qa:rbac:product-matrix` verifies billing, integrations, and workflows role boundaries at controller metadata level.
- Billing plan/payment changes are more restrictive than operational workflow/integration actions.
- Remaining Phase 6 authorization work is mostly audit UI permissions and any later per-field ABAC rules.

## 2026-07-05: Extend RBAC And ABAC To Channels And AI Tools

Decision: Channel create/update endpoints now require OWNER, ADMIN, or MANAGER. AI tool execution now verifies the conversation belongs to the tenant, the tool lead matches the conversation lead when present, and task assignees belong to the same tenant.

Context: Knowledge RBAC protects the RAG base, but public channel configuration and AI tool mutations are also sensitive surfaces. The worker must not mutate tenant data using a foreign conversation id or assign tasks to users outside the tenant.

Consequences:

- `qa:rbac:channels` verifies VIEWER/AGENT cannot mutate channels.
- `qa:ai:tool-abac` verifies foreign conversation and foreign assignee cases are skipped before DB mutation.
- Remaining Phase 6 authorization work is a broader role matrix for billing, integrations, workflows, and audit UI operations.

## 2026-07-05: Enforce RBAC On Knowledge Source Mutations

Decision: LeadVirt now has reusable API `@Roles` metadata and a `RolesGuard`. Knowledge source create, update, archive, and reindex endpoints are restricted to OWNER, ADMIN, and MANAGER. VIEWER and AGENT retain read/search access but cannot mutate RAG knowledge.

Context: Tenant filtering prevents cross-customer leakage, but Phase 6 also needs role boundaries inside a tenant so low-privilege users cannot alter business knowledge used by AI replies.

Consequences:

- `qa:rbac:knowledge` verifies read access for VIEWER and write denial for VIEWER/AGENT.
- The guard is reusable for channel settings, tool/action APIs, and later AI audit UI operations.
- Follow-up work should decide exact role matrix for channels, integrations, billing, and AI tool execution.

## 2026-07-05: Redact PII And Secrets In Runtime Observability Payloads

Decision: LeadVirt has a shared redaction helper in `@leadvirt/observability` for emails, phone-like values, Telegram bot tokens, and secret-bearing object keys. HTTP logs use normalized routes instead of raw URLs, OpenTelemetry error messages/stacks are redacted, and AI graph tool-call inputs are redacted before they are stored in metadata, usage logs, lead events, or audit logs.

Context: AI runtime traces and audit payloads are necessary for debugging, but they must not casually expose customer emails, phones, bot tokens, webhook secrets, or provider tokens.

Consequences:

- `qa:pii:redaction` covers text and nested-object redaction.
- Business/user data can still live in first-class product records where needed; debug metadata gets the redacted version.
- Follow-up Phase 6 work should add explicit PII tagging/classification and ensure eval reports/prompts follow the same policy.

## 2026-07-05: Start Phase 6 With Tenant Isolation Smokes

Decision: LeadVirt now has tenant isolation smokes for DB fallback RAG and Qdrant RAG. `qa:ai:isolation` checks DB search filtering, and `qa:ai:qdrant-isolation` indexes two tenants into a temporary Qdrant collection and verifies tenant-filtered retrieval.

Context: Phase 6 security work should first guard against the most severe AI/RAG failure: one customer seeing another customer's business knowledge.

Consequences:

- The smoke forces `RAG_QDRANT_ENABLED=false` for deterministic local coverage.
- The test covers tenant filtering in `KnowledgeService.search` and cleanup through tenant cascade deletes.
- The Qdrant smoke uses a temporary collection and creates real users/memberships so reindex audit logging follows the production path.
- Remaining Phase 6 security work is PII redaction, RBAC/ABAC enforcement, and AI audit UI.

## 2026-07-05: Expose AI Quality And Budget Signals In Prometheus

Decision: LeadVirt exports AI quality-gate outcomes and tenant budget blocks as Prometheus metrics, and the `LeadVirt AI Runtime` Grafana dashboard includes panels for quality reasons, budget blocks, and blocked-token volume.

Context: Usage logs are useful for audit, but operators need live signals when answers are being blocked by quality gates or tenant token budgets.

Consequences:

- `leadvirt_ai_quality_gate_total` tracks passed/blocked quality outcomes by source and reason.
- `leadvirt_ai_budget_blocks_total` tracks calls blocked by daily/monthly token budgets.
- `leadvirt_ai_budget_blocked_tokens_total` tracks estimated token volume blocked by budget guard.
- `qa:ai:budget` now verifies both `BUDGET_BLOCKED` DB logging and Prometheus budget metrics.

## 2026-07-05: Make OpenTelemetry Tracing Opt-In Through OTLP

Decision: API and worker now start OpenTelemetry only when `OTEL_ENABLED=true`. Traces export through the OTLP HTTP endpoint in `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`. The optional observability profile includes Tempo and provisions it as a Grafana datasource.

Context: Manual spans are useful for diagnosing AI runtime latency and failure paths, but local development and normal deploys should not require a tracing backend.

Consequences:

- API request logs include trace/span ids when spans are created.
- Spans cover HTTP requests, queue publishing, worker jobs, LangGraph graph/nodes, provider stages, tool execution, persistence, and channel delivery.
- The first implementation exports traces only when explicitly enabled.
- Next observability work should add cost/quality panels and, later, trace-to-log/metric correlation.

## 2026-07-05: Keep Prometheus And Grafana Optional Behind A Compose Profile

Decision: Prometheus and Grafana are added through an `observability` Docker Compose profile. Normal local/staging app startup does not launch them. Local Prometheus scrapes `host.docker.internal:4001` and `host.docker.internal:4002`; staging scrapes the internal `api` and `worker` services.

Context: LeadVirt needs dashboard definitions for AI runtime health, but observability services should not consume ports/resources during ordinary development or deploys.

Consequences:

- Local Grafana uses `localhost:3003` to avoid the reserved LeadVirt web port `3001`.
- Staging Prometheus/Grafana bind to `127.0.0.1` and should be reached through SSH port forwarding.
- The first dashboard covers AI graph throughput/duration, worker jobs, channel delivery, API requests, DLQ, and handoff ratio.
- Future work should add cost panels from `AiUsageLog` and OpenTelemetry traces.

## 2026-07-05: Enforce Tenant AI Token Budgets Before Provider Calls

Decision: LeadVirt wraps the configured AI provider in `BudgetedAiProvider` for API and worker runtimes. `AI_TENANT_DAILY_TOKEN_BUDGET` and `AI_TENANT_MONTHLY_TOKEN_BUDGET` default to `0` (disabled); positive values block calls before the provider is invoked when tenant usage plus the estimated request would exceed the limit.

Context: Real-provider usage needs a fail-closed cost guard before broader external traffic. The existing `AiUsageLog` already tracks token estimates, so the first control can use those records without a new table.

Consequences:

- Budget-blocked calls write an `AiUsageLog` row with `status=BUDGET_BLOCKED`.
- The guard applies to sync API AI paths and queued worker LangGraph paths.
- `qa:ai:budget` verifies blocking and usage-log persistence.
- This is token-based MVP control; exact provider-reported token/cost accounting can be added when provider usage metadata is stored.

## 2026-07-05: Start Observability With Prometheus Metrics Before Full Tracing

Decision: Phase 5 observability starts with a small in-repo Prometheus text metrics layer instead of adding a new dependency first. The API exposes `/metrics`, and the worker exposes `/metrics` on `WORKER_METRICS_PORT` unless `WORKER_METRICS_ENABLED=false`.

Context: LeadVirt needs immediate runtime visibility for API latency, worker retries/DLQ, LangGraph runs, and channel delivery before the full OpenTelemetry and Grafana stack is wired.

Consequences:

- API metrics include request totals and request duration histograms by method, normalized route, and status.
- Worker metrics include job totals/duration, DLQ counters, AI graph totals/duration, handoff labels, and outbound channel delivery outcomes.
- No external observability package is required for this first layer.
- Remaining Phase 5 work is OpenTelemetry spans, Grafana dashboards, and per-tenant AI cost/budget enforcement.

## 2026-07-05: Add Deterministic Golden Set Gate Before LLM Judge Evals

Decision: Phase 4 starts with a deterministic `qa:ai:quality` gate over `artifacts/evals/ai-golden-set.json`. The gate uses the local mock provider and validates graph metadata, retrieved chunk content, tool calls, lead/conversation state, booking drafts, handoff tasks, usage logs, and quality-gate reasons.

Context: Before introducing RAGAS, LLM judges, and real-provider variance, LeadVirt needs a fast CI-safe regression that proves the core business workflow remains intact.

Consequences:

- The first golden cases cover grounded pricing, booking with an available slot, human escalation, and missing-grounding fallback.
- The script reports pass rate, average score, and retrieval hit rate.
- `qa:ai:quality` can become the required CI gate while larger real-provider evals stay optional or scheduled.
- Future work should expand the golden set per pilot niche and add judge/RAGAS metrics on top of this deterministic baseline.
- Pilot-niche coverage currently includes beauty, auto detailing, education/course booking, and clinic handoff behavior.

## 2026-07-05: Make AI Quality Gate Required In Deploy Verification

Decision: The LeadVirt.ru GitHub Actions verify job now starts Postgres, applies DB migrations, and runs `qa:ai:quality` before deployment can proceed.

Context: The AI golden set should block deploys when core pricing, booking, escalation, or missing-grounding behavior regresses.

Consequences:

- Deploy verification now requires a disposable CI database.
- `artifacts/evals` is included in release packages so quality scripts stay runnable from deployed source.
- Real-provider evals remain separate from the required deterministic gate.

## 2026-07-05: Keep Real-Provider Evals Explicit And Budget-Gated

Decision: Real-provider quality checks live in optional `qa:ai:real-eval`, which skips unless `AI_EVAL_ENABLE_REAL_PROVIDER=true` is set. The script runs selected golden cases through the real OpenAI provider and asks an LLM judge to score grounding, business correctness, action correctness, and safety.

Context: Real-provider evals are useful before releases and model changes, but they cost money and can vary. The deterministic mock-backed `qa:ai:quality` remains the required CI gate.

Consequences:

- Operators must explicitly opt in with `AI_EVAL_ENABLE_REAL_PROVIDER=true`, `AI_PROVIDER=openai`, `AI_ENABLE_REAL_PROVIDER=true`, and `AI_API_KEY`.
- `AI_EVAL_CASE_IDS` and `AI_EVAL_MAX_CASES` control spend.
- The script reports judge pass rate, average judge score, and deterministic contract score.
- Future work should add broader retrieval-quality suites and trend comparisons across model changes.

## 2026-07-05: Persist AI Eval Reports With Retrieval Metrics

Decision: AI eval scripts now write JSON reports under `artifacts/reports/`, including required-term recall and retrieved-chunk precision as lightweight RAGAS-style retrieval metrics. The LeadVirt.ru verify workflow uploads these reports as the `ai-eval-report` artifact.

Context: Console output is not enough for release diagnosis. We need a small, inspectable artifact that explains why an AI quality gate passed or failed without committing generated reports to source control.

Consequences:

- `artifacts/reports/` is ignored by git.
- `qa:ai:quality` writes `ai-quality-gate-report.json`.
- `qa:ai:real-eval` writes `ai-real-provider-eval-report.json`, including skip metadata when real-provider eval is not enabled.
- CI keeps AI eval reports for short-term inspection while deterministic quality remains the required gate.

## 2026-07-05: Verify The Main AI Loop Through Public Intake

Decision: The main AI runtime regression now has `qa:ai:public-loop`, which creates a clean tenant/user/session, syncs onboarding knowledge, reindexes/searches RAG, sends a public Webhook/API lead, waits for `ai.reply` and `channels.sendMessage`, then verifies booking draft, inbox, dashboard, and queue completion.

Context: Isolated graph, queue-routing, and delivery smokes prove individual pieces. Before moving to evals and observability, LeadVirt needs one compact test that exercises the user journey from business knowledge to public lead response.

Consequences:

- The smoke uses a DB-backed session instead of credential signup so it remains compatible with Telegram-only auth policy.
- It cleans created tenant/user/channel/webhook data after the run.
- It requires local API/worker on `localhost:4001` and Redis/Postgres/Qdrant from the standard LeadVirt dev stack.
- Phase 4 can now focus on golden sets and quality gates on top of a working public loop.

## 2026-07-05: Deliver Queued Public AI Messages Through A Separate Worker

Decision: Queued Telegram and Webhook/API AI messages are delivered by the `channels.sendMessage` worker after LangGraph writes the AI message. Delivery validates tenant ownership, conversation channel, channel type, active status, message status, and adapter support before sending.

Context: AI generation, RAG, quality gates, and tool calls belong to `ai.reply`, but external channel delivery has separate retries, provider ids, and failure modes. Keeping delivery as a separate queue makes status transitions and DLQ handling explicit.

Consequences:

- Public AI messages are created as `QUEUED`, then `channels.sendMessage` updates them to `SENT` or `FAILED`.
- Adapter status and provider external message ids are stored in message metadata under `delivery`.
- Delivery success writes `channel.message.sent` audit logs.
- `qa:channels:delivery` verifies delivery, metadata, audit logging, and duplicate idempotency.
- Future real Telegram/Webhook adapters can replace the current stub behavior without changing the AI graph contract.

## 2026-07-05: Queue Public AI Replies Before External Delivery

Decision: Public Widget, Webhook/API, and Telegram intake endpoints publish AI replies to the `ai.reply` queue when `AI_REPLY_MODE=queue`. Widget can read the queued answer later from conversation messages; Webhook/API and Telegram return `outboundStatus=queued` until a dedicated outbound delivery worker sends through channel adapters.

Context: The LangGraph worker now owns RAG, quality gates, tool calls, usage logs, and audit persistence. Keeping public intake synchronous would bypass that runtime and make behavior different from queued inbox replies. External delivery is a separate concern from AI generation and should not be faked as sent.

Consequences:

- Public endpoints no longer call the AI provider synchronously in queue mode.
- `AiReplySource` includes `telegram`, and route-level `qa:ai:queue-routing` verifies widget, webhook, and Telegram jobs reach `ai.reply`.
- Worker-created Telegram/Webhook AI messages are stored as `QUEUED` with `outboundStatus=queued`.
- Next Phase 3 work is a `channels.sendMessage` delivery worker for Telegram/Webhook status transitions and retry/DLQ behavior.

## 2026-07-05: Treat Final Worker Failures As Audited DLQ Events

Decision: Worker jobs run through a timeout wrapper and final-attempt failures are captured as DLQ events. The worker logs DLQ payloads and writes tenant-scoped audit records when the failed job contains `tenantId`.

Context: BullMQ already handles retries and failed sets, but LeadVirt needs an operator-visible trace for AI job failures before full Prometheus/Grafana work lands. A lightweight audit record gives immediate tenant-scoped diagnosis without adding new tables yet.

Consequences:

- `WORKER_JOB_TIMEOUT_MS` controls processor-level timeout; default is 30 seconds.
- `worker.job.dlq` audit records include queue name, job id, attempts, failure reason, and a redacted job data summary.
- `worker:dlq:inspect` lists failed jobs across configured queues from Redis.
- `qa:worker:dlq` verifies timeout behavior and DLQ audit capture.
- Future observability should convert these events into Prometheus counters and Grafana panels.

## 2026-07-05: Treat AI Tool Calls As Validated Draft Actions First

Decision: LangGraph worker tool calls are zod-validated, tenant-scoped database mutations that create internal draft actions first: lead field updates, lead notes, status changes, booking proposals, and handoff tasks. External irreversible side effects stay out of the first tool layer.

Context: LeadVirt needs tool-calling for real CRM workflow, but early production safety matters more than broad autonomy. A booking proposal can create a draft booking and manager-visible event, while real confirmations, refunds, discounts, and external CRM pushes need stronger policy gates and operator review.

Consequences:

- Tool payloads are parsed before execution and every tool checks the lead belongs to the current tenant.
- AI-created booking records are `DRAFT` and marked as requiring manager confirmation.
- Tool results are stored in AI message metadata, usage logs, lead events, and audit logs.
- `qa:ai:graph` covers tool execution, draft booking creation, lead note creation, status change, and duplicate idempotency.
- Later tool work can add stricter schemas for external CRM sync, calendar confirmation, and order creation.

## 2026-07-05: Start LangGraph Runtime At The Existing AI Reply Queue Boundary

Decision: The first production LangGraph.js runtime is attached to the existing BullMQ `ai.reply` worker queue. The API enqueue contract stays unchanged, while the worker now executes named graph nodes for normalization, tenant context loading, RAG context retrieval, intent classification, draft response, tool-call decision, quality gate, and audit persistence.

Context: LeadVirt already had a queued AI reply path with idempotent job ids and provider abstraction. Replacing that worker internals first gives a real graph runtime without disrupting widget, webhook, Telegram, or inbox enqueue flows.

Consequences:

- `@leadvirt/worker` owns the LangGraph dependency and orchestration code.
- Invalid `ai.reply` jobs now fail instead of falling back to demo tenant data.
- AI messages, usage logs, lead events, and audit logs include graph run metadata and retrieved knowledge references.
- The first quality gate can force a safe manager-follow-up reply when grounding is missing or confidence is too low.
- Remaining Phase 3 work is moving remaining sync reply paths to queue mode where appropriate and adding route-level regression coverage.

## 2026-07-05: Bootstrap RAG With Deterministic Local Embeddings And Optional Qdrant

Decision: The first LeadVirt RAG foundation uses tenant-scoped knowledge chunks, deterministic local hash embeddings, and optional Qdrant indexing/search. Qdrant is enabled by environment and DB vector fallback remains available for local/degraded operation.

Context: The immediate milestone is to prove tenant isolation, onboarding-to-knowledge sync, reindexing, search contracts, and Qdrant plumbing before wiring the LangGraph worker. A deterministic local embedding provider keeps tests repeatable and avoids spending real LLM/embedding budget while the RAG pipeline shape is still being stabilized.

Consequences:

- `BusinessKnowledgeChunk` stores source version, content hash, embedding metadata, vector point id, and index timestamps.
- `/api/knowledge/sources/reindex` chunks active tenant sources and indexes them into Qdrant when `RAG_QDRANT_ENABLED=true`.
- `/api/knowledge/sources/search` always applies tenant scoping and can fall back to DB vector similarity if Qdrant is unavailable.
- The local hash embedding provider is a bootstrap mechanism, not the final semantic retrieval quality layer.
- Production-quality RAG still needs semantic embeddings, hybrid retrieval, rerank, retrieval evals, and drift checks.

## 2026-07-05: Use LangGraph And Qdrant For The Production AI Runtime

Decision: The production AI runtime will use LangGraph for deterministic stateful agent orchestration and Qdrant for tenant-filtered RAG. AutoGen is reserved for simulations, agent-lab experiments, and regression test generation rather than the main runtime.

Context: LeadVirt needs a reliable business workflow for incoming leads: load tenant context, retrieve business knowledge, draft an answer, call CRM/booking tools, pass quality gates, and audit every action. A state graph is a better fit for that production path than unconstrained multi-agent conversation.

Consequences:

- The first AI build should focus on a queued worker running a LangGraph pipeline.
- RAG storage should be Qdrant with mandatory `tenant_id` payload filters.
- Eval combines RAGAS where useful with custom business golden sets for booking, escalation, and policy safety.
- OpenTelemetry, Prometheus, and Grafana are the target observability stack.
- Reliability work must include retries, timeouts, DLQ, idempotency, and tool-call audit logs.
- Security work must include PII redaction, RBAC/ABAC checks, and cross-tenant isolation tests.
- Detailed implementation phases live in `docs/AI_RUNTIME_IMPLEMENTATION_PLAN.md`.

## 2026-07-05: Keep Product Providers Off Public Landing

Decision: The root Next layout no longer wraps every route in `DesignProviders`; product/demo/onboarding routes opt into those providers where their components need nav/theme context.

Context: The public landing was hydrating product context providers even though its first screen does not need product navigation or theme state. That extra client work contributed to visible initial-load stutter.

Consequences:

- Landing, `/features`, `/pricing`, and `/solutions` can stay mostly server-rendered and keep a small first-load JS footprint.
- `/app`, `/demo`, and `/onboarding` must wrap their page trees with `DesignProviders` explicitly.
- New product routes that use `useNav` or `useTheme` should live under a provider-wrapped layout or add the provider at the route boundary.

## 2026-07-05: Deploy LeadVirt.ru Through GitHub Actions

Decision: Pushes to `main`/`master` and manual workflow runs can deploy `leadvirt.ru` through `.github/workflows/deploy-leadvirt-ru.yml`.

Context: Manual deploys were using local archives plus SSH. The release path should be repeatable from GitHub while keeping runtime secrets only on the VPS.

Consequences:

- GitHub stores only the dedicated `leadvirt-github-actions` deploy SSH private key in `LEADVIRT_DEPLOY_SSH_KEY`.
- Runtime env remains outside git at `/opt/leadvirt/secrets/.env`.
- The workflow verifies shared types, API, and web before deployment.
- Releases extract to `/opt/leadvirt/releases/<sha>`, and `/opt/leadvirt/current` points to the active release.
- The workflow always reapplies `deploy/nginx.https.conf` as the active nginx config for `leadvirt.ru`.
- Post-deploy checks require `https://leadvirt.ru/health` to pass and `/api/auth/me` without a cookie to return `401`.

## 2026-07-05: Use Telegram-Only Auth For RU Release

Decision: The Russian-market public auth flow uses Telegram login for both registration and sign-in. Password credentials remain only as a local/staff fallback controlled by `AUTH_CREDENTIALS_ENABLED`.

Context: Telegram can verify a Telegram user through a signed login payload. A "phone number plus code through Telegram" flow is not reliable for first login unless the user has already started/bound a bot chat or a separate Telegram Gateway/SMS product is used.

Consequences:

- `/login` and `/signup` show only Telegram auth UI.
- `/forgot-password` and `/reset-password` redirect to `/login` in the web app.
- `POST /auth/telegram` verifies Telegram HMAC signatures, creates a clean tenant/workspace for first login, and returns `authMode: "telegram"`.
- Production needs `TELEGRAM_LOGIN_BOT_TOKEN` or `TELEGRAM_LOGIN_BOT_ID` on the API so `/auth/telegram/config` can expose Telegram's numeric OAuth client id.
- BotFather Web Login allowed domains must include `https://leadvirt.ru`.
- `qa:auth:telegram` verifies invalid signatures, first workspace creation, repeat login, and `authMode=telegram`.

## 2026-07-05: Restrict RU Auth To Russian Email Or Russian Phone

Decision: The Russian-market release accepts credential signup/login only by Russian email domains or Russian phone numbers. `leadvirt.ai` remains a staff-domain exception until operator accounts are migrated.

Context: `leadvirt.ru` is the current RU product surface, while `leadvirt.ai` is reserved for the future English/global version. The RU auth form should not accept global mailbox providers for customer registration/login, but staging staff access must remain available.

Consequences:

- `/auth/signup` and `/auth/login` parse the same identifier field as either allowed email or normalized `+7...` phone.
- Phone users are stored with `User.phone`; the required `User.email` field receives a technical internal value and the product shell displays `phone || email`.
- `AUTH_IDENTIFIER_POLICY=global` can disable this restriction for the future global release; `AUTH_EXTRA_ALLOWED_EMAIL_DOMAINS` and `AUTH_STAFF_EMAIL_DOMAINS` extend exceptions.
- Password reset is no longer part of the public RU auth UI; credential reset remains only for local/staff fallback while `AUTH_CREDENTIALS_ENABLED` is enabled.
- `qa:auth:identifier-policy` verifies RU email and phone acceptance plus non-RU email rejection.

## 2026-07-04: Make leadvirt.ru The Current Production Endpoint

Decision: `https://leadvirt.ru` is now the current public endpoint for the Russian-market LeadVirt release. `www.leadvirt.ru` redirects to the apex domain.

Context: DNS for `leadvirt.ru` and `www.leadvirt.ru` now points to `193.187.92.88`. nginx HTTPS was enabled with certbot, public app env was switched from the raw IP to `https://leadvirt.ru`, and web/API/worker/nginx were rebuilt or recreated with the new env.

Consequences:

- Public QA and operator links should use `https://leadvirt.ru`.
- HTTP traffic redirects to HTTPS, and auth cookies are secure.
- Certificate renewal is handled by `/etc/cron.d/leadvirt-ru-certbot`.
- The raw IP remains a fallback/debug route, not the primary public URL.

## 2026-07-04: Use nginx Instead Of Caddy For LeadVirt Edge Proxy

Decision: LeadVirt deployment configs use nginx for the main app reverse proxy and the FR AI gateway. Caddy is retired from the deploy kit.

Context: The release domain plan now centers on `leadvirt.ru`, and the edge layer should be explicit nginx config. The current main app only needs HTTP reverse proxying before DNS/TLS cutover; HTTPS can be added with certbot-managed certificates.

Consequences:

- Main staging uses an `nginx` service with `/api`, `/health`, and `/health/ready` proxied to API and all other routes proxied to web.
- `leadvirt.ru` and `www.leadvirt.ru` are present in nginx server names before DNS is switched.
- ACME challenge paths are reserved under `/.well-known/acme-challenge/`.
- The FR AI gateway nginx config keeps `443` free for the existing `xray` service and serves OpenAI proxy traffic on `8443`.
- The FR gateway certificate is now managed by certbot rather than Caddy auto-ACME.

## 2026-07-04: Split LeadVirt Domains By Market

Decision: `leadvirt.ru` is the primary domain for the current Russian-market release. `leadvirt.ai` is reserved for the future global English version.

Context: The product will serve two market segments with different language and positioning. The current launch work should stay focused on the RU segment instead of mixing English/global routing into the first release.

Consequences:

- Current DNS, nginx, public URL, public preflight, and Master Budet bridge setup should target `leadvirt.ru`.
- `leadvirt.ai` should not be wired as the primary production app until English localization and global positioning are ready.
- Future routing can share the same app stack or split deployments, but language/market behavior must be explicit.

## 2026-07-03: Route OpenAI Traffic Through A Restricted FR AI Gateway

Decision: Staging keeps the main LeadVirt app on `193.187.92.88`, but routes OpenAI API calls through a dedicated FR gateway at `https://147-90-14-240.sslip.io:8443/v1`.

Context: Direct OpenAI calls from the main staging VPS returned `403 unsupported_country_region_territory`. The FR VPS egress reaches OpenAI successfully. Port `443` on the FR server is already occupied by `xray`, so the AI gateway runs on `8443` and uses HTTP-01 on port `80` for TLS issuance.

Consequences:

- Staging `AI_BASE_URL` points to the FR gateway while API keys stay only in the main staging secrets file.
- The gateway nginx config allows OpenAI proxy routes only from `193.187.92.88`; other clients receive `403 forbidden`.
- `xray` remains untouched on FR port `443`.
- Real provider smoke now passes from the staging API container with `AI_PROVIDER=openai`, `AI_ENABLE_REAL_PROVIDER=true`, and `gpt-5.5`.
- Full public readiness should be rerun after this infrastructure change.

## 2026-07-03: Deploy Staging With Docker Compose And Raw-IP HTTP First

Decision: The first LeadVirt staging deployment runs from `/opt/leadvirt/current` on `193.187.92.88` with Docker Compose, Postgres, Redis, API, worker, web, and nginx on HTTP port `80`.

Context: The server is ready before a production domain is attached. A raw-IP HTTP deployment is enough to validate container startup, migrations, credential auth, clean workspace data, and public route behavior. Because the browser uses HTTP, auth cookies are controlled by `AUTH_COOKIE_SECURE=false`; HTTPS should flip this to `true`.

Consequences:

- Runtime secrets live outside source in `/opt/leadvirt/secrets/.env`.
- Staging operator credentials live in `/opt/leadvirt/secrets/operator-login.txt`.
- The web build uses `NEXT_PUBLIC_API_URL=http://193.187.92.88/api`.
- A domain/HTTPS nginx config remains a follow-up before broader external testing.

## 2026-07-03: Treat OpenAI Host Region As A Release Gate

Decision: Public release remains blocked until LeadVirt's real AI provider can call OpenAI successfully from the deployed runtime environment.

Context: Local real-provider smoke passed with `gpt-5.5`, but the staging API container on `193.187.92.88` receives OpenAI `403 unsupported_country_region_territory`.

Consequences:

- `release:public-ready` should not be considered passable from this host until OpenAI access is fixed.
- Options are moving the app/API or AI worker to a supported region, routing OpenAI traffic through an approved supported-region gateway, or choosing another compliant provider path.
- Keeping `AI_PROVIDER=openai` and `AI_ENABLE_REAL_PROVIDER=true` on staging surfaces the failure honestly instead of silently falling back to mock AI.

## 2026-07-03: Use A Medium Ubuntu 24.04 Staging Server Baseline

Decision: The first public/staging LeadVirt server baseline is `medium` (`6 vCPU / 12 GB RAM / 160 GB SSD`) on Ubuntu 24.04 LTS, with one IPv4 address and hostname `leadvirt-staging-01`.

Context: The server should host LeadVirt plus additional small sites, so the smaller `mini` plan would be tighter than necessary. Ubuntu 24.04 LTS is the safer production baseline than older 22.04 or very new 26.04 for the first rollout.

Consequences:

- One IPv4 is enough because domains can be routed through a reverse proxy by hostname/SNI.
- A dedicated ED25519 SSH key is used for this server instead of reusing the default local SSH identity.
- `artifacts/scripts/server-post-install.sh` prepares the base host for Docker Compose deployments but does not deploy the app or write application secrets.

## 2026-07-03: Keep Clean Analytics And Integration Stats Empty

Decision: Clean workspaces must show zero connected integrations and zero response-time metrics until tenant-owned API/database records exist.

Context: A new credential workspace still showed one connected integration and an 18-second analytics response time because copied design defaults and backend placeholder metrics were leaking into real product screens.

Consequences:

- Integrations UI initializes every provider as disconnected and only marks providers connected from tenant API data.
- Analytics response-time stats return `0` average and p90 seconds when there are no inbound/outbound response samples.
- Analytics scenario runs and AI insights do not use static placeholder values for empty tenant data.
- Focused Playwright coverage now checks empty integration counts and empty analytics response time.

## 2026-07-03: Load Local Env Before AI Runtime Configuration

Decision: LeadVirt now loads the nearest root `.env` for API, worker, AI smoke, and public-release readiness scripts before reading AI/provider settings. OpenAI reasoning effort and response verbosity are explicit runtime settings, and real OpenAI calls require `AI_ENABLE_REAL_PROVIDER=true`.

Context: Local `.env` files were being edited, but some execution paths still relied only on the parent shell environment. That made OpenAI provider checks confusing and left `reasoning`/`verbosity` partly hardcoded in the provider. The env template also had `AI_ENABLE_REAL_PROVIDER=false`, but active runtime code did not honor that safety switch yet.

Consequences:

- `@leadvirt/config` owns shared `.env` loading and does not override variables already present in `process.env`.
- API and worker startup call the shared loader before constructing provider-dependent services.
- `AI_REASONING_EFFORT` and `AI_VERBOSITY` flow through config into `OpenAiProvider`.
- `AI_PROVIDER=openai` with `AI_ENABLE_REAL_PROVIDER=false` stays on mock AI locally and emits a provider-smoke warning instead of making external calls.
- `qa:ai:provider` and `release:public-ready` now evaluate local env files consistently with app startup.
- A missing or empty `AI_API_KEY` remains a hard failure when real provider calls are enabled, and public release readiness requires `AI_PROVIDER=openai`, `AI_ENABLE_REAL_PROVIDER=true`, and `AI_API_KEY`.

## 2026-07-02: Add Real OpenAI Provider Gate For Public Release

Decision: LeadVirt now has a real OpenAI-backed AI provider selected by `AI_PROVIDER=openai`, while `AI_PROVIDER=mock` remains the local QA default. Public release readiness fails unless `AI_PROVIDER=openai` and `AI_API_KEY` are set.

Context: The first real acquisition channel can accept Master Budet orders through Webhook/API, but a public release of an "AI administrator" should not silently use the local mock provider. OpenAI's current guidance favors the Responses API for GPT-5-series workloads and Structured Outputs for schema-constrained JSON, so the provider uses `/responses` with `text.format` JSON schemas.

Consequences:

- `packages/ai` exports `AI_PROVIDER_TOKEN`, `MockAiProvider`, and `OpenAiProvider`.
- API sync paths and worker queue processing resolve AI through the configured provider instead of directly constructing `MockAiProvider`.
- OpenAI calls use structured JSON schemas for reply generation, lead-field extraction, summaries, intent classification, and next-action recommendations.
- `AI_DEFAULT_MODEL` defaults to `gpt-5.5`, and `AI_BASE_URL` defaults to `https://api.openai.com/v1`.
- `qa:ai:provider` validates AI reply, extraction, recommendation, summary, and intent contracts against the configured provider.
- `release:public-ready` redacts AI keys in reports and fails closed when public/staging env would still use mock AI or the configured provider fails the smoke check.
- Local development and Playwright smokes continue using `AI_PROVIDER=mock` without an external API key.

## 2026-07-02: Use QA-Only Auth Rate-Limit Bypass For Browser Smokes

Decision: Browser QA helpers can send `x-leadvirt-qa: playwright` to bypass auth login rate limiting in non-production environments only.

Context: The full Playwright suite repeatedly logs in as clean users while validating app boundaries. After auth rate limiting landed, repeated local suite runs could exhaust the login bucket and fail unrelated product tests even though the limiter itself was working.

Consequences:

- Production ignores the QA bypass because it is gated by `NODE_ENV !== "production"`.
- The bypass is limited to the explicit QA header and current non-production process; ordinary local requests still exercise normal auth behavior.
- `qa:auth:rate-limit` does not send the QA header, so it continues to verify repeated reset requests return `429`.
- Full `qa:api` can be rerun during release hardening without waiting for login rate-limit windows to cool down.

## 2026-07-02: Use Webhook/API As The First Real Acquisition Channel

Decision: The first real acquisition channel for external release is Webhook/API, starting with the Master Budet order bridge. Instagram and WhatsApp remain deferred until their provider setup, permissions, and review paths are ready.

Context: Instagram setup was canceled for now, Meta Graph permissions only exposed WhatsApp in the current app state, and the Master Budet backend already has a working order-to-LeadVirt bridge shape. Webhook/API is the lowest-risk real traffic path because it does not require social OAuth review before the first public test.

Consequences:

- `POST /channels` can now provision tenant-scoped Website, Telegram, and Webhook/API channels with non-demo generated public keys.
- New Webhook/API public keys use the `lvwh_` prefix and companion `WEBHOOK_API` integration metadata is created automatically.
- Settings > Channels exposes the Webhook/API endpoint, public key, secret header, and secret so operators can configure the Master Budet bridge without manual database access.
- `qa:channels:provisioning` verifies a temporary workspace can create a Webhook/API channel, expose the companion integration endpoint, and accept public intake through the generated key.
- `provision:webhook-channel` is the operator path for staging/public setup: it logs in with target credentials, creates or reuses Webhook/API, prints Master Budet env values, and refuses demo public keys on non-local APIs.
- `qa:pilot:public` supports `LEADVIRT_PUBLIC_CHANNELS`, allowing the first release to validate only `webhook` while keeping the old all-channel default for full demo/tunnel checks.
- `release:public-ready` orchestrates strict auth readiness, Webhook/API provisioning, pilot packet generation, and public URL preflight for staging/public release.
- Staging/public setup should use a real generated Webhook/API key and secret for Master Budet, not `demo-generic-webhook`.

## 2026-07-02: Add Auth Staging Readiness Preflight

Decision: LeadVirt now has `corepack pnpm run qa:auth:staging-ready` to validate auth database schema, seed credential ownership, protected API no-cookie behavior, and staging/public auth environment posture before inviting external testers.

Context: Credential sessions, 2FA, password reset, and rate limiting are implemented locally, but the first staging/public database still needs an explicit go/no-go check after migrations and seed credentials are applied.

Consequences:

- The check verifies `AuthSession`, 2FA, and password-reset-token schema pieces directly against the configured database.
- The check verifies the seed credential user has a password hash, active tenant membership, and an owner/admin role.
- Protected workspace APIs such as `/auth/me`, `/current-tenant`, and `/dashboard/summary` must return `401` without a cookie.
- Local runs pass with warnings for dev env values; `LEADVIRT_AUTH_READY_STRICT=1` or staging/production env turns dev placeholders, mock email, disabled rate limiting, and localhost URLs into release-blocking failures.

## 2026-07-02: Add MVP Auth Rate Limiting

Decision: Public credential auth endpoints now have an in-memory rate limiter covering login, signup, password-reset request, and password-reset confirm attempts.

Context: Credential auth, 2FA, and self-service reset are now functional enough for public testing, but leaving those endpoints unlimited would make brute-force and reset-spam behavior too easy during pilot exposure.

Consequences:

- The limiter keys attempts by request IP plus email or token prefix, and returns `429` with a retry hint when a bucket is exceeded.
- `AUTH_RATE_LIMIT_DISABLED=true` can disable the limiter for controlled local testing.
- This is an MVP/local guard; a multi-instance staging or production deployment should replace it with a shared Redis-backed limiter.
- `qa:auth:rate-limit` verifies repeated reset requests are rejected after the allowed window count.

## 2026-07-02: Add Self-Service Password Reset With Mock Delivery

Decision: LeadVirt now supports self-service password reset through public request/confirm endpoints and dedicated `/forgot-password` and `/reset-password` pages. Reset tokens are stored only as hashes, expire after 30 minutes, are single-use, and reset completion revokes existing credential sessions.

Context: Team-owner password reset existed, but individual users had no self-service recovery path. A real outbound email provider is not chosen yet, so pretending to send email would make local/staging behavior misleading.

Consequences:

- `AuthPasswordResetToken` stores reset token hashes and expiry metadata through an additive migration.
- `POST /auth/password-reset/request` always returns a generic success response so email existence is not disclosed.
- Local/mock delivery exposes `resetUrl` and logs it for QA; production should wire the same generated URL into the chosen email provider.
- `POST /auth/password-reset/confirm` updates the password, clears temporary-password requirement, consumes outstanding reset tokens, and revokes active sessions.

## 2026-07-02: Add Local TOTP 2FA To Credential Auth

Decision: Settings Security now supports local TOTP 2FA setup with QR rendering, confirmation, disable, recovery-code regeneration, and 2FA-aware credential login. TOTP secrets are encrypted before storage, and recovery codes are stored only as password-style hashes.

Context: The credential auth flow already had password changes, temporary-password enforcement, HTTP-only sessions, and session revocation, but 2FA was still shown as planned. Release-readiness needs a real second factor before external testers can safely use credential workspaces.

Consequences:

- `User` has additive 2FA fields managed by the `user_two_factor` migration.
- `/settings/security` includes 2FA status, and `/settings/security/2fa/*` handles setup, enable, disable, and recovery-code regeneration.
- `/auth/login` accepts an optional `twoFactorCode`; accounts with enabled 2FA reject password-only login.
- `AUTH_2FA_ENCRYPTION_KEY` should be set in staging/production so encrypted TOTP secrets do not depend on local fallback material.
- The login screen includes an optional 2FA/recovery-code field, while ordinary password-only users keep the same flow.

## 2026-07-02: Separate Demo Preview From Real Workspace Data

Decision: `/app/**` is credentials-only and renders tenant-scoped database data only. `/demo` is the only demo surface, and it is a static read-only preview. API success with empty data means the UI shows an empty state, not a copied demo fallback.

Context: Clean users were still seeing copied demo leads, channels, billing rows, and activity inside the real workspace. That blurred the line between preview content and customer data, and made release testing unreliable.

Consequences:

- Tenant-scoped API endpoints such as `/auth/me`, `/current-tenant`, dashboard, inbox, leads, settings, billing, analytics, integrations, and automations require a valid credential session.
- Missing or invalid sessions return `401` and `/app/**` redirects to `/login`.
- The credentials-only backend guard is named `WorkspaceAuthGuard`; old `DemoAuthGuard` naming is retired from source.
- Demo fixtures are allowed only in explicit demo/test/reference surfaces, with `qa:demo-boundary` guarding against direct imports into real app pages.
- The copied product fixture file `design/product/data.ts` is removed and guarded against returning.
- `legacy-functional` is archival reference only; active app code must not import it or `features/mock`.
- Production widget frame/embed paths require an explicit public key; only `/widget/demo` hardcodes the seeded demo widget key.
- Public widget and intake endpoints continue to work by public key because they are public ingestion surfaces, not authenticated workspace data.
- Integration endpoint examples and "send test inbound" actions use explicit `sample` values, not demo-looking customer/event identities, and `qa:demo-boundary` guards against those old sample strings returning to the real integration service.

## 2026-06-27: Use 3001/4001 As LeadVirt Local Ports

Decision: LeadVirt local development now reserves `localhost:3001` for the web app and `localhost:4001` for the API.

Context: The user explicitly asked to always run LeadVirt on ports `3001` and `4001`. Earlier local runs used `3000`/`4000` or temporary `3002` ports, which made side-by-side app work and QA handoff easier to confuse.

Consequences:

- `agents.md`, `.env.example`, web package scripts, config defaults, API client defaults, and README now point at `3001`/`4001`.
- Local web starts should use `NEXT_PUBLIC_API_URL=http://localhost:4001/api`.
- Local API starts should use `PORT=4001`, `APP_URL=http://localhost:3001`, `API_URL=http://localhost:4001`, `CORS_ORIGINS=http://localhost:3001`, plus the local `DATABASE_URL` and `REDIS_URL`.
- The old `3000`/`4000` pair should only be used if the user explicitly asks for a one-off exception.

## 2026-06-27: Use Real Links For Product Shell Navigation

Decision: The product shell's desktop sidebar and mobile bottom navigation now render route changes as real Next links instead of buttons.

Context: The visual smoke exposed flaky client navigation while moving between product routes on a cold Next dev server. Primary navigation represents URL changes, so links give the app better browser semantics, pre-hydration behavior, accessibility, and Playwright stability while preserving the copied UI styling.

Consequences:

- Product route destinations are generated from the same `nav.tsx` route map through `hrefForRoute()`.
- Sidebar and mobile navigation are discoverable as links in accessibility tools and Playwright checks.
- App actions that do not represent document navigation remain buttons.
- Visual route-change assertions use a longer timeout to tolerate cold Next route compilation.

## 2026-06-27: Use Dashboard Activity For Product Shell Notifications

Decision: The product-shell notifications dropdown uses `dashboard/summary.recentActivity` when the API is available, shows an empty state when the backend returns no activity, and keeps the copied demo notifications only as API-offline visual fallback.

Context: The copied shell showed realistic notification items on every account, even when real activity was empty or different. Release testers should see tenant-specific activity without introducing a separate notifications backend before it exists.

Consequences:

- Existing dashboard summary data now powers the topbar notification menu.
- Tenants with no activity see a clear "no new events" state instead of fake lead/booking/CRM notifications.
- The product-layout smoke verifies that API recent activity appears in the menu.

## 2026-06-27: Route Product Shell Search Into Inbox

Decision: The product-shell search field now submits to `/app/inbox?q=...`, and Inbox reads that query as its initial local search filter.

Context: The copied topbar included a lead/chat search input, but it was decorative. Release testers expect a visible global search field to do something predictable without requiring a new search backend.

Consequences:

- Pressing Enter in the topbar search opens Inbox with the query prefilled and the existing local Inbox filter applied.
- The search form has `action="/app/inbox"` and `name="q"` so it works even before React hydration; the React submit handler keeps SPA navigation when hydrated.
- `/app/inbox` is dynamic in the Next build because it reads `searchParams`.

## 2026-06-27: Prefer Honest Empty API Key State Over Demo Key Fallback

Decision: Settings > API keys shows an empty state when the backend returns an empty API key list, and only uses copied demo keys when the billing/settings API is unavailable.

Context: The copied design included realistic-looking fake API keys. After the settings billing API became real, an empty `apiKeys: []` response still fell back to those fake keys, which could mislead release testers into thinking secret material exists.

Consequences:

- API-backed tenants with no keys now see a clear prompt to create the first key.
- Fake key rows are limited to API-offline visual fallback mode.
- The Settings Playwright smoke covers the empty backend response and verifies that `sk-live` demo keys do not appear.

## 2026-06-27: Use Real Auth Logout From The Product Shell

Decision: The product-shell account menu now calls `/auth/logout`, clears local auth/demo session hints, and routes the user to `/login` instead of using the copied demo navigation.

Context: Credential auth and temporary-password enforcement now depend on server-side session state. Leaving the account menu as a local route change would make a release tester think they had signed out while the HTTP-only credential cookie could still be valid.

Consequences:

- Product logout invalidates the active credential session through the API before navigating away.
- Client-side `leadvirt.auth.session` and `leadvirt.demo.session` hints are removed so old local state cannot steer the next auth flow.
- The product-layout smoke now mocks identity endpoints, verifies the logout request, checks local storage cleanup, and waits for the `/login` redirect.

## 2026-06-27: Enforce Temporary Password Change At The API Guard

Decision: Credential sessions with `passwordChangeRequired=true` are blocked by the workspace auth guard from workspace APIs until the user changes the password.

Context: The product shell already routed temporary-password users to Settings > Security, but frontend routing alone can be bypassed. Release auth posture needs the API to enforce the same boundary while still allowing the user to inspect auth state, open the current tenant shell, log out, and submit the password-change form.

Consequences:

- Temporary-password sessions can call `/auth/me`, `/me`, `/current-tenant`, `/auth/logout`, `GET /settings/security`, and `PATCH /settings/security/password`.
- Other guarded workspace APIs return `403` until the password is changed.
- The new `qa:auth:guard` script runs against the real local API/DB and verifies blocked, allowed, and unblocked states with a temporary workspace.
- Superseded on 2026-07-02: the old demo-header fallback is removed from workspace APIs; the guard is now `WorkspaceAuthGuard`.

## 2026-06-27: Require Password Change After Temporary Team Reset

Decision: Users who sign in with a team-reset temporary password are marked with `passwordChangeRequired`, routed to Settings > Security, and shown a required-change warning until they successfully set a new password.

Context: Team password reset now creates a real temporary password, but leaving it usable as a normal long-term credential would weaken the release auth posture. LeadVirt still does not have email reset delivery or a dedicated forced-password-change route, so the existing Security password form is the narrowest production-shaped path.

Consequences:

- `User.passwordChangeRequired` is an additive database column applied by the local migration runner.
- Team reset sets the flag; Settings Security password change clears it and revokes other sessions as before.
- `/auth/me`, login payloads, and `/settings/security` expose the flag so the product shell can route the user to `/app/settings?tab=security`.
- This is an app-level guard for the MVP; server-side route restriction and self-service email reset remain future auth-hardening work.

## 2026-06-27: Reset Team Passwords With One-Time Temporary Credentials

Decision: Settings > Team password reset now generates a temporary password, revokes the member's active sessions for the tenant, audits the action, and shows the generated password once in the UI.

Context: The copied Team menu had a toast-only password reset placeholder. LeadVirt has local credential auth now, but no outbound email/reset-token delivery or forced next-login password-change flow yet. For release readiness, owner/admin recovery needs to be real without pretending email automation exists.

Consequences:

- `POST /settings/team/:membershipId/reset-password` updates the target user's password hash and revokes active tenant sessions.
- The frontend requires confirmation and displays the temporary password in a modal that can be copied, but it is not stored client-side after the modal closes.
- Resetting your own password is intentionally routed through Settings > Security password change instead.
- Forced password change after temporary login and self-service email reset remain follow-up auth-hardening work.

## 2026-06-27: Show Real Webhook Metadata In Integrations API Section

Decision: The Integrations API/Webhook section now renders backend-provided Webhook/API endpoint metadata and links to `/app/settings?tab=api` for API key management instead of displaying copied fake secrets.

Context: The Integrations page already had API-backed readiness data, but the lower API/Webhook card still showed a fake `sk-admin` key and an external placeholder URL. That would be misleading during release review and pilot setup.

Consequences:

- Webhook endpoint URL, public key, secret header, and sample payload come from `IntegrationAccount.inboundEndpoint`.
- Settings routing now supports `?tab=api`, so product links can open the API keys tab directly.
- API keys remain owned by Settings > API keys; Integrations does not invent or expose fake key material.

## 2026-06-27: Use Manual Invoice Billing Until A Payment Provider Exists

Decision: Billing now exposes manual invoice payment metadata, payment-method change requests, and downloadable invoice files through API-backed flows instead of rendering a fake saved card and inert invoice icons.

Context: LeadVirt does not yet have a hosted checkout or payment-provider integration, but the copied Billing UI showed a Visa card and invoice download buttons. For release readiness, manual MVP billing should be explicit and auditable instead of simulating card storage.

Consequences:

- `/billing/payment-method` returns the current manual invoice payment method, and `/billing/payment-method/change-request` records an auditable operator request.
- `/billing/invoices` derives recent invoice rows from the tenant's manual subscription so the UI has API-backed invoice data without adding invoice tables prematurely.
- The Billing UI now says no card is stored in the product, disables duplicate change requests, and downloads `.txt` invoice files from the API-backed rows.
- Hosted checkout, payment-provider cancellation, card vaulting, and enforceable payment state remain future billing-provider work.

## 2026-06-27: Cancel Manual Billing Subscriptions In-App

Decision: Billing subscription cancellation now uses `POST /billing/current-subscription/cancel`, confirms the action in the copied UI, and persists the active subscription as `CANCELED`.

Context: After plan selection became API-backed, the copied Billing card still exposed an `Отменить подписку` button with no real behavior. Full checkout, refunds, payment-provider cancellation, and invoice lifecycle work are still out of scope for the MVP billing mode, but operators need an honest way to mark a manual subscription canceled.

Consequences:

- The API only cancels an active tenant subscription and records `billing.subscription_canceled` in the audit log.
- The UI shows the canceled state, disables repeat cancellation, and keeps the period end visible as the access-through date.
- Usage limits remain tied to the current subscription record through the end of the manual period; payment enforcement remains a later billing-provider task.
- The focused Billing Playwright smoke covers the confirmation dialog, cancel API call, and canceled-state rendering.

## 2026-06-27: Persist Manual Billing Plan Changes

Decision: Billing plan selection now changes the tenant's active subscription through `PATCH /billing/current-subscription` instead of only showing a local success toast.

Context: The copied Billing tab already displayed API-backed plans, usage, and the current subscription, but selecting a plan did not persist anything. Full checkout/payment-provider work is still outside the MVP release slice, so the safest next step is an auditable manual subscription switch that matches the current billing mode.

Consequences:

- The API validates plan codes, updates or creates the active tenant subscription, and records `billing.plan_changed` in the audit log.
- The Billing UI disables the current plan, shows a saving state during plan changes, updates local subscription/usage limits from the API response, and keeps fallback plans non-mutating when Billing API data is unavailable.
- The focused Billing Playwright smoke now verifies the selected `planCode` payload and the updated current-plan heading.
- Payment-method changes, hosted checkout, invoice downloads, and subscription cancellation remain follow-up billing work.

## 2026-06-27: Reconnect Settings Security To Credential Auth

Decision: Settings > Security now uses the local credential auth layer for password change and session management, while 2FA is displayed as a planned hardening item instead of a fake enabled toggle.

Context: After adding credential sessions, the copied Settings Security tab still showed static MacBook/iPhone rows and toast-only password/session actions. Leaving those in place would make the release feel less trustworthy than the underlying auth API actually is.

Consequences:

- `AuthSession` records now store IP address and user-agent metadata for operator-facing session visibility.
- `/settings/security` includes active credential sessions, and settings endpoints can change password, revoke one session, or revoke other sessions.
- Password changes revoke other active sessions while keeping the current session when available.
- Superseded on 2026-07-02: Settings now renders real credential/session data or empty states, without demo fallback rows.
- 2FA remains explicitly out of scope until setup, verification, recovery codes, and disable flows are implemented.

## 2026-06-27: Use Local Credentials With HTTP-Only Sessions For MVP Auth

Decision: LeadVirt now supports local email/password signup, login, logout, and `/auth/me` resolution through database-backed `AuthSession` records and an HTTP-only `leadvirt_session` cookie.

Context: The previous `/login` and `/signup` screens only verified `/auth/me` through the old demo auth guard, which was enough for visual and pilot smoke checks but not enough for release readiness. A full production auth provider is still out of scope, but the app needs a real session boundary before public/staging pilots.

Consequences:

- `User.passwordHash` and `AuthSession` are the MVP credential/session persistence layer.
- Superseded on 2026-07-02: workspace API guards now require a valid credential session and return `401` when no session cookie is present.
- The seeded demo owner can sign in locally with `admin@leadvirt.ai` / `demo-demo`.
- New signups create a trialing workspace, owner membership, onboarding state, and a credential session.
- Auth hardening remains a follow-up: password reset/change, 2FA, session-device management, production SSO/OAuth, and staged secret rotation.

## 2026-06-21: Use Design-Only React Project As UI Source Of Truth

Decision: `LeadVirt-React-design-only` is the current source of truth for `apps/web` UI/UX.

Context: The immediate priority is a one-to-one UI/UX copy, including animations, product screens, shadcn theme styling, Tailwind classes, and route-visible screens.

Consequences:

- Existing web functionality is preserved separately under `apps/web/src/legacy-functional`.
- New functional work should be layered onto the copied design UI rather than reverting to old web components.
- Visual changes should be checked against the copied design project when possible.

## 2026-06-21: Keep Next 15 As The Web Shell

Decision: `apps/web` remains a Next 15 application. The Vite design project is copied in as source, not run inside web.

Context: The user explicitly wanted the design copied into web while preserving Next as the future app shell for routing and functionality.

Consequences:

- Design navigation is adapted through Next routes.
- Next client boundaries and route wrappers are used around copied interactive components.
- Vite-specific assumptions are avoided in `apps/web`.

## 2026-06-21: Preserve Legacy Functional Code For Later Integration

Decision: Old functional UI code is archived, not deleted.

Context: Current priority is static visual fidelity, but API-backed functionality will be restored later.

Consequences:

- `apps/web/src/legacy-functional` is the reference area for reconnecting behavior.
- Active routes now render copied design UI.
- Future work should migrate behavior intentionally into design components.

## 2026-06-21: Add Artifact-Level Playwright Visual Smoke

Decision: Playwright smoke checks live in `artifacts/playwright/visual-check.spec.ts` for now.

Context: Visual and interaction QA was needed immediately, but the project does not currently include Playwright as a normal workspace dependency.

Consequences:

- QA can run with `corepack pnpm dlx @playwright/test test artifacts/playwright/visual-check.spec.ts --reporter=line`.
- The spec checks route readiness, screenshots, desktop sidebar navigation, and mobile bottom navigation.
- A later decision is still needed on whether to promote this into committed CI/test infrastructure.

## 2026-06-21: Maintain Checklist And Decision Log After Tasks

Decision: Future tasks should update `docs/CHECKLIST.md` and `docs/DECISION_LOG.md` as part of completion.

Context: The user requested an explicit task checklist, documentation updates after tasks, and a decision log.

Consequences:

- Agents should record completed work immediately after verification.
- New tasks discovered during implementation should be added to the active checklist.
- Material implementation decisions should be logged with context and consequences.

## 2026-06-22: Reconnect Design Dashboard Through A Thin API Adapter

Decision: The copied design dashboard reads `getDashboardSummary()` directly and falls back to copied demo data if the API is unavailable.

Context: The design UI should remain visually faithful while functionality is restored gradually. The existing legacy functional UI already had API patterns, but replacing the copied dashboard with the legacy view would break the new UI/UX direction.

Consequences:

- Dashboard metrics, weekly trend, channel performance, and recent activity can use real API data when LeadVirt API is available through `localhost:4001` or `NEXT_PUBLIC_API_URL`.
- Local visual QA can still run with only `apps/web` because the dashboard silently keeps demo data on API failure.
- API channel rows are aggregated by design channel id before rendering so multiple website-like API channel types do not create duplicate React keys.
- Dashboard delta pills remain design placeholders until the API exposes comparable trend deltas.

## 2026-06-22: Reconnect Design Inbox Through A Conversation API Adapter

Decision: The copied design inbox list reads `listInboxConversations()` directly, maps API conversations into design lead rows, and keeps copied demo rows as a visual fallback.

Context: The current product direction is to preserve the copied UI/UX while restoring functionality gradually. Replacing the copied inbox with legacy functional UI would break the design migration, but leaving it fully static would block the next functional layer.

Consequences:

- Inbox rows can render real conversations when the API is available.
- Row ids now use real conversation ids, so `/app/inbox/[conversationId]` can receive API-backed ids in the next step.
- Known API seed/demo strings are localized to avoid mixed English/Russian UI in local development.
- Empty API results currently fall back to copied demo rows to preserve visual QA; the real product empty-state policy still needs a follow-up decision.

## 2026-06-22: Reconnect Design Conversation Detail Through API Adapter

Decision: The copied conversation page now loads real conversations through `getConversation()` and sends manager messages through `sendConversationMessage()`, while keeping the copied demo conversation as fallback for `/app/inbox/demo` or API failures.

Context: The inbox already routes with real conversation ids, so the next functional layer needed to use those ids without replacing the copied design UI. The message mapping also needed to preserve the visual bubble roles used by the design.

Consequences:

- Real conversation ids render API-backed lead metadata and message history in the copied chat design.
- Manager messages render optimistically, then reconcile with the API response when available.
- API DTOs are mapped through `apps/web/src/design/product/apiAdapters.ts` so future copied pages can share the same channel, status, temperature, localization, and message mapping rules.
- The demo route remains visually stable for QA and fallback screenshots.

## 2026-06-22: Prefer Real Links For Landing CTA Navigation

Decision: Landing CTAs that navigate to app routes now render as real Next links styled through the copied Button component.

Context: Playwright exposed a pre-hydration click race: the "Войти" button was visible before its React `onClick` handler was ready. A real link is more robust for users and easier for accessibility tooling.

Consequences:

- `/` to `/app` and `/onboarding` navigation works before and after hydration.
- Playwright navigation smoke now locates the landing CTA by role `link` instead of role `button`.
- Product sidebar and in-app controls remain buttons where they perform app actions rather than document navigation.

## 2026-06-22: Reconnect Design Pipeline Through Lead API Adapter

Decision: The copied pipeline page now reads `getPipelineSummary()`, maps API leads into design lead cards, and mutates lead state through existing lead APIs with optimistic UI.

Context: The copied kanban/list UI should remain the visual source of truth, but the pipeline is now a functional product area. The API returns lead ids, while conversation navigation needs conversation ids, so the page also reads inbox previews to map `leadId` to `conversationId` when available.

Consequences:

- Pipeline metrics, stages, and cards can render real API lead data with copied demo fallback.
- Stage advance uses `updateLead()` and rolls back the card if the API update fails.
- Quick actions use `sendLeadToCrm()`, `createLeadTask()`, `bookLeadAppointment()`, and `updateLead()` where the copied UI exposes them.
- Lead ids remain stable for lead actions, while optional conversation ids drive "open dialog" navigation.
- Mobile kanban stacks stages vertically so pipeline remains readable on narrow screens.

## 2026-06-22: Use Demo Auth Verification Until Credential Auth Exists

Decision: `/login` and `/signup` render copied-design auth UI and verify access through the existing `/auth/me` demo endpoint before routing into the product.

Context: The backend at that time exposed demo identity through the old demo auth guard and `/auth/me`, but did not yet expose credential login/signup/session endpoints. Keeping redirect stubs would hide auth UX, while inventing fake credential APIs would create the wrong integration contract.

Consequences:

- Login routes to `/app` after `/auth/me` succeeds.
- Signup routes to `/onboarding` after `/auth/me` succeeds.
- Demo session metadata is cached in `localStorage` only as a temporary UI/session hint for future layering.
- Superseded on 2026-06-27 and tightened on 2026-07-02: real credential auth replaced `getAuthMe()`-only verification, and `/app/**` now requires a credential session.
- Auth routes are now included in Playwright functional and visual smoke checks.

## 2026-06-22: Reconnect Design Analytics Through Overview Mapping

Decision: The copied analytics page reads `/analytics/overview` through `getAnalyticsOverview()` and maps the API payload into the existing design chart/card arrays, with copied demo data as fallback.

Context: The analytics API shape is close to the design page but not identical: API uses `ChannelType`, scenario names, aggregate response time, and AI insight strings, while the copied UI expects design `ChannelId`s and chart-specific arrays.

Consequences:

- KPI cards, channel bars, donut data, scenario conversion, response-time trend, lead/booked trend, and AI recommendations can reflect real tenant data.
- API channels are folded into copied design channel ids, including `WEBHOOK` and `DEMO` into website and `PHONE` into call.
- Response-time trend is derived from API average and p90 until the backend exposes a time-series response metric.
- The page remains visually stable with demo data when the API is offline.
- `artifacts/playwright/analytics-api.spec.ts` verifies that API payloads actually render in the copied UI.

## 2026-06-22: Reconnect Design Integrations Through Provider Mapping

Decision: The copied integrations page keeps its visual catalog ids but maps every card to an API `IntegrationProvider` for list, connect, disconnect, connection test, and sample inbound actions.

Context: The design catalog uses readable ids such as `amocrm`, `gcalendar`, and `webhook`, while the API expects provider values such as `AMOCRM`, `GOOGLE_CALENDAR`, and `WEBHOOK_API`. The copied UI should remain the visible source of truth, but actions need to hit the backend provider contract.

Consequences:

- `/app/integrations` can render real connected/disconnected states from `/integrations`.
- Connect and disconnect use optimistic UI with rollback if the API call fails.
- Connection test and sample inbound actions reuse existing API endpoints without replacing the copied dropdown/confirm UI.
- Telegram and Webhook/API expose sample inbound actions because those are the providers supported by the backend sample endpoint.
- `artifacts/playwright/integrations-api.spec.ts` verifies provider mapping and connect/disconnect behavior.

## 2026-06-22: Reconnect Design Automations Through Workflow Metadata

Decision: The copied automation builder reads workflows from `/workflows`, maps API steps into existing visual block cards, and reconnects workflow save, publish/pause, and test actions to the workflows API.

Context: The backend `UpsertWorkflowDto` currently accepts workflow name, description, and status, but not step/block edits. The copied UI includes a richer builder canvas, so persisting block changes would require a backend contract that does not exist yet.

Consequences:

- `/app/automations` can render real workflow tabs and step cards when API data is available.
- The save button updates workflow metadata and publishes active workflows through `/workflows/:id/publish`.
- The active toggle maps to `ACTIVE` or `PAUSED` status on save.
- The test button calls `/workflows/:id/test` and surfaces the backend run result.
- Block add/delete/toggle remains local UI state until workflow step persistence is added to the API.
- Known seed workflow names, descriptions, and step labels are localized before rendering in the Russian product UI.
- `artifacts/playwright/automation-api.spec.ts` verifies list, test, update, and publish behavior.

## 2026-06-22: Reconnect Design Settings Through Settings API Context

Decision: The copied settings page uses a local settings API context to load account, team, security, and billing data into the existing tab components.

Context: The settings UI has several tab panels that were copied from the design project. Passing every API result through each tab would require a wider rewrite, while a small context keeps the visual component structure intact and lets each tab consume only the data it needs.

Consequences:

- Company profile fields hydrate from `/settings/account`, and the save button calls `updateAccountSettings()`.
- Team members, security summary, and API key rows render API data with copied demo fallbacks.
- The copied tab layout, cards, animations, and mobile behavior stay intact while functionality is layered in.
- Billing inside settings can display API keys, but the separate billing product route still needs a future reconnect.
- `artifacts/playwright/settings-api.spec.ts` verifies settings hydration and profile save behavior.

## 2026-06-22: Use Copied Settings Billing Tab As The Billing Product Route

Decision: `/app/billing` now renders the copied settings page directly on the billing tab and hydrates plan, subscription, and usage data from the billing API.

Context: The design project has a polished billing tab but no separate product billing screen. Reusing that tab preserves visual fidelity while replacing the old legacy billing view and keeping Next routing explicit.

Consequences:

- `/app/billing` opens the billing tab with a route-specific "Биллинг" title.
- The copied upgrade controls route to `/app/billing`, while the settings sidebar item remains the active product navigation group.
- Billing usage bars, current plan, billing period, and plan modal can reflect `/billing/plans`, `/billing/current-subscription`, and `/billing/usage`.
- Plan selection remains a local/demo action until the backend exposes a subscription-change endpoint.
- `artifacts/playwright/billing-api.spec.ts` verifies route hydration and upgrade-button routing.

## 2026-06-22: Verify Widget Public API Flow Without Rewriting The Widget UI

Decision: The existing `LeadVirtWidget` component remains the widget implementation, and public widget behavior is covered with a focused Playwright smoke instead of a UI rewrite.

Context: The widget already loads `/public/widget/:publicKey/config`, stores a local session id, sends messages to `/public/widget/:publicKey/messages`, and exposes `/widget/embed.js`. The next useful step was to prove those contracts from the browser and preserve the current floating chat UX.

Consequences:

- `artifacts/playwright/widget-api.spec.ts` verifies config hydration, message POST body, rendered AI response, and embed script output.
- The smoke saves `artifacts/playwright/fresh-widget-demo-desktop.png` for visual review of the open widget.
- No tenant-side widget editor was added, because there is not yet an admin widget settings endpoint in the web API layer.

## 2026-06-22: Wire Conversation Lead Actions To Lead APIs By Lead Id

Decision: Conversation detail actions now use `conversation.lead.id` for CRM sync, task creation, appointment booking, and qualification.

Context: The copied conversation UI shows lead action buttons, but the route id is a conversation id. Sending lead actions to that id would be incorrect, so the page keeps route/conversation ids separate from the nested API lead id.

Consequences:

- Desktop side-panel actions and mobile sticky actions call the same handler and share loading/disabled states.
- CRM sync and qualification apply the returned lead to the current conversation state.
- Appointment booking refreshes the conversation because the backend returns a booking, not the updated lead.
- Demo-only conversations show an error instead of pretending the API action succeeded.
- `artifacts/playwright/conversation-actions.spec.ts` verifies action calls use the API lead id.

## 2026-06-22: Persist Automation Builder Blocks As Workflow Steps

Decision: Workflow save now sends the current automation block list as `steps`, and `PATCH /workflows/:id` synchronizes workflow steps transactionally.

Context: The copied automation builder already let users add, delete, and toggle blocks, but only workflow metadata was saved. The database already had `WorkflowStep`, so the smallest durable contract was to let the upsert DTO accept a full step list instead of adding a separate endpoint.

Consequences:

- Existing steps are updated by id, missing steps are deleted, and new steps are created in the same transaction as workflow metadata.
- The frontend maps copied block types to API `WorkflowStepType` and stores `blockType`, `subtitle`, and `enabled` inside step config.
- `ACTION` steps can round-trip as either CRM or booking blocks through `config.blockType`.
- Workflow version increments when steps are saved.
- Detailed right-panel settings remain local until those controls are modeled as editable block config fields.
- `artifacts/playwright/automation-api.spec.ts` now verifies the saved step payload.

## 2026-06-22: Centralize CRM API-To-Design Mapping

Decision: Inbox, Dashboard, Analytics, Pipeline, and Conversation share CRM-facing mapping helpers from `apps/web/src/design/product/apiAdapters.ts`.

Context: The copied product pages initially reintroduced local copies of channel, stage, temperature, relative-time, localization, and lead mapping helpers. As more API-backed screens came online, those duplicated helpers increased the chance of inconsistent channel labels and seed-text localization.

Consequences:

- Inbox now uses `leadFromConversation()` from the shared adapter.
- Dashboard and Analytics use the shared `channelIdFromType()` mapping.
- Dashboard wraps the shared relative-time label only to preserve its existing "назад" copy.
- Future product API mapping changes should start in `apiAdapters.ts` unless they are page-specific display logic.

## 2026-06-22: Show Real Inbox Empty State For Empty API Results

Decision: Inbox falls back to copied demo leads only when the API request fails; a successful API response with zero conversations renders an empty state.

Context: Demo fallback is useful for local visual QA when the LeadVirt API is offline, but a real tenant with no conversations should not see fake leads.

Consequences:

- Empty API data shows "Диалогов пока нет" in the list and an empty right pane on desktop.
- Filtered empty results still show the search/filter reset action.
- Offline API behavior is unchanged, so visual smoke can still run without the API server.
- `artifacts/playwright/inbox-empty-state.spec.ts` verifies the empty API policy.

## 2026-06-22: Store Automation Block Settings In Workflow Step Config

Decision: Copied automation block settings are controlled by `WorkflowBlock.config` and persisted through each workflow step `config`.

Context: Workflow step persistence already saved block order, type, enabled state, and subtitles, but the copied right-panel forms still used hardcoded local values. The backend step config is the existing flexible place to round-trip block-specific settings without adding a larger workflow schema yet.

Consequences:

- Trigger channels and keyword filters, AI greeting settings, qualification questions, conditions, booking templates, follow-up copy, and CRM fields now round-trip through save.
- The copied settings UI keeps its component structure and animations while becoming data-backed.
- Backend workflow storage remains generic; a future workflow executor must interpret these config fields explicitly.
- `artifacts/playwright/automation-api.spec.ts` verifies that edited settings are included in the saved step payload.

## 2026-06-22: Calculate Dashboard Metric Deltas In The API

Decision: `/dashboard/summary` now returns stat-card deltas from current 7-day data compared with the previous 7 days.

Context: The copied dashboard design included polished delta pills, but after API hydration those percentages were still static placeholders. The backend already owns the dashboard aggregation, so it is the right layer to calculate consistent metric deltas.

Consequences:

- Dashboard stat cards display real API deltas for leads, AI conversations, bookings/orders, CRM sends, average response time, and conversion.
- Average response time is estimated from customer inbound messages and the next AI/user outbound response when message data exists.
- The web dashboard keeps copied placeholder deltas only when the API is offline or older mocked data omits `metrics.deltas`.
- `artifacts/playwright/dashboard-api.spec.ts` verifies dashboard delta rendering.

## 2026-06-22: Resume And Persist Copied Onboarding Through API State

Decision: The copied onboarding flow now hydrates from `/onboarding/state`, persists step data on forward progress, and completes steps through `/onboarding/complete-step`.

Context: The onboarding UI was visually complete but fully local. The backend already exposes onboarding state, so reconnecting that API restores real progress tracking without replacing the copied animated flow.

Consequences:

- `/onboarding` resumes the last saved step instead of always starting from business type.
- Business type, channels, AI scenario, company info, and CRM choice are stored in onboarding state data.
- A local-change guard prevents late API hydration from overwriting choices the user already made.
- Visual smoke accepts any resumed onboarding step as route-ready, and `artifacts/playwright/onboarding-api.spec.ts` verifies persistence.

## 2026-06-22: Use Channel Settings As Tenant Widget Configuration

Decision: Website widget admin settings are stored in the existing website `Channel.settings.widget` object and updated through tenant-scoped `PATCH /channels/:id`.

Context: The public widget already reads title, colors, position, suggested replies, consent text, and welcome copy from channel settings. Adding a separate widget table or endpoint would duplicate the existing public config source.

Consequences:

- Settings > Channels can edit the same values served by `/public/widget/:publicKey/config`.
- Channel status toggles are persisted through the same tenant-scoped channels API.
- `Channel` responses now include `publicKey` and `settings` for admin UI use.
- `artifacts/playwright/channels-widget-settings.spec.ts` verifies the settings modal PATCH payload.

## 2026-06-22: Keep Playwright As Artifact-Level QA With Root Scripts

Decision: Playwright remains invoked through `pnpm dlx @playwright/test`, but root scripts now wrap the common smoke suites.

Context: The workspace has many focused artifact specs and one full visual sweep, but Playwright is not a normal workspace dependency or CI job yet. Direct long commands were error-prone, and parallel focused smoke overloaded `next dev`.

Consequences:

- `corepack pnpm run qa:api` runs the focused browser/API smokes sequentially with one worker.
- `corepack pnpm run qa:visual` runs the full desktop/mobile visual sweep with one worker.
- `corepack pnpm run qa:all` chains both suites for a local confidence pass.
- A later CI decision can still promote Playwright to a committed dependency if needed.

## 2026-06-22: Use A Shared Hook For Read-Only API Hydration

Decision: Read-only copied product pages should use `apps/web/src/design/product/useApiResource.ts` when they only need to load an API resource and fall back to existing demo UI data on failure.

Context: Dashboard and Analytics both had the same mount-only API load pattern with unmount guards and `null` fallback state. Keeping that code repeated makes future behavior drift likely, but action-heavy pages still need local optimistic state and should not be forced through a generic hook.

Consequences:

- Dashboard and Analytics now share cancellation, loading, success, and error-state handling for simple API hydration.
- Demo fallback remains page-owned, so copied visual data stays intact when the API is offline.
- Pages with multi-resource loading, optimistic mutations, or tab-specific state can keep local effects until a clearer shared abstraction appears.

## 2026-06-22: Wire Conversation Menu Actions To Conversation APIs

Decision: The copied conversation overflow menu now calls existing conversation APIs for manager handoff and open/closed status changes.

Context: The design already included menu items for dialog-level actions, but they were toast-only placeholders. The API client and backend already expose `handoff`, `status`, and assignment endpoints, so menu actions can restore real behavior without replacing the copied chat UI.

Consequences:

- "Передать менеджеру" calls `/conversations/:id/handoff` and reflects the returned `WAITING_FOR_HUMAN` state in the header indicator.
- "Закрыть диалог" and "Открыть диалог" call `/conversations/:id/status` and reuse the copied menu surface.
- The menu trigger now has an accessible label for keyboard and Playwright access.
- `artifacts/playwright/conversation-status-actions.spec.ts` covers handoff, close, and reopen calls and is included in `qa:api`.
- Automation API smoke now waits for seeded trigger settings before editing to avoid late API hydration races during full-suite runs.

## 2026-06-22: Draft AI Replies Through Conversation Context

Decision: AI reply drafting is exposed as `POST /conversations/:id/ai/reply` through `ConversationsService`, not through the old hardcoded standalone `AiController`.

Context: The copied conversation UI needed a real AI helper that works with the selected API conversation. The old controller ignored tenant context and conversation id, while `ConversationsService` already has the correct tenant guard, conversation loading, and message history.

Consequences:

- AI draft replies now use the real tenant, business type, conversation id, and conversation messages.
- Drafting fills the copied message composer and does not send automatically, so a manager can review or edit before sending.
- The standalone `AiController` was removed from `AiModule` to avoid duplicate routes and misleading demo behavior.
- The icon-only send button now has an accessible label.
- `artifacts/playwright/conversation-ai-draft.spec.ts` verifies drafting into the composer and sending the drafted text.

## 2026-06-22: Keep Visual QA Offline-API Tolerant

Decision: Visual smoke treats generic `net::ERR_CONNECTION_REFUSED` resource noise as benign when the API is offline, while still requiring the web app and design reference server to render.

Context: `apps/api` cannot start in the current local shell without `DATABASE_URL`, but copied product pages intentionally keep demo fallbacks for visual QA. Chromium sometimes reports API failures both as URL-specific request failures and as generic console errors.

Consequences:

- `qa:visual` can run without a live API as long as the UI falls back cleanly.
- The design-only reference server should still run on `localhost:5173` for full visual comparison.
- Real API-backed behavior remains covered by focused Playwright specs that mock the API contract.

## 2026-06-22: Use Conversation Lead Events For Timeline

Decision: The copied conversation side-panel timeline uses `ConversationDetail.events` when API data is available and falls back to the copied static timeline only for demo/offline conversations.

Context: The backend already returns recent lead events with conversation detail. Keeping the side-panel timeline static hid real CRM syncs, bookings, task creation, and lead updates even after the rest of the conversation page became API-backed.

Consequences:

- Real API conversations show lead event titles and relative times in the copied timeline layout.
- Event types map to existing copied icons and color treatments instead of introducing a new visual system.
- Demo conversations and offline visual QA keep the original copied timeline.
- `artifacts/playwright/conversation-events-timeline.spec.ts` verifies that API events replace the static fallback.

## 2026-06-23: Hydrate Product Shell Identity From Tenant Context

Decision: The copied product shell reads account identity from `/auth/me` and `/current-tenant`, while keeping the copied `Студия Glow` demo identity as the fallback when the API is offline.

Context: The sidebar account block is visible across product routes and was still fully static after most page-level functionality had been reconnected. The backend already exposes demo user and current tenant context through tenant-scoped endpoints.

Consequences:

- Product routes can show the real tenant name and user email without replacing the copied layout, animations, or Tailwind styling.
- Offline visual QA remains stable because API failures keep the original design-only demo identity.
- Tenant API access is centralized in `apps/web/src/lib/api/tenants.ts` for future workspace switching.
- `artifacts/playwright/product-layout-identity.spec.ts` verifies the shell identity contract and is included in `qa:api`.

## 2026-06-23: Persist Copied Integration Settings Through Existing API

Decision: The copied integrations "Настроить" dropdown action now opens an editable settings modal and saves it through `PATCH /integrations/:provider/settings`; `IntegrationAccount` responses include `settings`.

Context: The integrations page already had a settings menu item and the web API adapter already exposed `updateIntegrationSettings()`, but the copied UI only showed a toast. The backend stored integration settings but did not return them in the shared DTO, so the UI could not round-trip saved settings.

Consequences:

- Connected integration cards can persist display name, endpoint URL, API token, sync mode, sync enabled state, and notes without replacing the copied card/dropdown UI.
- Future integration-specific forms can build on the same `settings` field instead of adding a new endpoint.
- The shared dropdown item now closes after selection, matching normal menu UX and preventing stale open menus from blocking follow-up actions.
- `artifacts/playwright/integrations-api.spec.ts` verifies connect, disconnect, settings modal editing, and settings PATCH behavior.

## 2026-06-23: Export Conversation Transcripts Client-Side

Decision: The copied conversation "Экспорт переписки" menu action now downloads the currently visible conversation as a `.txt` transcript from the browser.

Context: Conversation detail already hydrates API/demo messages into copied chat state. Exporting that visible state avoids a new backend endpoint while turning the copied menu placeholder into useful manager-facing behavior.

Consequences:

- API-backed and demo conversations can be exported with lead metadata, conversation id, status, and message sender labels.
- The export reflects the messages currently visible in the copied chat UI, including optimistic manager messages if present.
- A future server-side export endpoint can replace this if audit-grade immutable transcripts are required.
- `artifacts/playwright/conversation-export.spec.ts` verifies the download filename and transcript contents.

## 2026-06-23: Separate Demo Preview From Client Login

Decision: Landing `Войти` links route to `/login`, while `Смотреть демо` routes to `/demo`, which renders the product demo dashboard.

Context: Users should not confuse a demo preview with client account access. The previous landing buttons sent both intents directly into `/app`, which made demo exploration and login feel identical.

Consequences:

- Prospects can open `/demo` to inspect the product without passing through the login screen.
- Returning clients use `/login` first and then continue into `/app` after the auth flow.
- `/demo` uses the copied product dashboard and the same demo/API fallback behavior as the product shell.
- Visual smoke now covers `/demo` on desktop/mobile and verifies `Войти -> /login` plus `Смотреть демо -> /demo`.

## 2026-06-23: Execute MVP Workflows Inside The API

Decision: Active automation workflows now execute through a synchronous API-side runtime for inbound widget, webhook, and Telegram messages, without requiring Redis for the local MVP path.

Context: The builder already persisted workflow steps, and the worker could process AI reply jobs, but workflow queues still returned placeholder results. The user confirmed that Auth, Billing, Integrations, and deployment are out of scope, while product automation runtime should move forward.

Consequences:

- `WorkflowsService` now owns a reusable runtime executor that creates `WorkflowRun` and `WorkflowRunEvent` records from persisted steps.
- Workflow test runs use the same executor instead of a one-event placeholder.
- Runtime matching honors active workflows, trigger channel settings, keyword filters, disabled steps, and simple condition rules.
- Inbound widget, webhook, and Telegram services trigger workflow runs after successful message processing.
- The MVP runtime records usage counters and lead timeline events while avoiding duplicate automated chat messages from every active seed workflow.

## 2026-06-23: Persist Non-Auth Settings Actions

Decision: Settings team management, notification preferences, and API key create/revoke actions are persisted through Settings API endpoints.

Context: The Settings UI had several toast-only actions. Auth-specific controls remain out of scope, but team roles, notification preferences, and API keys can use existing database models without introducing a full auth system.

Consequences:

- Team invite/create, role update, and removal use `Membership` and `User` records while preserving owner safety checks.
- Notification toggles are stored in `Tenant.settings.notifications`.
- API key creation stores only a hash and shows the generated secret once in the UI; revocation sets `revokedAt`.
- Settings Playwright coverage now verifies account save, team actions, notification toggles, and API key create/revoke behavior.

## 2026-06-23: Keep Conversation Id And Lead Id Separate In Inbox Actions

Decision: Inbox rows now carry both the conversation id for navigation and the API lead id for lead actions.

Context: The copied inbox design selected rows by conversation, but quick actions such as CRM sync and task creation operate on leads. Reusing the row id for both would call lead APIs with a conversation id.

Consequences:

- `Lead` design rows can include `apiLeadId` in addition to `conversationId`.
- Inbox quick actions call lead APIs only when an API lead id is present.
- A focused Inbox Playwright smoke verifies that quick actions send requests to `/leads/:leadId/...`, not `/conversations/:id`.

## 2026-06-23: Give Full Visual Smoke Enough Route-Settle Time

Decision: The copied UI visual smoke now uses a shorter per-route settle delay and a longer per-test timeout for navigation-heavy checks.

Context: The desktop route-mapping check already reached the correct pages, but repeated one-second settle waits made the test hit Playwright's default timeout when Next had to compile many routes during a cold run.

Consequences:

- The full desktop/mobile visual sweep remains strict about visible route readiness while avoiding artificial timeout pressure.
- Cold `qa:visual` runs can still take around 3 minutes because route compilation and screenshots are intentionally covered.
- The current visual smoke passed 32/32 checks against the Next app and the design-only reference server.

## 2026-06-23: Export Analytics Reports From Visible Data

Decision: The copied Analytics `Экспорт` action now generates a CSV download in the browser from the currently rendered analytics data.

Context: Analytics already hydrates KPI, channel, scenario, response-time, lead trend, and AI insight data from `/analytics/overview` with a demo fallback. The export button previously only showed a toast, while a server-side report pipeline would add unnecessary backend scope for the current MVP.

Consequences:

- API-backed and demo analytics views can export the same data the manager sees on screen.
- No new backend endpoint is required for the current product stage.
- A future server-side PDF/XLSX export can replace this client-side CSV path if branded reports, scheduling, or audit-grade snapshots become required.
- `artifacts/playwright/analytics-api.spec.ts` verifies the CSV filename and exported API-backed contents.

## 2026-06-23: Make Analytics Period Controls API-Backed

Decision: `/analytics/overview` now accepts `period=7d|30d|quarter`, and the copied Analytics segmented control refetches the overview for the selected period.

Context: The copied UI exposed `7 дней`, `30 дней`, and `Квартал`, but the previous implementation only updated local state while the backend always returned the same tenant-wide aggregation.

Consequences:

- Analytics leads, bookings, orders, workflow runs, response-time stats, revenue, and trend buckets now respect the selected period.
- The web API adapter owns the period query mapping, keeping the product page close to the copied design structure.
- The default remains `30d`, preserving the existing initial visual state.
- `artifacts/playwright/analytics-api.spec.ts` verifies initial `period=30d`, period switch to `7d`, and CSV export using the active period.

## 2026-06-23: Create Automation Workflows From Copied Scenario Tabs

Decision: The Automation page keeps copied scenario tabs visible even when fewer API workflows exist, and saving an empty tab creates a backend workflow.

Context: Previously, receiving any workflow from the API replaced the copied scenario tabs entirely. When no workflow existed for a tab, Save only showed a toast, so users could edit copied blocks without persisting a new scenario.

Consequences:

- The copied design tabs remain available as workflow templates while API workflows hydrate their matching slots.
- Saving a template slot calls `POST /workflows`, then publishes it when the scenario is active.
- New workflow steps omit copied static block ids so Prisma can generate unique ids and avoid cross-workflow collisions.
- `artifacts/playwright/automation-api.spec.ts` verifies update/test for existing workflows and create/publish for copied template tabs.

## 2026-06-23: Archive And Duplicate Automation Workflows Through Existing APIs

Decision: Automation duplicate uses `POST /workflows` with generated step ids, and archive uses `PATCH /workflows/:id` with `status=ARCHIVED`; default workflow listing hides archived records.

Context: The copied Automation builder needed manager-facing lifecycle actions beyond save/publish/test. Adding new endpoints was unnecessary because the existing workflow create/update APIs already support the required persistence.

Consequences:

- Duplicating a workflow produces a separate backend workflow without reusing static copied block ids.
- Archiving removes the workflow from the normal builder list and returns its UI slot to the copied template state.
- Archived workflows are preserved in the database for future restore/list UI instead of being hard-deleted.
- `artifacts/playwright/automation-api.spec.ts` verifies update/test, create from template, duplicate, and archive flows.

## 2026-06-23: Restore Archived Automation Workflows As Paused

Decision: Automation archive recovery uses `/workflows?includeArchived=true` for listing and restores selected workflows with `PATCH /workflows/:id` to `status=PAUSED`.

Context: Archived workflows need to remain recoverable from the copied builder UI, but restoring directly to `ACTIVE` could unexpectedly resume automation runs.

Consequences:

- The default `/workflows` list still hides archived records, keeping the main builder clean.
- The archive modal can list recoverable workflows without adding a new route or endpoint.
- Restored workflows return to the builder switched off so the user can inspect, edit, test, and publish deliberately.
- `artifacts/playwright/automation-api.spec.ts` verifies archive listing with `includeArchived=true` and restore-to-paused behavior.

## 2026-06-23: Show Automation Workflow Status In The Builder

Decision: Automation scenario tabs and the active toolbar now show compact status badges for templates, active workflows, drafts, paused workflows, archived records, and locally restored workflows.

Context: After adding create, duplicate, archive, and restore flows, users needed an immediate visual cue for whether the selected scenario is live, paused, unsaved template-only, or just restored from archive.

Consequences:

- Restored workflows are labeled separately from ordinary paused workflows in the current browser session, even though both persist as `PAUSED`.
- Template slots remain visually distinct from API-backed workflows.
- Status labels stay inside the copied Automation layout instead of adding a separate management table.
- `artifacts/playwright/automation-api.spec.ts` verifies active, draft, paused, and restored badge states.

## 2026-06-23: Track Automation Unsaved Changes From Builder Snapshots

Decision: The Automation builder compares the current scenario name, active state, and block step payload against the last hydrated or saved workflow snapshot to show an explicit unsaved-changes state.

Context: Managers preparing workflows for first test clients need to know whether the currently visible scenario is already saved/published or still only edited in the browser. Manual dirty flags would be fragile because workflow changes can come from block config edits, add/delete actions, tab switches, archive restore, and API hydration.

Consequences:

- The toolbar shows `Несохранено` when the visible workflow differs from the last saved snapshot.
- The save button changes to `Сохранить изменения` only when there are pending edits.
- Hydrating, creating, duplicating, restoring, or saving a workflow resets the snapshot to the visible saved state.
- `artifacts/playwright/automation-api.spec.ts` verifies the dirty badge appears after an edit and disappears after save.

## 2026-06-23: Treat Social Lead Traceability As Pilot Readiness Coverage

Decision: Root API QA now includes a focused browser smoke that verifies Telegram and Instagram leads remain visibly traceable across Inbox and Pipeline.

Context: The next product milestone is running first test clients from social networks. For those pilots, it is not enough for an inbound message to exist in data; managers must immediately see the client name, social channel, source, and lead context in the working surfaces they will use daily.

Consequences:

- `artifacts/playwright/social-intake-visibility.spec.ts` mocks Telegram and Instagram leads and verifies their names, sources, and channel labels in Inbox and Pipeline.
- `qa:api` now runs 28 Playwright checks and includes social intake visibility.
- Future social/webhook/widget intake work should preserve visible source/channel labels instead of collapsing everything into generic website/demo leads.

## 2026-06-23: Use Controlled Demo Intake For First Social Pilots

Decision: The first social test-client pilot should run through controlled demo intake paths documented in `docs/FIRST_CLIENT_PILOT_RUNBOOK.md`, while real Auth, Billing, production OAuth integrations, and auto deployment remain out of scope.

Context: The product is ready to validate the manager-facing lead loop, but production social account connection and deployment work is intentionally deferred. The safest pilot path is to use the seeded demo tenant, public Telegram/webhook/widget endpoints, and focused QA coverage to prove lead intake, conversation handling, automation, and pipeline follow-up.

Consequences:

- Pilot setup uses known demo public keys and headers from the local README.
- The pilot script emphasizes visible client/source/channel traceability and manager workflows.
- Gaps discovered during pilots should be logged as product-loop issues unless they belong to the explicitly deferred Auth/Billing/Integrations/deployment scopes.

## 2026-06-23: Cover Public-Entry Lead Traceability Before Live Pilots

Decision: Webhook/API and website widget lead visibility are covered with a focused browser smoke in addition to Telegram and Instagram visibility.

Context: First social pilots may use direct Telegram traffic, but they may also use social landing pages, zap-style webhook intake, or the website widget as the practical first entry point. Those sources still need to remain recognizable to managers in Inbox and Pipeline.

Consequences:

- `artifacts/playwright/webhook-widget-intake-visibility.spec.ts` verifies webhook and widget-origin leads keep their name, source, channel label, summary, and pipeline visibility.
- `qa:api` now runs 29 focused browser/API checks.
- `WEBHOOK` can continue rendering with the website-style channel badge as long as its explicit source label remains visible.

## 2026-06-23: Add Opt-In Real Public Intake Pilot Smoke

Decision: Real seeded public-intake validation lives in a separate `qa:pilot:intake` script instead of the default mocked `qa:api` suite.

Context: The normal API smoke suite should stay deterministic and not require a running database. Before first social pilots, however, we need a confidence check that the local seeded system can receive real public Telegram, webhook, and widget requests, create leads, trigger Automation, expose the lead in Inbox and Pipeline, and support a manager follow-up.

Consequences:

- `artifacts/playwright/pilot-real-intake-api.spec.ts` skips unless the local API is healthy and seeded demo public keys exist.
- When available, the smoke creates a temporary active workflow, posts all three public intake types, verifies workflow timeline events, sends a manager follow-up, and archives the workflow.
- The default `qa:api` suite remains mock-backed at 29 checks; pilot operators should run `qa:pilot:intake` separately before live demos.

## 2026-06-23: Keep Pilot Cleanup Prefix-Scoped And Confirm-Gated

Decision: Local pilot cleanup is a Prisma utility with a dry-run default and a required `--confirm` flag for deletion.

Context: The real intake smoke and client demos create useful local records, but repeated runs can clutter the demo tenant. A broad tenant reset would be risky once real pilot context is mixed in, so cleanup must target only records created by known pilot prefixes.

Consequences:

- `db:cleanup:pilot` reports counts without deleting anything by default.
- `db:cleanup:pilot -- --confirm` deletes only demo-tenant records matching `Pilot TG`, `Pilot Webhook`, `Pilot Widget`, and `Pilot Intake Workflow` prefixes plus directly related conversation/workflow artifacts.
- Real pilot/client data should not use those prefixes unless it is intentionally disposable.

## 2026-06-23: Show Public Intake Endpoint Details In Integrations UI

Decision: Telegram and Webhook/API integration settings now display the API-provided public endpoint URL, public key, secret header name, and sample payload directly in the copied Integrations modal.

Context: First pilot setup should not require opening README or source code to find endpoint details. The API already returns `inboundEndpoint` metadata, so the frontend can expose it without inventing a new configuration contract.

Consequences:

- Operators can copy endpoint setup data from `/app/integrations` while preparing Telegram or webhook/social-landing pilots.
- The endpoint panel remains tied to backend-provided channel metadata, so future public keys or endpoint paths update automatically when the API response changes.
- `artifacts/playwright/integrations-api.spec.ts` verifies the endpoint panel renders for Telegram.

## 2026-06-23: Show Local Pilot Readiness On Integrations

Decision: `/app/integrations` now shows a compact readiness panel for Telegram, Webhook/API, and the website widget using existing integration and channel API data.

Context: Before sending first social traffic, operators need one screen that confirms which intake paths have active public keys/endpoints. A real external reachability probe still depends on production URLs or a public tunnel, so the current UI should honestly show local/API readiness without pretending to validate outside network delivery.

Consequences:

- The panel derives Telegram and Webhook/API readiness from `IntegrationAccount.inboundEndpoint`, recent webhook events, and last sync/test timestamps.
- Website widget readiness comes from the existing `/channels` response and links to the public widget config endpoint when a key exists.
- The next readiness step is a live external probe once a real public base URL is available.
- `artifacts/playwright/integrations-api.spec.ts` verifies all three pilot keys render in the readiness panel.

## 2026-06-23: Make Integrations Readiness Directly Actionable

Decision: The Integrations readiness panel now includes direct sample-intake actions for Telegram and Webhook/API plus a direct link to the local widget demo.

Context: During first-client preflight, operators should be able to verify the intake loop from the same screen that shows channel readiness. The existing card menu already had a test-inbound action, but hiding it behind each card slowed down the pilot checklist and made the readiness panel feel informational rather than operational.

Consequences:

- Telegram and Webhook/API readiness tiles call the existing `/integrations/:provider/sample-inbound` endpoint.
- The widget tile opens `/widget/demo`, keeping widget validation in the existing public widget flow.
- No new backend contract was added; the panel reuses the same API and state update path as the copied integration card menu.
- `artifacts/playwright/integrations-api.spec.ts` clicks the panel actions and verifies the expected sample-inbound providers are called.

## 2026-06-23: Keep Public URL Preflight Opt-In

Decision: Public/tunnel pilot validation lives in a separate `qa:pilot:public` script and skips unless `LEADVIRT_PUBLIC_WEB_BASE` and `LEADVIRT_PUBLIC_API_BASE` are set.

Context: Normal local QA should not depend on ngrok, Cloudflare Tunnel, staging DNS, or externally reachable URLs. Before inviting external testers, however, we need a single command that proves public web routes, public API health, widget config, and public intake endpoints are reachable through the URL the testers will actually use.

Consequences:

- `artifacts/playwright/pilot-public-url-preflight.spec.ts` validates `/`, `/demo`, `/widget/demo`, API health, widget config, Telegram webhook intake, generic webhook intake, and widget message intake.
- The spec defaults to seeded demo public keys/secrets but allows env overrides for the first real channel.
- Running it without public URL env is safe and reports skipped tests.
- Public preflight records use pilot cleanup-compatible lead name prefixes.

## 2026-06-23: Generate A Current Pilot Operator Packet

Decision: The first-client operator packet is generated by `corepack pnpm run pilot:packet` into `docs/PILOT_PACKET.md`.

Context: Pilot URLs, public keys, and active local/public bases can change between local demo, tunnel, and staging sessions. A static handoff doc would drift quickly, while a small script can read the current local API state and env vars to produce the packet just before a tester session.

Consequences:

- The packet records operator links, channel readiness, public keys, endpoint URLs, header names/values for seeded demo intake, sample payloads, QA commands, and cleanup commands.
- If public URL env vars are set, the packet prints tester-facing public links; otherwise it prints local links.
- Endpoint paths come from integration API metadata when available, while clean sample payloads stay script-owned for readable operator handoff.
- The packet should be regenerated after changing public tunnel/staging URLs or first-channel public keys.

## 2026-06-23: Include Manual Intake Smoke Commands In The Pilot Packet

Decision: `docs/PILOT_PACKET.md` now includes ready-to-run PowerShell commands for Telegram, Webhook/API, and Widget intake.

Context: During a live pilot setup call, an operator may need to create a fresh lead without opening the app UI or reconstructing request bodies from endpoint docs. The commands should use unique ids per run and stay compatible with the confirm-gated pilot cleanup utility.

Consequences:

- Manual packet smoke commands post directly to the active packet API target and return conversation/lead ids when intake succeeds.
- Generated lead names use the existing `Pilot TG`, `Pilot Webhook`, and `Pilot Widget` prefixes so `db:cleanup:pilot` can still find disposable records.
- The packet remains a handoff artifact rather than a source of new backend contracts.

## 2026-06-23: Add A Fast Read-Only Pilot Doctor

Decision: `corepack pnpm run pilot:doctor` is the first preflight command before heavier QA and public-intake checks.

Context: Operators need a quick day-of-pilot answer for whether the local app is basically ready before spending minutes on Playwright suites or inviting a tester. The check should not mutate data, create leads, or require external URLs.

Consequences:

- The doctor verifies local web routes, API health, channels, Telegram/Webhook integration endpoint metadata, widget config, and generated packet/base consistency.
- Missing public URL env is only a note because public preflight remains opt-in.
- The doctor exits non-zero on failed required local readiness checks, making it suitable for quick command-line gating.

## 2026-06-23: Add A Combined Pilot Ready Command

Decision: `corepack pnpm run pilot:ready` is the recommended day-of-pilot readiness command.

Context: The pilot workflow now has several useful checks, but asking an operator to remember packet generation, doctor, local intake, public preflight, and cleanup dry-run in the right order is error-prone. A single orchestrator gives a clear go/no-go path while still leaving individual scripts available for debugging.

Consequences:

- `pilot:ready` regenerates `docs/PILOT_PACKET.md`, runs `pilot:doctor`, runs `qa:pilot:intake`, runs `qa:pilot:public` only when public URL env vars are set, and finishes with a cleanup dry-run.
- `LEADVIRT_READY_SKIP_LOCAL_INTAKE=1` can be used for a faster dry orchestration pass that does not create new pilot leads.
- `LEADVIRT_READY_REQUIRE_PUBLIC=1` can be used to fail readiness if public URL env vars are missing.

## 2026-06-23: Persist Pilot Ready Reports

Decision: `pilot:ready` writes a shareable markdown report to `docs/PILOT_READY_REPORT.md` after each run.

Context: Terminal output is easy to lose during live setup. A persistent report gives the operator a quick artifact showing what ran, what was skipped, whether public preflight was configured, and how many disposable pilot records currently exist.

Consequences:

- The report records environment bases, command status, output tails, skip reasons, and cleanup dry-run counts.
- If readiness fails, the report is still written before exit with the stopped step and next action.
- `LEADVIRT_READY_REPORT_OUT` can redirect the report path for one-off runs.

## 2026-06-23: Use Webhook/API For Master Budet Order Intake

Decision: Master Budet connects to LeadVirt through LeadVirt's generic Webhook/API public intake, with the Master backend mirroring committed public website orders after its own order transaction and audit complete.

Context: Master Budet already owns repair-order creation through its Nest backend. The fastest safe connection is not a browser dual-submit or a new shared database, but a backend outbound event into LeadVirt so the AI administrator gets a lead/conversation while Master Budet remains the order source of truth.

Consequences:

- Master Budet public orders can appear in LeadVirt Inbox/Pipeline through the seeded `demo-generic-webhook` channel or a production Webhook/API channel.
- LeadVirt does not own Master Budet order state, assignment, pricing, or customer lookup access.
- Local side-by-side smoke needs non-conflicting ports; LeadVirt now reserves `localhost:3001`/`localhost:4001`.
- Durable retry/outbox for this external bridge is deferred until real pilot usage proves it is needed.

## 2026-06-23: Run Master Budet And LeadVirt Side By Side Locally

Decision: Superseded on 2026-06-27. Local integration testing now keeps LeadVirt on `localhost:3001`/`localhost:4001` and runs Master Budet on alternate non-conflicting ports such as `localhost:3002`/`localhost:4002`.

Context: Both products need to run at the same time to prove the AI administrator bridge. LeadVirt now has reserved local web/API ports, while Master Budet moves to alternate web/API ports and posts public website orders to LeadVirt's seeded Webhook/API endpoint.

Consequences:

- Master Budet frontend must use its own backend, for example `NEXT_PUBLIC_API_BASE_URL=http://localhost:4002`, for local side-by-side runs.
- Master Budet backend must run on an alternate API port, for example `API_PORT=4002`, with `CORS_ORIGIN=http://localhost:3002`, `LEADVIRT_AI_ADMIN_ENABLED=true`, `LEADVIRT_WEBHOOK_URL=http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events`, and the matching webhook secret.
- Live smoke order `MR-20260623-B70628` proved that a Master Budet public order can mirror into LeadVirt conversation `cmqr74dbf01oavwtwy7zwih7o`.
- Public tester validation still needs a tunnel or staging URL because local `localhost` ports are not reachable from social traffic or outside devices.

## 2026-07-02: Clean Workspaces Show Empty States Instead Of Demo Fallbacks

Decision: API-success empty data must render as an honest empty workspace, not copied design demo content.

Context: A newly created credential workspace had no leads, channels, workflows, or integrations in the database, but the Dashboard still showed copied demo leads, channel counts, auth audit rows, and a fake sidebar tariff because frontend fallbacks treated empty arrays as a reason to use design data.

Consequences:

- Dashboard recent leads, channels, activity, average response time, and sidebar billing state now use API/database data or empty states.
- Auth login/signup audit rows are not user-facing Dashboard activity.
- API-offline visual fallback should not be reused for authenticated product screens without an explicit design-preview mode.
- Remaining copied demo fallbacks on other pages should be audited under the same rule.
