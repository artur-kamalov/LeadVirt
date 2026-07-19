# LeadVirt AI Runtime Implementation Plan

Status: Phases 1-6 foundations implemented locally with CI acceptance coverage; next external gate is staging acceptance after deploy.

Architecture note (2026-07-12): this file records the existing prototype foundation. The production business-knowledge lifecycle, typed truth model, immutable publication/index snapshots, shared retrieval path, ingestion security, and rollout are superseded by `docs/BUSINESS_KNOWLEDGE_SYSTEM_DESIGN.md`. Where the documents differ, the newer system design is authoritative; completed prototype phases do not imply production Knowledge readiness.

Phase 0 compatibility status (2026-07-12): live replies, diagnostics, and evals now share the minimal immutable legacy publication retriever; normal source/onboarding writes publish automatically; irrelevant or unavailable retrieval fails closed; and reply/tool/channel execution uses durable outbox/inbox, idempotency ledgers, deadlines, cancellation, and generation/sequence delivery fences. Knowledge v2 typed truth, operator reconciliation, real Qdrant CI validation, secure ingestion, and the customer Knowledge workspace remain governed by the newer design.

## Goal

Validate the main LeadVirt scenario end to end:

1. A new user creates an account.
2. The user describes the business in detail.
3. LeadVirt stores business knowledge for RAG: profile, catalog, prices, free time slots, policies, FAQ, escalation rules.
4. A real lead writes through a public channel.
5. The AI answers from tenant knowledge, creates or updates CRM records, and records trace, quality, and cost data.

## Core Decisions

- Use LangGraph for production agent orchestration.
- Use AutoGen only for simulations, agent-lab experiments, and regression test generation.
- Use Qdrant as the vector store for multi-tenant RAG.
- Start with dense retrieval plus tenant filters, then add hybrid retrieval and rerank.
- Use RAGAS plus custom business evals for LLMOps.
- Use OpenTelemetry, Prometheus, and Grafana for AI observability.
- Keep Redis/BullMQ for the first async worker queue; add Temporal only if workflow durability becomes a real bottleneck.

## Runtime Architecture

```text
Public channel
  -> API intake endpoint
  -> DB lead/conversation/message
  -> AI job queue
  -> AI worker
  -> LangGraph pipeline
  -> RAG retrieval from Qdrant
  -> guarded LLM/tool calls
  -> CRM/calendar/workflow updates
  -> response delivery
  -> traces, metrics, eval samples, audit log
```

## Data Model Areas

- Business profile: name, description, niche, tone, working rules, forbidden claims.
- Catalog: services, prices, durations, requirements, categories.
- Availability: working hours, free windows, booking constraints.
- Knowledge documents: FAQ, policies, scripts, objections, examples.
- RAG chunks: tenant id, source id, version, type, visibility, PII level, embedding metadata.
- AI events: graph run id, node name, input hash, output, tool calls, latency, token usage, cost.
- Quality records: golden-set case id, expected behavior, actual output, score, pass/fail reason.

## LangGraph Pipeline

Initial production graph:

1. `normalize_message`
2. `load_tenant_context`
3. `pii_classify`
4. `intent_classify`
5. `retrieve_context`
6. `rerank_context`
7. `policy_guard`
8. `draft_response`
9. `decide_tool_calls`
10. `execute_tools`
11. `quality_gate`
12. `send_or_escalate`
13. `persist_audit`

Required graph state:

- tenant id
- channel id
- conversation id
- lead id
- user message
- normalized intent
- retrieved context ids
- draft answer
- planned tool calls
- executed tool calls
- quality result
- final action
- cost and token counters

## RAG Plan

Phase 1:

- Qdrant collection per environment, tenant isolation through payload filters.
- Dense embeddings for all tenant knowledge chunks.
- Strict `tenant_id` filter on every retrieval query.
- Source citations stored internally for audit and debugging.

Phase 2:

- Hybrid retrieval: dense plus sparse.
- Rerank top candidates before response generation.
- Separate indexes or payload filters by knowledge type: catalog, availability, FAQ, policy.

Phase 3:

- Retrieval eval by niche.
- Drift checks after knowledge updates.
- Automatic reindex jobs with versioned chunks.

## Quality Gates

The AI must not send a final answer if:

- tenant context is missing;
- retrieval is empty for catalog, price, policy, or availability questions;
- the answer is not grounded in retrieved or structured tenant data;
- the model tries to book, cancel, refund, discount, or promise availability without a validated tool call;
- PII from another tenant appears anywhere in context or output;
- estimated confidence is below the configured threshold;
- cost or token budget is exceeded.

Fallback actions:

- ask a clarifying question;
- create a human handoff task;
- send a safe short reply that the manager will follow up.

## LLMOps

Golden sets:

- booking request;
- price question;
- service comparison;
- unclear message;
- objection handling;
- cancellation or reschedule;
- unavailable slot;
- out-of-policy request;
- competitor or legal/medical/financial sensitive request.

Metrics:

- groundedness;
- answer relevance;
- context precision;
- context recall;
- booking success;
- hallucination rate;
- escalation correctness;
- tool-call accuracy;
- cost per resolved lead;
- p95 graph latency.

CI quality gate:

- fast smoke on every PR;
- niche golden-set subset before deploy;
- full eval manually or nightly.

## Reliability

- Idempotency key: channel id plus external message id.
- Retry policy per graph node with bounded backoff.
- Timeout per graph node and per full graph run.
- DLQ for failed AI jobs.
- Audit log for every tool call and final response.
- No direct tool mutation without schema validation and tenant authorization.

## Observability

OpenTelemetry traces:

- intake request;
- queue publish;
- worker job;
- graph run;
- each graph node;
- retrieval;
- LLM call;
- tool call;
- final delivery.

Prometheus metrics:

- `ai_graph_runs_total`
- `ai_graph_run_duration_seconds`
- `ai_node_duration_seconds`
- `ai_llm_tokens_total`
- `ai_llm_cost_total`
- `ai_retrieval_empty_total`
- `ai_quality_gate_fail_total`
- `ai_jobs_dlq_total`
- `ai_tool_call_fail_total`

Grafana dashboards:

- AI health;
- cost control;
- quality gates;
- RAG retrieval quality;
- worker reliability;
- tenant usage.

## Security

- Tenant filter is mandatory on every DB and vector query.
- RBAC roles: owner, admin, operator, viewer.
- ABAC checks for tenant-scoped resources and channel ownership.
- PII tagging before logging or tracing.
- Redact PII and secrets from logs, traces, prompts, and eval artifacts.
- Prompt/tool schemas validated before execution.
- Human handoff for sensitive or low-confidence operations.

## Cost Control

- Per-tenant daily and monthly token budgets.
- Per-run maximum graph steps.
- Per-node maximum retries.
- Model routing by task: small model for classification, stronger model for final answer and eval.
- Cache stable business context and retrieval results where safe.
- Alert when tenant cost or retrieval failure rate spikes.

## Implementation Phases

### Phase 1: Knowledge Onboarding

Status: implemented.

- Extend onboarding to collect business profile, services, prices, availability, FAQ, and policies.
- Persist structured business data in Postgres.
- Add first tenant knowledge-source API.
- Add clean-user smoke for a fully filled business profile.

### Phase 2: Qdrant RAG

Status: foundation implemented.

- Add Qdrant to local and deploy compose.
- Add knowledge chunking and embedding/reindex API.
- Add tenant-filtered retrieval service.
- Add RAG smoke tests for catalog, price, and availability questions.
- Current embedding provider is a deterministic local hash vector for plumbing and isolation tests; semantic embeddings and rerank remain follow-up work before production-quality answers.

### Phase 3: LangGraph Worker

Status: foundation implemented.

- Add AI worker graph runtime. Initial queued `ai.reply` path now runs through LangGraph.js.
- Replace direct sync AI reply paths with queued graph runs where appropriate. Public Widget, Webhook/API, and Telegram intake now publish `ai.reply` jobs in queue mode.
- Deliver queued public-channel AI replies through `channels.sendMessage`. Implemented for Webhook/API and Telegram with tenant/channel checks, adapter send, message status transitions, and audit logging.
- Add tool schemas for lead update, note creation, status change, and booking proposal. Implemented as tenant-scoped zod-validated worker tools.
- Add idempotency, retries, timeouts, and DLQ. Implemented for queued worker jobs with `WORKER_JOB_TIMEOUT_MS`, final-attempt DLQ audit logging, and `worker:dlq:inspect`.
- Add full public-loop smoke. Implemented as `qa:ai:public-loop` for clean tenant session, onboarding knowledge, RAG reindex/search, public Webhook/API intake, queued LangGraph reply, channel delivery, booking draft, inbox, dashboard, and queue completion checks.
- Channel connection is now inbound-only by default. Automatic replies require an explicit owner/admin activation bound to the exact active structured publication and current channel fingerprint.
- Queue admission, retries, and final AI delivery revalidate that binding under ordered database locks. Revocation or drift fails closed without blocking inbound Inbox persistence or manual agent delivery.

### Phase 4: Quality And Evals

Status: foundation started.

- Add golden sets for the first pilot niches. Initial core golden set is implemented in `artifacts/evals/ai-golden-set.json` and now covers beauty, auto detailing, education/course booking, and clinic handoff cases.
- Add RAGAS evaluation where it fits retrieval quality. Initial RAGAS-style metrics now include required-term recall and retrieved-chunk precision in eval reports.
- Rebuild the legacy custom business eval for booking correctness, escalation, and policy safety on Structured V2 publication, admission, retrieval, and outbox contracts. The former legacy fixture is retained only as migration input; optional real-provider judge runs remain available through `qa:ai:real-eval`.
- Keep a required deterministic CI gate. `qa:ai:quality` now composes the current reply-reliability and Structured V2 reply suites; structured golden-set reports will return after the fixture migration is complete.
- Knowledge v2 Test runs now use structured server-validated grounded generation with exact citations, tenant processor consent, one repair maximum, commit-time evidence revalidation, and PostgreSQL acceptance coverage.
- Live `STRUCTURED_V2` replies now use that same orchestrator and gate, persist validated trace hashes/citations, default-deny state-changing tools, and revalidate evidence plus processor admission before commit and delivery.
- PostgreSQL smoke coverage uses the production trace persister and verifies the stored publication/evidence citation plus message, audit, provider-policy, answer, and gate hash identities.
- Knowledge dependency health covers PostgreSQL, Redis, Qdrant, object storage, configured model endpoints, and the OpenTelemetry Collector with fixed labels, cached single-flight probes, bounded deadlines, and no tenant or content dimensions.
- Prometheus scrapes Collector internal metrics so Grafana and alerts expose unavailable or stale dependencies plus trace exporter failures and drops.

### Phase 5: Observability And Cost

- Status: started.
- Export metrics for Prometheus. Initial foundation is implemented with API `/metrics`, worker `/metrics`, API request counters/latency, worker job/DLQ counters, AI graph duration/status, and channel delivery outcomes.
- Add per-tenant AI cost tracking and budget enforcement. Initial token budget guard is implemented with daily/monthly tenant limits, pre-call blocking, and `BUDGET_BLOCKED` usage logs.
- Add Grafana dashboard definitions. Initial optional observability profile is implemented with Prometheus local/staging scrape configs and a provisioned `LeadVirt AI Runtime` dashboard.
- Add OpenTelemetry spans to API, worker, retrieval, LLM, and tool calls. Initial opt-in OTLP tracing is implemented for API requests, queue publishing, worker jobs, LangGraph graph/nodes, provider stages, tool execution, persistence, and channel delivery.
- Add a trace backend profile. Initial Tempo service and Grafana trace datasource are available through the optional `observability` profile.
- Add cost/quality dashboard panels on top of usage logs and metrics. Initial panels are implemented for quality-gate outcomes, budget blocks, and blocked-token volume.
- Live Knowledge v2 worker metrics now cover retrieval latency/yield/outcomes and grounded-answer gate risk/citation coverage with fixed labels and strict locale buckets; the Knowledge dashboard exposes these without tenant or content dimensions.
- Publication telemetry now measures durable activation outcomes/duration and p95 time from candidate, publication, and immutable item creation to active queryability; replayed and reconciled events do not double count.
- Dependency observability now uses nonblocking cached probes for PostgreSQL, Redis, Qdrant, object storage, configured embedding/reranker/grounded-model endpoints, and the Collector. The optional profile routes OTLP through the Collector, scrapes its internal metrics, and provisions Knowledge availability, freshness, exporter-failure panels, and alerts.

### Phase 6: Security Hardening

Status: core security hardening and local clean-user acceptance smoke are implemented; staging/production-like acceptance remains.

- DB fallback cross-tenant RAG isolation smoke is implemented as `qa:ai:isolation`.
- Qdrant cross-tenant RAG isolation smoke is implemented as `qa:ai:qdrant-isolation` with a temporary collection.
- Initial PII/secret redaction is implemented for runtime logs, OpenTelemetry error payloads, and AI graph tool-call metadata.
- PII tagging and broader prompt/eval artifact redaction are implemented via `redactAndTagSensitiveData`, sanitized quality/real-provider eval reports, sanitized real-provider judge payloads, and `qa:ai:eval-redaction`.
- Initial RBAC guard is implemented for knowledge source writes/reindex as `qa:rbac:knowledge`.
- The shared PostgreSQL tenant transaction boundary is implemented and proved against real pool reuse, rollback, concurrency, misuse, and runtime-role posture. RLS remains disabled until every tenant-bearing API/worker DB phase is migrated and deployment uses a non-owner `NOBYPASSRLS` role.
- Initial channel action RBAC is implemented as `qa:rbac:channels`.
- Initial AI tool ABAC is implemented as `qa:ai:tool-abac`, covering tenant conversation ownership, lead-conversation consistency, and same-tenant task assignees.
- Billing, integrations, and workflows RBAC matrix is implemented as `qa:rbac:product-matrix`.
- Audit UI read access is restricted to OWNER, ADMIN, and MANAGER through `/api/ai-audit`.
- Initial audit UI for AI decisions and tool calls is implemented as `/app/audit` backed by `/api/ai-audit` and `qa:ai:audit`.
- Visual/API and forbidden-role smoke coverage for `/app/audit` is implemented as `qa:ai:audit-ui`.

## First End-To-End Acceptance Test

Given a clean email-OTP user:

1. User completes business onboarding for a sample salon.
2. User adds services, prices, available windows, FAQ, and policies.
3. A public widget or webhook message asks for price and a booking slot.
4. AI retrieves only that tenant's knowledge.
5. AI answers with grounded price and available slot.
6. AI creates or updates lead, conversation, and activity records.
7. Trace, metrics, quality result, and cost are stored.
8. Dashboard, inbox, lead detail, and activity timeline show only real tenant data.

Local coverage: implemented as `qa:ai:acceptance`. The smoke signs in through mock email OTP, fills onboarding knowledge, creates a Webhook/API channel, sends public intake, waits for queued LangGraph processing and channel delivery, verifies grounded price/slot output, RAG refs, tool calls, usage/cost, AI audit, worker metrics, dashboard, inbox, lead detail, and activity timeline.

## Non-Goals For The First Build

- AutoGen in production runtime.
- Multiple vector databases.
- Full visual eval dashboard.
- Fully automated scheduling against third-party calendars.
- Complex enterprise ABAC beyond tenant and role checks.
