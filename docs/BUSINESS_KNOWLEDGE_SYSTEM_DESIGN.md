# LeadVirt Business Knowledge System Design

Status: proposed implementation contract<br>
Date: 2026-07-12<br>
Scope: product UX, frontend, API, data model, ingestion, retrieval, AI runtime, evaluation, reliability, security, observability, and rollout<br>
Out of scope: application code in this design task

Implementation status (2026-07-15): the first structured Knowledge slice now includes immutable publications, capability snapshots, generation-bound operational authorization, shared autonomy enforcement through `PROPOSE_ACTION`, queue-only AI replies, immutable reply outcomes, and fail-closed delivery/human-takeover fencing. Provider-backed operational adapters, higher-autonomy confirmation proof, production-scale benchmarks, and the remaining rollout phases stay tracked in `docs/CHECKLIST.md`.

## 1. Executive Decision

LeadVirt should present one simple product concept to customers: **Knowledge**. A business can connect its website, answer guided questions, upload files, connect systems, or enter information manually. LeadVirt prepares a draft, asks only questions that materially affect customer answers, lets the business test realistic conversations, and then publishes an immutable knowledge snapshot used by the AI.

Internally, the system must not treat all business information as text in a vector database. It must separate five truth planes:

1. **Verified structured facts**: identity, locations, opening hours, contacts, products, services, prices, currencies, durations, eligibility, and booking constraints.
2. **Versioned documents**: website pages, help articles, PDFs, manuals, FAQs, spreadsheets, and other unstructured source material.
3. **Behavioral guidance**: explicit conditional instructions, prohibitions, escalation rules, offer rules, and channel-specific tone or workflow constraints.
4. **Live operational data**: calendar availability, inventory, order status, customer state, and other values fetched through authorized tools at answer time.
5. **Conversation context**: customer messages, summaries, and extracted lead fields. This is context, never canonical business truth.

PostgreSQL is the authoritative system of record. Object storage keeps immutable source artifacts. Qdrant is a private, rebuildable retrieval index. Redis and BullMQ carry asynchronous work but are not authoritative job history. Every answer must be reproducible against an immutable publication snapshot during the configured audit-retention period. Lawful erasure and retention expiry take precedence; afterward the system retains only permitted hashes, manifest metadata, and deletion evidence.

The production hot path should keep LangGraph for explicit response orchestration. Deterministic acquisition, parsing, embedding, indexing, deletion, and reconciliation should be ordinary idempotent worker jobs. LangGraph is valuable for adaptive onboarding, review, human approval, and response decisions. AutoGen is not needed in the production path; it can be used offline for adversarial simulations or evaluator experiments. Qdrant is the production vector store. FAISS is limited to local research and offline benchmarks.

## 2. Product Outcome

The system succeeds when a non-technical business owner can:

- reach a safe first published version in under ten minutes for a small business;
- understand what the AI knows without seeing RAG, embeddings, chunks, or vector terminology;
- see where every extracted fact came from;
- correct one wrong answer by correcting its source, fact, or rule;
- know whether an edit is saved, processing, ready, published, stale, or blocked;
- test customer questions before the change reaches live channels;
- rely on LeadVirt to abstain or hand off when information is missing, conflicting, expired, or unauthorized;
- maintain information after onboarding without reopening the onboarding wizard.

The technical system succeeds when:

- no cross-tenant, cross-audience, cross-location, or cross-permission retrieval is possible;
- a response uses one atomic publication snapshot from retrieval through audit;
- a source edit cannot expose half-indexed or mixed-version content;
- retries cannot resurrect deleted content or duplicate externally visible side effects;
- a failed new publication leaves the previous publication live;
- all cited evidence remains reproducible after later edits for the configured audit-retention period;
- structured and live data override probabilistic document retrieval where appropriate;
- quality and security regressions block publication or deployment using explicit gates.

## 3. Non-Goals

- Do not build a general-purpose document management system.
- Do not let businesses design arbitrary autonomous agents in the first release.
- Do not infer and auto-publish prices, legal terms, medical claims, availability, or destructive actions.
- Do not use conversation history as an automatically trusted knowledge source.
- Do not make a vector similarity score visible as a misleading customer-facing confidence percentage.
- Do not require one vector collection per normal tenant.
- Do not introduce AutoGen as a second production orchestration framework.
- Do not make Qdrant, Redis, BullMQ, LangGraph checkpoints, or model-provider storage authoritative.

## 4. Hard Invariants

The following are release-blocking invariants:

1. `workspace_id` is derived from authenticated membership and revalidated by every worker. It is never trusted from a browser body, model output, or unsigned queue payload.
2. Authorization is applied before retrieval and again before tool execution. A model never grants access.
3. Only items included in the captured active `knowledge_publication_id` are answerable.
4. Every published item is immutable while retained. A change creates a new revision; lawful erasure creates an auditable redaction/deletion record rather than rewriting history silently.
5. Publication is an atomic pointer switch. Indexing failure cannot partially replace live knowledge.
6. Live operational values are obtained from tools and are not embedded as authoritative facts.
7. Retrieved content is untrusted evidence, not executable instruction.
8. High-risk facts require verified provenance, explicit authority, freshness, and stronger answer gates.
9. Deletion and permission revocation deny access immediately even if physical vector cleanup is delayed.
10. Queue delivery is at-least-once. Database constraints, inbox records, idempotency keys, and fencing tokens provide correctness.
11. Prompt, document, and customer content are excluded from telemetry by default.
12. English is the product default, but knowledge, retrieval, tests, and answer policy are locale-aware.

## 5. Current-State Audit

LeadVirt has a useful prototype foundation, but the current path cannot guarantee that onboarding knowledge reaches the AI.

### 5.1 Current flow

1. The onboarding company step collects the required company name and short description and captures timezone silently. Hours, catalog, availability, FAQ, policies, and escalation remain optional enrichment in the canonical Business Information workspace; legacy onboarding detail values are preserved.
2. On step navigation, the browser persists onboarding JSON and the API upserts six `BusinessKnowledgeSource` records.
3. The upsert does not create chunks or enqueue indexing.
4. Chunks exist only after the manual `POST /knowledge/sources/reindex` route is called. No production frontend or backend flow calls it.
5. The reply worker does not use the API search path or Qdrant. It reads the newest 40 SQL chunks, applies exact token overlap, and returns up to four arbitrary chunks when nothing matches.
6. The onboarding launch screen reports readiness without proving persistence, indexing, connected channels, or response quality.

### 5.2 Critical correctness gaps

| Gap                       | Present behavior                                                                             | Consequence                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Two retrieval paths       | API search can use Qdrant; LangGraph replies use SQL lexical overlap                         | Qdrant readiness does not mean live replies use Qdrant              |
| No automatic indexing     | Create, update, onboarding, archive, and restore do not enqueue indexing                     | Normal users can publish data that the AI never sees                |
| False grounding           | No lexical match returns arbitrary chunks                                                    | Unrelated content prevents the missing-grounding fallback           |
| Mutable source history    | Source content is overwritten and integer version is incremented                             | Old answers cannot be reproduced or audited                         |
| Destructive reindex       | SQL chunks are deleted before replacements are ready                                         | Availability gap, races, and unrecoverable references               |
| Stale Qdrant points       | Old version point IDs are never removed                                                      | Archived or edited content can remain searchable                    |
| Weak data model           | Business facts and policies live in free text or arbitrary JSON                              | No validation of money, units, timezones, scope, or effective dates |
| Silent failure            | Onboarding save errors and Qdrant search failures are swallowed                              | UI can show success while data is missing or degraded               |
| No knowledge workspace    | No production page exists after onboarding                                                   | Customers cannot maintain, review, test, or diagnose knowledge      |
| Inconsistent AI paths     | Inbox drafts and synchronous intake fallbacks bypass LangGraph/RAG                           | Answer safety depends on which entry path executed                  |
| Retry side effects        | Tools run before final message persistence; timeout does not cancel the graph                | A retry can duplicate booking/task/event effects                    |
| Partial onboarding writes | Onboarding, tenant, sources, and audit are separate mutations; nested JSON is shallow-merged | A failed transition can leave competing partial truths              |
| Incomplete authorization  | Onboarding/account mutations can rewrite AI identity without the knowledge write-role policy | Lower roles can change live business context indirectly             |
| Unreliable usage baseline | Stored latency/cost/token data is hard-coded or partial                                      | Historical rows cannot validate a new runtime canary                |

### 5.3 Useful foundations to preserve

- TypeScript pnpm monorepo, Next.js product UI, NestJS modules, Prisma, and PostgreSQL.
- Tenant-bearing API `RequestContext` and existing role guards.
- BullMQ/Redis asynchronous boundary and separate channel delivery queue.
- Current LangGraph node instrumentation and typed tool schemas.
- Qdrant deployment, tenant-filter isolation test, and configurable provider gateway.
- AI audit, OpenTelemetry, Prometheus, Grafana, and Tempo foundations.
- Six product locales with English as default.
- Existing onboarding and knowledge routes during a compatibility migration.

## 6. Information Ownership Model

### 6.1 Truth-plane routing

| Question type           | Authoritative plane  | Example                         | Failure behavior                                                  |
| ----------------------- | -------------------- | ------------------------------- | ----------------------------------------------------------------- |
| Business identity       | Structured fact      | legal/display name, contact     | Use verified fact; otherwise ask or hand off                      |
| Price or duration       | Structured fact      | `EUR 45`, `60 minutes`          | Never estimate from prose when verified fact is absent/conflicted |
| General explanation     | Document             | service description, procedure  | Retrieve, cite, and answer only supported claims                  |
| Business behavior       | Guidance rule        | never promise same-day delivery | Apply deterministically before drafting and validate afterward    |
| Current availability    | Live tool            | open appointment slots          | Call calendar; do not trust embedded schedule text                |
| Customer-specific state | Live tool            | order status, account tier      | Require customer authorization and tool scope                     |
| Current conversation    | Conversation context | desired date, budget            | Use for this conversation only                                    |

### 6.2 Authority and conflict policy

Authority is scoped per field or entity, not assigned only to a whole source. Default precedence:

1. Authorized live system for operational state.
2. Explicit owner/admin verified structured fact.
3. Approved connector record from the designated system of record.
4. Approved manual document or rule.
5. Synchronized website/help-center content.
6. AI-extracted suggestion.
7. Conversation-derived suggestion.

The tenant can choose a designated system of record for a domain, such as catalog, calendar, or policies. Synced content is read-only in LeadVirt unless the user explicitly creates a local override. Overrides show their precedence, owner, reason, and expiry. A connector update never silently overwrites a verified local override.

Conflict rules:

- Equivalent normalized values are deduplicated while retaining all provenance.
- Different values with disjoint scopes are not conflicts. For example, different location hours are valid.
- Different values with overlapping scope and effective time create a `KnowledgeConflict`.
- High-risk conflicts block publication of the affected scenario.
- Lower-risk conflicts publish only when an authorized reviewer accepts an explicit winner.
- Retrieval never asks the model to choose silently between conflicting high-risk facts.

### 6.3 Risk levels

| Level       | Information                                                                | Publication                                                   | Runtime                                                        |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Low         | descriptions, amenities, general FAQ                                       | May auto-publish from trusted synchronized source after gates | Normal citation/support gate                                   |
| Medium      | hours, service duration, eligibility                                       | Review on conflict or weak extraction                         | Freshness and scope required                                   |
| High        | prices, discounts, refunds, cancellation, guarantees, legal/medical claims | Verified reviewer required                                    | Exact evidence, no unsupported inference, handoff on ambiguity |
| Operational | availability, inventory, order/customer state                              | Not published as static truth                                 | Authorized live tool required                                  |
| Prohibited  | credentials, secrets, unnecessary customer PII                             | Quarantine/block                                              | Never retrieve or send to model                                |

### 6.4 Capability-driven requirements

Knowledge readiness is computed per enabled AI capability, not as one global percentage. Each `KnowledgeCapability` has deterministic requirements with type, risk, required scope, freshness, locale coverage, and blocker/warning severity. Disabling a capability removes its requirements and prevents the AI from attempting it.

| Capability              | Required knowledge                                                               | Required live system                    | Safe missing behavior                                    |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| General FAQ             | identity, contact, relevant approved documents, escalation route                 | None                                    | Answer supported questions; hand off unsupported ones    |
| Lead qualification      | qualification fields, disqualifiers, consent text, routing rules                 | CRM optional                            | Ask only approved fields; never invent eligibility       |
| Pricing                 | structured catalog price, currency, unit/tax conditions, discount/quote policy   | Quote/catalog tool when dynamic         | Do not estimate; collect request or hand off             |
| Appointment discovery   | service, duration, location/staff constraints, hours, booking/cancellation rules | Calendar availability lookup            | Explain service but do not promise a slot                |
| Appointment booking     | all discovery requirements plus confirmation/identity rules                      | Calendar create/update with idempotency | Produce proposal, require confirmation, recheck slot     |
| Order/account support   | support policy, identity-verification and escalation rules                       | Authorized order/account lookup         | Do not disclose or infer customer state                  |
| Commerce recommendation | product attributes, compatibility, price/shipping/return policy                  | Inventory/cart tools when dynamic       | Recommend only supported attributes; avoid stock promise |
| Regulated topic         | approved wording, prohibited claims, disclaimers, mandatory escalation           | Approved specialist workflow            | Refuse restricted advice and hand off                    |

Requirement evaluation is a materialized projection over the exact publication candidate. A model may suggest missing questions, but it does not decide that a blocker passed. Tenant templates provide defaults by business type; the business can add stricter requirements, not weaken platform security requirements.

## 7. Client Experience

The UI calls this area **Knowledge**. Technical terms such as vector, chunk, embedding, RAG, reranker, and pipeline are absent from customer-facing copy.

### 7.1 First-run journey

The default journey should minimize questions while preserving explicit approval:

1. **Start**: ask for website URL or let the user choose "No website".
2. **Discover**: show discovered pages and let the user exclude account, legal, duplicate, or irrelevant sections before import.
3. **Build draft**: process sources in the background and show concrete states: discovering, importing, needs review, ready, failed.
4. **Review essentials**: present a compact business profile generated from evidence. Ask only missing or conflicting high-impact questions.
5. **Connect live systems**: propose calendar, CRM, catalog, or commerce connectors only when the selected AI scenario needs them.
6. **Set behavior**: choose customer-facing boundaries, escalation recipient, prohibited promises, and actions requiring approval.
7. **Test**: generate realistic questions from the selected business type plus required safety scenarios. Show answer and supporting sources.
8. **Publish**: explain blockers, warnings, and scenario coverage. Publish an immutable snapshot only after required gates pass.
9. **Activate channels**: channel readiness is separate from knowledge readiness. Both must pass before automatic replies are enabled.

Implementation status (2026-07-14): Website, Telegram, and Webhook/API now require explicit activation bound to the exact active structured publication and current channel configuration. Any binding drift revokes automatic execution while inbound Inbox traffic remains available.

Users without a website can select a business template, complete a short adaptive interview, upload a menu/catalog, or start manually.

### 7.2 Adaptive interview

The interview should be driven by scenario requirements, existing evidence, and risk, not a fixed long form.

Example for an appointment business:

- Required: business identity, timezone, location or service area, offered services, duration, price/currency, opening hours, booking constraints, cancellation policy, escalation contact.
- Optional: parking, preparation instructions, staff bios, promotions.
- Live-system prompt: connect the calendar if the AI may offer or book real slots.

Each answer is saved immediately as a draft. The UI shows `Saved`, `Saving`, `Offline`, or `Could not save`, and never advances as if a failed write succeeded. The interview can be resumed across devices. AI suggestions show evidence and remain drafts until the applicable approval rule is satisfied.

### 7.3 Knowledge workspace

Add `/app/knowledge` to primary product navigation with these views:

| View     | Purpose                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------- |
| Overview | Readiness by scenario, recent changes, conflicts, stale sources, failed imports, test failures |
| Business | Structured profile, locations, contacts, hours, services/products, prices, languages           |
| Sources  | Websites, files, connectors, manual documents, sync state, scope, freshness, errors            |
| Guidance | Rules, prohibited claims, escalation, approval requirements, tone and channel behavior         |
| Review   | Extracted suggestions, conflicts, low-quality parsing, sensitive-content quarantine            |
| Test     | Customer-question playground with locale/channel/audience simulation and evidence              |
| History  | Publications, diffs, approver, quality result, rollback, audit trail                           |

The Overview does not show one opaque confidence score. It shows scenario-weighted readiness:

- `Ready`: all required facts, policies, tools, retrieval tests, and security gates pass.
- `Ready with warnings`: safe to answer, but optional coverage or freshness needs attention.
- `Needs review`: unresolved high-impact extraction or conflict.
- `Blocked`: missing required fact/tool, failed security gate, stale operational connector, or failed publication.
- `Updating`: a new draft is processing while the previous published snapshot remains active.

### 7.4 Add-source flows

The primary `Add` menu offers:

- Website
- File or spreadsheet
- Guided questions
- Connector
- Manual answer or article

#### Website

1. Enter an HTTPS URL.
2. Verify domain and perform safe discovery.
3. Preview included/excluded paths, robots policy, page count, language, and estimated processing time.
4. Allow path filters and customer-visible/internal audience selection.
5. Import as a draft.
6. Show each page, last source update, last successful sync, and coverage errors.

#### File and spreadsheet

1. Select supported files and show size/type limits before upload.
2. Upload directly to object storage through a short-lived signed URL.
3. Show scan, parse, OCR, table, and language status.
4. Preview extracted headings/tables and flag unreadable pages.
5. For catalogs, map columns to service/product, price, currency, duration, location, and validity.
6. Require confirmation before extracted high-risk facts become publishable.

#### Connector

1. Explain the exact data and permissions requested.
2. Complete OAuth or secret entry in a secure flow.
3. Let the user choose folders, sites, catalogs, locations, or calendars.
4. Test access before saving.
5. Show permission changes, revocation, source deletion, sync cursor, and next sync.

#### Manual content

Use purpose-built editors rather than one textarea:

- FAQ editor: question variants, canonical answer, locale, audience, effective dates.
- Service/product editor: name, description, price, currency, unit, duration, location, availability source.
- Hours editor: timezone, weekly schedule, breaks, exceptions, holidays.
- Policy editor: policy type, conditions, answer text, effective dates, escalation requirement.
- Guidance editor: `when`, `then`, priority, channel/audience, approval need, test cases.

### 7.5 Source list and detail UX

Each source row includes:

- name and source type;
- `Connecting`, `Discovering`, `Importing`, `Needs review`, `Ready`, `Failed`, `Paused`, or `Disconnected`;
- draft versus published status;
- number of included documents/items;
- last successful sync, source modification age, next sync, and stale state;
- audience, locale, location, brand, and channel scope;
- plain-language error with retry/remediation action;
- owner and source-of-truth indicator.

The detail view contains Overview, Content, Activity, Permissions, and Settings tabs. Synchronized text is not directly editable. The user can edit upstream, exclude it, or create a visible local override that breaks inheritance for that fact.

### 7.6 Review and correction

Review is exception-based. The system groups work into:

- missing required information;
- conflicting values;
- inferred high-risk facts;
- unreadable/low-confidence pages or tables;
- suspected PII, secrets, or prompt injection;
- stale or inaccessible sources;
- failing customer-question tests.

Every candidate displays value, scope, effective dates, source evidence, extraction method, and proposed action. Bulk approval is limited to low-risk items from the same trusted source and schema. High-risk items require individual or logically grouped confirmation.

For a poor answer in Test or Inbox, the action menu offers:

- Correct the source
- Add the missing answer
- Change guidance
- Mark this question unanswerable
- Require human handoff

The UI opens the exact fact, rule, or evidence used. Feedback does not directly retrain or publish content.

### 7.7 Test playground

The test surface must let an authorized user choose:

- locale;
- channel;
- business location or brand;
- public, customer, or internal audience;
- customer segment where applicable;
- current published snapshot or draft candidate.

For each response show:

- final answer or handoff behavior;
- supporting facts/documents with precise page/heading/URL anchors;
- live tools called and freshness timestamps;
- rules applied;
- conflicts, missing support, or suppressed content;
- whether the result would be sent automatically, held for approval, or handed off.

Do not expose internal document titles or URLs in actual customer replies unless the source is explicitly public. Internal evidence remains available only in the authenticated operator UI.

### 7.8 Failure and accessibility behavior

- Background work survives navigation and browser closure.
- All destructive actions explain effects on published answers and require confirmation.
- A failed draft never disables the prior working publication.
- Offline edits are not reported as saved. Conflicts are resolved using server revision/ETag, not last-write-wins.
- Progress is semantic and persistent; animated progress never implies a stage completed without a server event.
- All flows are keyboard accessible, screen-reader labeled, and usable without color-only state.
- Long titles, URLs, errors, and translated labels wrap or truncate with an accessible full value.
- Status polling backs off and resumes from visibility/focus; prefer server-sent events for active jobs.

## 8. Frontend Architecture

Keep production UI in `apps/web/src/design` and add a typed knowledge feature boundary rather than embedding network calls throughout pages.

### 8.1 Suggested module shape

```text
apps/web/src/
  design/product/knowledge/
    KnowledgeLayout.tsx
    KnowledgeOverview.tsx
    BusinessFactsEditor.tsx
    SourceList.tsx
    SourceDetail.tsx
    GuidanceEditor.tsx
    ReviewQueue.tsx
    KnowledgeTestPlayground.tsx
    PublicationHistory.tsx
    components/
  lib/api/knowledge/
    client.ts
    contracts.ts
    queries.ts
    mutations.ts
    events.ts
```

### 8.2 Frontend rules

- Use server responses as truth; never derive `Ready` from local form completion.
- Use typed API contracts shared through `@leadvirt/types`.
- Cache keys always include tenant session and publication/draft identity.
- Use optimistic UI only for reversible metadata edits. Facts, publication, connection, and deletion wait for server acknowledgement.
- Autosave draft fields after a short idle period and on blur. Show save state beside the edited group.
- Send `If-Match` with the server ETag/version for mutations. On `412`, show a focused merge/conflict dialog.
- Large files use signed direct upload. File bytes do not pass through the Next server.
- Credentials and signed upload tokens are never persisted in local storage or analytics.
- Use SSE for job state and publication events with `Last-Event-ID`; fall back to bounded polling.
- Keep editor drafts in server storage. Browser state may cache nonsensitive unsaved text but must be encrypted/avoided for internal sensitive content.
- URL and query state controls filters/tabs, while source content and permission data stay server-side.
- Add route-level error, loading, empty, and permission-denied states.
- Feature flags control source types and draft retrieval, but security policy remains server-enforced.

### 8.3 Backward-compatible onboarding migration

1. Keep the current onboarding route and payload through an explicit legacy adapter. New source semantics use versioned `/knowledge/v2/...` routes or a separately named contract until old clients are removed; the existing create route cannot silently change from immediately active content to asynchronous source setup.
2. Convert each saved onboarding field into typed draft facts or rules through the adapter. The legacy write, new draft revision, and outbox event commit in one PostgreSQL transaction.
3. Create one `legacy_snapshot` revision from the current observable value with migration provenance. The existing integer counter does not contain recoverable history and must not be expanded into fake revisions.
4. Reconcile disagreements among `OnboardingState`, `Tenant`, settings, legacy sources, and existing chunks before a migration candidate can publish.
5. Stop marking onboarding complete on a swallowed API error.
6. Enqueue ingestion/publication readiness after each meaningful save.
7. Replace the large company textarea step progressively with structured editors and the adaptive interview.
8. Route completed users to `/app/knowledge?welcome=1` for review/test/publish.
9. Keep old sources available for compatibility UI reads until migration verifies them. A live response uses either one legacy corpus or one new publication, selected at graph start; it never merges both.

## 9. API Design

All routes are tenant-scoped from the authenticated request context. IDs are opaque. Every write accepts an `Idempotency-Key` where a retry may occur and an `If-Match` ETag when modifying an existing resource.

### 9.1 Resource groups

```text
GET    /knowledge/overview
GET    /knowledge/readiness

GET    /knowledge/sources
POST   /knowledge/sources
GET    /knowledge/sources/:sourceId
PATCH  /knowledge/sources/:sourceId
POST   /knowledge/sources/:sourceId/sync
POST   /knowledge/sources/:sourceId/pause
POST   /knowledge/sources/:sourceId/resume
DELETE /knowledge/sources/:sourceId

POST   /knowledge/uploads
POST   /knowledge/uploads/:uploadId/finalize
DELETE /knowledge/uploads/:uploadId

GET    /knowledge/documents
GET    /knowledge/documents/:documentId
GET    /knowledge/documents/:documentId/revisions
GET    /knowledge/revisions/:revisionId/preview
POST   /knowledge/revisions/:revisionId/exclude

GET    /knowledge/facts
POST   /knowledge/facts
PATCH  /knowledge/facts/:factId
POST   /knowledge/facts/:factId/verify
POST   /knowledge/facts/:factId/reject

GET    /knowledge/guidance
POST   /knowledge/guidance
PATCH  /knowledge/guidance/:ruleId
POST   /knowledge/guidance/:ruleId/disable

GET    /knowledge/review-items
POST   /knowledge/review-items/:itemId/resolve
POST   /knowledge/review-items/bulk-resolve

POST   /knowledge/test-runs
GET    /knowledge/test-runs/:runId
GET    /knowledge/test-cases
POST   /knowledge/test-cases

GET    /knowledge/publications
GET    /knowledge/publications/:publicationId
POST   /knowledge/publications/validate
POST   /knowledge/publications
POST   /knowledge/publications/:publicationId/rollback

GET    /knowledge/jobs/:jobId
GET    /knowledge/events
POST   /knowledge/feedback
```

### 9.2 Mutation semantics

- Create/import/sync/publication requests return `202 Accepted` with `jobId` when background work is required.
- Synchronous validation failures return stable field errors before a job is created.
- The same tenant-scoped `Idempotency-Key` plus identical request hash returns the original result.
- Reusing a key with different parameters returns `409 IDEMPOTENCY_KEY_REUSED`.
- `If-Match` mismatch returns `412 REVISION_CONFLICT` plus current ETag and a safe diff summary.
- Publication validation returns blockers and warnings without mutating active knowledge.
- Publication creation references an exact draft candidate set and validation result. It never means "publish whatever is current now."
- Delete first creates an immediate logical deny/tombstone, then returns a cleanup job.
- Cursor pagination is used for potentially unbounded resources. Page-size caps and per-tenant quotas are explicit.
- Batch endpoints are bounded and return per-item results; they are not all-or-nothing unless documented.

### 9.3 Error contract

```json
{
  "error": {
    "code": "KNOWLEDGE_SOURCE_FETCH_BLOCKED",
    "message": "This website address cannot be imported.",
    "requestId": "req_...",
    "retryable": false,
    "field": "url",
    "details": {
      "reason": "private_network"
    }
  }
}
```

Stable error families:

- `KNOWLEDGE_VALIDATION_*`
- `KNOWLEDGE_SOURCE_*`
- `KNOWLEDGE_UPLOAD_*`
- `KNOWLEDGE_PARSE_*`
- `KNOWLEDGE_SECURITY_*`
- `KNOWLEDGE_CONFLICT_*`
- `KNOWLEDGE_PUBLICATION_*`
- `KNOWLEDGE_PERMISSION_*`
- `KNOWLEDGE_QUOTA_*`
- `KNOWLEDGE_DEPENDENCY_*`

Internal stack traces, credentials, upstream response bodies, document content, and private network information never enter the public error body.

### 9.4 Roles and actions

| Action                              | Owner | Admin |         Manager |  Agent | Viewer |
| ----------------------------------- | ----: | ----: | --------------: | -----: | -----: |
| View public/customer knowledge      |   Yes |   Yes |             Yes |    Yes |    Yes |
| View internal/restricted knowledge  |   Yes |   Yes |          Policy | Policy |     No |
| Add/edit draft facts/documents      |   Yes |   Yes |             Yes |     No |     No |
| Connect sources or edit credentials |   Yes |   Yes |        Optional |     No |     No |
| Review low/medium-risk items        |   Yes |   Yes |             Yes |     No |     No |
| Verify high-risk facts              |   Yes |   Yes | Optional policy |     No |     No |
| Publish/rollback                    |   Yes |   Yes | Optional policy |     No |     No |
| Change retention/security policy    |   Yes |   Yes |              No |     No |     No |
| Run safe previews                   |   Yes |   Yes |             Yes |    Yes |     No |

RBAC is only the first layer. ABAC additionally checks source audience, document classification, assistant, channel, locale, location, customer authorization, permission version, and action risk.

## 10. Data Model

Use immutable content revisions and an atomic publication model. The names below are logical names; implementation can map them to Prisma naming conventions.

### 10.1 Core tenancy and settings

#### `KnowledgeSettings`

- `tenantId` unique
- `defaultLocale`, `supportedLocales[]`
- `autoPublishPolicy`: off, trusted-low-risk, scheduled
- `publicationApprovalPolicy`
- `retentionPolicyId`
- `embeddingRegion`, `modelRegion`
- `maxSourceBytes`, `maxDocuments`, `crawlLimits`
- `createdAt`, `updatedAt`, `etag`

#### Canonical ownership during migration

- `Tenant` owns workspace identity, membership, billing/status, and the compatibility platform timezone. Its name is a workspace label, not automatically the customer-facing business name.
- A versioned `BusinessProfile` owns customer-facing business identity, default currency, and non-location-specific details.
- `BusinessLocation` owns location address and timezone; schedules and all local timestamps reference that timezone.
- `KnowledgeSettings` owns knowledge workflow/configuration only.
- `OnboardingState` is resumable form state, not business truth.
- Legacy tenant name/type/timezone and source rows receive one-way compatibility projections from the canonical draft during migration. They are not competing writable authorities.
- `averageCheck` is migrated as internal business metadata, never as a customer-quotable catalog price.

#### `KnowledgeScope`

Scopes should be normalized or represented by validated typed JSON when combinations would explode row counts:

- `brandIds[]`
- `locationIds[]`
- `channelTypes[]`
- `assistantIds[]`
- `audiences[]`: public, authenticated-customer, internal
- `segments[]`
- `locales[]`

Scope matching is server code with test vectors. Missing scope means the tenant default, never universal access by accident.

Implementation status (2026-07-13): Knowledge v2 settings now persist the optional tenant default as canonical typed JSON with a monotonic generation and policy-specific hash. Fact and guidance publications materialize inherited scope and bind those pins through retrieval and delivery; changing the default revokes inherited items until republish. Existing tenants remain unset, explicit scopes require an audience, and document authorization semantics are unchanged.

### 10.2 Source and artifact records

#### `KnowledgeSource`

- `id`, `tenantId`
- `kind`: manual, website, file, spreadsheet, help-center, drive, notion, api, legacy-onboarding
- `displayName`
- `connectorId` nullable
- `externalRootKey` and `canonicalUri`
- `syncMode`: manual, scheduled, webhook
- `status`: connecting, discovering, syncing, ready, needs_review, paused, failed, disconnected, deleting, deleted
- `authorityProfileId`
- `defaultScope`, `defaultClassification`, `defaultLocale`
- `syncCursorEncrypted`, `sourcePermissionVersion`
- `lastAttemptAt`, `lastSuccessAt`, `sourceObservedAt`, `nextSyncAt`
- `lastErrorCode`, `lastErrorAt`
- `generation` fencing token
- `createdBy`, `updatedBy`, timestamps, soft-delete/tombstone timestamps

Unique identity: `(tenantId, kind, externalRootKey)` where applicable.

#### `KnowledgeConnector`

- `id`, `tenantId`, `provider`
- encrypted `credentialRef`, never raw credentials
- `externalAccountId`, `displayName`
- granted scopes and selected roots
- `permissionFingerprint`, `permissionVersion`
- `status`, `expiresAt`, `lastVerifiedAt`, `revokedAt`
- webhook subscription identity and encrypted cursor
- timestamps and audit actor

#### `KnowledgeArtifact`

- `id`, `tenantId`, `sourceId`
- immutable object-storage key and encryption-key reference
- `sha256`, byte size, detected/declared MIME, original filename
- acquisition URI hash, ETag, upstream modified time
- malware status, MIME validation status, security classification
- retention class, legal hold, deletion state
- acquiredAt, scannedAt, deletedAt

Object keys are opaque and tenant-namespaced. Raw artifacts are never stored inside queue bodies.

### 10.3 Logical documents and revisions

#### `KnowledgeDocument`

- `id`, `tenantId`, `sourceId`
- stable `externalKey` from the upstream system
- `kind`, canonical URI, title
- canonical locale and translation group
- scope, audience, classification, permission version
- `currentDraftRevisionId`, `currentPublishedRevisionId`
- source-created/updated/deleted timestamps
- status and deletion generation

Unique identity: `(tenantId, sourceId, externalKey)`. URL or title alone is not a stable identity.

#### `KnowledgeRevision`

- `id`, `tenantId`, `documentId`, monotonically increasing `revisionNumber`
- immutable normalized `contentHash`
- `artifactId`, extracted-content object key
- `status`: acquired, scanning, parsing, normalizing, extracting, chunking, embedding, evaluating, needs_review, ready, rejected, superseded, deleted
- parser, OCR, normalizer, extractor, chunker, embedding, sparse-index, and pipeline versions
- detected locale, character/token/page/table/image counts
- extraction coverage and parser-quality results
- source permission fingerprint and scope snapshot
- effective/expiry dates and `staleAfter`
- `supersedesRevisionId`
- created actor/time; no mutable content fields

Unique: `(documentId, revisionNumber)` and preferably `(documentId, contentHash, pipelineVersion)` for deduplication.

#### `KnowledgeElement`

- semantic parsed element: title, paragraph, list, table, table-row-group, image-caption, code, header/footer
- revision ID, ordinal, parent element ID, heading path
- page, bounding box, URL anchor, spreadsheet sheet/range
- normalized text/object reference and hash
- parser confidence, language, classification

This preserves evidence and supports parser diagnosis without treating a chunk as the only representation.

#### `KnowledgeChunk`

- `id`, `tenantId`, `revisionId`, `documentId`
- `ordinal`, `parentElementId`, `parentSectionId`
- content hash, token count, locale
- scope/classification/permission version inherited at creation
- dense/sparse schema versions and deterministic `vectorPointId`
- index state, indexedAt, deletedAt
- provenance range covering elements/pages/anchors

Unique: `(revisionId, pipelineVersion, ordinal)`. The tenant/document relationship must be enforced through composite keys or database triggers/checks, not convention alone.

#### `KnowledgeEmbedding`

- `tenantId`, `chunkId` or tenant-scoped content hash, embedding schema/model/version
- encrypted vector-cache object reference or protected binary value, dimension, hash
- provider/region, createdAt, expiresAt/deletedAt

Unique: `(tenantId, contentHash, embeddingSchema)`. This derived cache avoids paying to recompute unchanged vectors when a new immutable index snapshot is prepared. Do not deduplicate across tenants in a way that leaks corpus membership.

### 10.4 Structured facts

Avoid one unconstrained JSON object for all business truth. Use canonical entities plus versioned values:

- `BusinessLocation`
- `BusinessContact`
- `BusinessHours` and `BusinessHoursException`
- `CatalogItem` with product/service subtype
- `CatalogPrice` with amount, currency, unit, tax mode, validity, segment/location
- `ServiceDuration`
- `EligibilityRule`
- `BookingConstraint`
- `PolicyDefinition`

For extensibility, represent each publishable value as a `KnowledgeFactVersion`:

- `id`, `tenantId`, stable `factKey`
- `entityType`, `entityId`, `fieldType`
- schema-validated normalized value JSON plus display/localized values
- unit/currency/timezone where applicable
- scope, locale behavior, effective and expiry dates
- risk level, authority, verification state
- evidence references to source/revision/elements
- extraction confidence and extraction model version
- created/verified/rejected actor and timestamps
- supersedes version ID and immutable hash

`factKey` identifies the semantic slot, for example `location/{id}/hours/monday` or `service/{id}/base_price`. Numeric values are stored as exact decimals and ISO currency, not localized strings. Timestamps and schedules always carry timezone. Translations of display text link to one canonical language-neutral fact rather than duplicating the price or duration.

#### `KnowledgeCapability` and `KnowledgeRequirementDefinition`

- capability ID/type, tenant enablement, assistant/target scope, and allowed autonomy level
- requirement kind: fact, rule, document coverage, connector/tool, permission, locale, evaluation case
- blocker/warning severity, risk, freshness SLA, scope/locale constraints
- deterministic satisfaction predicate and version
- template origin, tenant override, created/approved actor

Readiness results persist the publication candidate, requirement version, evidence IDs, status, and evaluated time so the UI and publication gate explain the same decision.

### 10.5 Guidance and behavior

#### `GuidanceRuleVersion`

- stable rule ID plus immutable version ID
- rule type: response, prohibition, escalation, approval, tool-use, style
- schema-validated condition AST, not executable JavaScript
- instruction/outcome
- priority and explicit tie-breaking policy
- scope and effective dates
- risk and required approver role
- examples and linked evaluation cases
- evidence/author and review state

Conditions can reference bounded fields such as intent, channel, locale, location, business hours, customer authorization, lead stage, and tool result. Rules cannot introduce arbitrary code or directly bypass a tool policy.

### 10.6 Publication and reproducibility

#### `KnowledgeIndexSnapshot`

- `id`, `tenantId`
- immutable document-revision/chunk manifest and manifest hash
- immutable versioned authorization manifest/hash binding exact source permission partitions, document revisions, membership, schema, and point count
- physical Qdrant collection, dense/sparse schema versions, pipeline compatibility version
- status: preparing, ready, abandoned, deleting, deleted
- expected/observed point counts and aggregate payload/vector hashes
- created/verified timestamps and retention/delete-after timestamps

Unique by `(tenantId, manifestHash, embeddingSchema)` where reuse is safe. A snapshot is a complete immutable document-index set. A fact/rule-only publication can reuse the current snapshot; a document change prepares a new one. This separates atomic answer publication from unnecessary vector rewrites.

#### `KnowledgePublication`

- `id`, `tenantId`, monotonically increasing sequence
- `targetKey`: `workspace` initially; future assistant-specific targets are explicit
- `status`: validating, ready, publishing, active, superseded, failed, rolled_back
- `basePublicationId`
- `indexSnapshotId`
- immutable manifest hash
- pipeline/retrieval/prompt policy compatibility versions
- quality gate run ID and summary
- published/approved actor and timestamps
- activatedAt, supersededAt, rollback reason

Unique: `(tenantId, targetKey, sequence)`. Candidate creation records the base active publication and is serialized per tenant/target. Activation uses compare-and-swap against that base; a stale candidate must rebase and revalidate.

#### `ActiveKnowledgePublication`

- `tenantId`, `targetKey`
- `activePublicationId`, `activeSequence`
- `etag`, `updatedAt`, `updatedBy`

Unique: `(tenantId, targetKey)`. This row is the only runtime pointer and is locked during activation. Initially LeadVirt uses one `workspace` target whose manifest items still carry assistant/channel scopes. Independent assistant publication can be introduced later without changing the invariant.

#### `KnowledgePublicationItem`

- publication ID
- item type: document revision, fact version, guidance version, source permission snapshot
- item ID/version ID
- scope and authorization fingerprint copied into the manifest

Only one publication is active per tenant/target. A response captures the publication ID at graph start and uses it throughout retrieval, generation, tools, citations, and audit. Rollback does not directly reactivate an old pointer. It creates a new publication candidate from the prior manifest, removes currently deleted/unauthorized/expired items, verifies vector/runtime compatibility, reruns gates, and then activates under a new sequence.

### 10.7 Operations, review, and feedback

#### `KnowledgeJob` and `KnowledgeJobAttempt`

- durable job identity, tenant, source/document/revision/publication IDs
- stage, pipeline version, generation/fencing token
- status, priority, deadline, retry policy, attempt count
- progress counters and bounded public status
- typed error code, encrypted payload reference, trace ID
- created/started/heartbeat/completed timestamps

#### `ExternalOperation` and `ChannelDeliveryOperation`

- deterministic LeadVirt operation ID derived from tenant, originating message/command, action kind, normalized request hash, and confirmation version
- tenant, conversation/message, connector/channel, operation kind, request hash
- state: requested, started, succeeded, failed, unknown, reconciled
- provider idempotency key and external result/reference when available
- started/completed/reconciled times, retry deadline, retention expiry

The operation ID is not a model-generated tool call ID. An ambiguous timeout becomes `unknown` and is reconciled before any retry. Channel delivery uses the same pattern so a queue retry cannot send the same message twice.

#### `KnowledgeOutbox` and `KnowledgeInbox`

- outbox event is written in the same transaction as the business mutation
- inbox has unique `(consumer, eventId)` and terminal result
- event envelope includes aggregate version, schema version, deadline, and trace context

#### `KnowledgeConflict`

- conflict type, semantic fact/rule key, overlapping scope/time
- candidate version IDs and evidence
- severity, status, assigned reviewer, resolution and rationale

#### `KnowledgeReviewItem`

- reason, risk, source/revision/fact/rule references
- suggested action and evidence
- state, assignee, due/freshness date, resolution audit

#### `KnowledgeTestCase`, `EvaluationRun`, `EvaluationResult`

- versioned input, expected behavior, expected/forbidden facts, locale/slice/scope
- corpus/publication, retrieval, prompt, generator, judge, and metric versions
- raw restricted result reference plus normalized metrics

#### `KnowledgeFeedback`

- response/run/message IDs, publication ID, actor, category, note
- cited evidence and proposed correction target
- review state; never direct publication

#### `KnowledgeRetrievalTrace` and `KnowledgeCitation`

- query hash and restricted encrypted query reference
- publication, filters, candidate IDs/scores, rerank results, selected evidence
- answer claim-to-evidence links, tool freshness, gate outcome
- model/prompt/retrieval versions and trace ID

### 10.8 Retention and deletion

- Raw artifacts, extracted text, embeddings, prompts, responses, caches, eval datasets, queues, DLQ references, and telemetry have explicit retention classes.
- Logical deletion increments a generation token and immediately excludes the object through Postgres authorization/publication checks.
- A deletion ledger tracks every physical subsystem and completion status.
- An orphan scanner reconciles Postgres, object storage, Qdrant, caches, and connector state.
- Backup erasure follows the documented backup retention window; restored backups replay deletion ledgers before serving traffic.
- Legal hold is explicit, role-restricted, and audited.

## 11. Component Architecture

```text
Browser
  -> Next.js Knowledge UI
  -> NestJS Knowledge API
       -> PostgreSQL (truth, revisions, publications, jobs, policy, audit)
       -> Object storage (immutable raw and extracted artifacts)
       -> Transactional outbox

Outbox dispatcher
  -> BullMQ stage queues
       -> Acquisition workers
       -> Security/parse/OCR workers
       -> Extraction/normalization workers
       -> Chunk/embed/index workers
       -> Evaluation/publication workers
       -> Reconciliation/deletion workers
  -> Qdrant (derived dense+sparse index)

Inbound channel
  -> AI reply queue
  -> LangGraph runtime
       -> Publication resolver
       -> Structured fact and guidance resolver
       -> Shared retrieval service -> Qdrant + PostgreSQL hydration
       -> Authorized live tools
       -> Model provider
       -> Claim/policy/security gates
  -> Channel delivery queue

All services
  -> OpenTelemetry Collector -> Prometheus / Tempo / logs -> Grafana
```

### 11.1 Service boundaries

#### Knowledge API

Owns authorization, draft mutations, source setup, review actions, publication requests, readiness, job status, and signed upload initiation. It does not parse, embed, crawl, or wait synchronously for Qdrant.

#### Ingestion service/workers

Own deterministic stage execution. Each stage consumes an immutable revision reference, writes its result once, and emits the next outbox event. AI extraction may propose typed facts or rules but never bypasses review/publication policy.

#### Publication service

Builds the exact manifest, resolves or prepares its immutable index snapshot, verifies all referenced items and indexes, runs publication gates, and atomically changes the active publication pointer in PostgreSQL.

#### Shared retrieval service

One implementation is used by LangGraph, the Knowledge test playground, API search/diagnostics, eval runners, and shadow tests. It owns query routing, mandatory filters, hybrid retrieval, reranking, database hydration, authorization recheck, evidence assembly, and diagnostics.

The worker must not call an API controller over HTTP or implement its own SQL retrieval shortcut. Put the reusable logic in a tenant-aware application package/module with explicit dependencies and contract tests.

#### Policy and tool gateway

Resolves applicable guidance and authorizes every proposed tool call. Tool adapters return typed values with source system, observed time, freshness, and authorization scope. Models cannot access connector credentials or invoke adapters directly.

#### Evaluation service

LeadVirt owns dataset schemas, runners, results, thresholds, and publication decisions. RAGAS and model judges are adapters, not the release authority.

## 12. Source and Publication State Machines

### 12.1 Source lifecycle

```text
CONNECTING -> DISCOVERING -> SYNCING -> READY
       |           |           |
       +--------> FAILED <------+--retry--> SYNCING
                               +----------> NEEDS_REVIEW
READY <-> PAUSED
READY/PAUSED/FAILED -> DISCONNECTED
any active state -> DELETING -> DELETED
```

Rules:

- `READY` means the last sync completed and its accepted revision is queryable in at least one publication candidate. It does not necessarily mean that draft is active.
- `NEEDS_REVIEW` identifies a safe, explicit human action; it is not a generic failure bucket.
- A source can be `FAILED` while its last published revisions remain active.
- `DISCONNECTED` immediately prevents new sync and revalidates permissions. Existing published data follows the configured retain-or-remove policy.
- `DELETING` increments the source generation before cleanup is queued.

### 12.2 Revision lifecycle

```text
ACQUIRED -> SCANNING -> PARSING -> NORMALIZING -> EXTRACTING
  -> CHUNKING -> EMBEDDING -> INDEXING -> EVALUATING
  -> READY | NEEDS_REVIEW | QUARANTINED | REJECTED
READY -> PUBLISHED -> SUPERSEDED
any nonterminal state -> FAILED or CANCELLED
```

Each transition is a database compare-and-set on expected state, pipeline version, and generation. A late retry cannot transition an already superseded, quarantined, or deleted revision.

### 12.3 Publication lifecycle

```text
DRAFT_CANDIDATE -> VALIDATING -> PREPARING_INDEX -> READY
  -> ACTIVATING -> ACTIVE -> SUPERSEDED
                       |
                       +-> FAILED
SUPERSEDED -> new DRAFT_CANDIDATE through audited rollback request
```

`ACTIVATING -> ACTIVE` is one PostgreSQL transaction that updates the active pointer and emits cache invalidation/audit outbox events. It occurs only after the manifest and vector preparation reconcile successfully. Any pre-activation failure leaves the old publication untouched.

## 13. Ingestion Pipeline

### 13.1 End-to-end sequence

1. **Authorize and reserve quota**
   - Resolve tenant and actor from session.
   - Validate role, source type, plan limits, file/page/domain count, locale, audience, and classification.
   - Reserve bounded processing/storage quota so parallel uploads cannot bypass limits.

2. **Create source/revision and outbox event**
   - Persist the logical source/document/revision and `knowledge.acquire.requested` event in one transaction.
   - Compute a generation token and deterministic job identity.

3. **Acquire**
   - Fetch through a restricted egress path or accept a finalized object-store upload.
   - Enforce bytes, redirects, duration, content type, archive expansion, page count, and rate limits.
   - Record upstream ETag, last-modified time, canonical URI, and permission fingerprint.

4. **Store immutable artifact**
   - Calculate SHA-256 while streaming.
   - Store under a tenant-namespaced opaque key with encryption.
   - If the same normalized artifact and pipeline already exist for the document, record a no-change sync rather than creating duplicate work.

5. **Raw artifact safety scan**
   - Validate MIME by magic bytes and extension allowlist.
   - Scan malware, encrypted archives, zip bombs, excessive nesting, polyglots, and active content.
   - Quarantine artifacts that cannot be opened safely. Ambiguous text-level risk proceeds only to a local sandboxed parser, never directly to an external model or embedding provider.

6. **Parse/OCR**
   - Parse semantic elements, not one flat string, inside a network-isolated sandbox with CPU, memory, filesystem, time, nesting, and output limits.
   - Route image-only or low-text pages to OCR.
   - Preserve headings, lists, tables, page/coordinates, spreadsheet sheets/ranges, image captions, and URL anchors.
   - Benchmark Unstructured and Docling against LeadVirt's real multilingual PDFs and tables before selecting a default parser per format.

7. **Classify extracted content**
   - Scan extracted text, OCR, metadata, links, and images for secrets, PII, sensitive classification, hidden content, and suspicious indirect instructions.
   - Block secrets and prohibited data. Quarantine suspicious content or route it to authorized review.
   - This gate must pass before any external extraction model, embedding provider, or publication step receives the content.

8. **Normalize and classify structure**
   - Normalize encoding and whitespace while retaining original evidence offsets.
   - Detect document/element language, duplicates, template navigation, repeated headers/footers, and content classification.
   - Apply inherited audience, location, brand, channel, and permission metadata.

9. **Extract candidates**
   - Use deterministic parsers first for tables, currency, dates, duration, hours, and contacts.
   - Use schema-constrained model extraction for ambiguous prose.
   - Attach every candidate to precise evidence, extraction model/prompt version, and confidence.
   - Never auto-publish inferred high-risk values.

10. **Resolve identity, duplicates, and conflicts**

- Match stable documents by source/external key.
- Deduplicate exact content hashes and flag near duplicates.
- Normalize comparable fact values and create explicit conflicts only where scope/time overlap.

11. **Semantic chunking**
    - Prefer whole semantic elements.
    - Split only oversized elements by tokenizer-aware boundaries.
    - Repeat table headers in each table chunk.
    - Retain a parent section for later context expansion.
    - Avoid blanket overlap, which can duplicate unrelated boundaries and distort reranking.

12. **Dense and sparse indexing**

- Embed only changed chunks with the pinned multilingual embedding schema.
- Generate a sparse representation for lexical names, SKUs, prices, and exact terminology.
- Cache embedding outputs by content hash and embedding schema, then write index-snapshot-specific Qdrant points without paying for unchanged content again.
- Store minimal payload metadata; hydrate text and authorization from PostgreSQL/object storage.

13. **Quality evaluation**
    - Validate parse coverage, provenance, ACL completeness, vector counts/hashes, retrieval smoke cases, conflicts, PII/injection status, and required scenario facts.
    - Generate draft tenant test cases from changed content for human review, but do not treat synthetic cases as sufficient evidence.

14. **Human review where required**
    - Create targeted review items for high-risk extractions, conflicts, unreadable content, suspicious content, or failed required cases.
    - Do not block unrelated safe knowledge when a publication can explicitly exclude the affected item and scenario.

15. **Prepare publication**

- Freeze the candidate manifest and its hash.
- Allocate a never-reused tenant/target sequence under a short database lock, then release the lock during background work.
- Resolve or prepare a complete immutable `KnowledgeIndexSnapshot` for the document manifest without mutating prior snapshots. Reuse the current snapshot when only facts/rules changed.
- Require acknowledged writes and reconcile expected counts/hashes with consistent reads.

16. **Activate**

- Atomically compare-and-swap the active publication pointer against the candidate's recorded base.
- Invalidate caches by publication ID.
- Emit audit, notification, and asynchronous cleanup events.

17. **Reconcile and retire**

- Confirm Postgres manifest, object artifacts, chunks, Qdrant points, permissions, and active pointer agree.
- Retain superseded revisions for rollback/audit according to policy.
- An abandoned candidate is never reachable because no active pointer references its publication ID; delete its staged points through a durable cleanup job.
- Physically delete expired vectors/artifacts only after retention and rollback windows close. Preserve an allowed evidence snapshot or hashes/manifest/deletion proof for the configured audit policy.

### 13.2 Website synchronization

- Discovery and page fetch are separate bounded stages.
- Canonicalize URLs without merging pages whose query parameters materially select locale or product.
- Respect configured crawl scope and applicable robots policy.
- Detect redirect loops, pagination traps, calendars, infinite search spaces, session URLs, and duplicate print/mobile variants.
- Use conditional requests with ETag/Last-Modified where reliable, but content hash is the final change check.
- Treat HTTP success with login/error-page content as an acquisition failure, not a valid revision.
- Record discovered, fetched, unchanged, excluded, failed, and removed counts.
- A removed upstream page creates a tombstone and candidate removal. Delayed sync events cannot resurrect it without a newer generation.
- `last successful sync` and `source modification age` are separate. A successful crawler can still be reading stale upstream content.

### 13.3 Connector synchronization

- OAuth credentials live in a secret manager or encrypted credential store, not source rows or queue bodies.
- Store selected roots and upstream permission fingerprints.
- Webhooks accelerate synchronization but do not replace scheduled reconciliation.
- Sync cursors are committed only after the corresponding durable mutations/outbox events commit.
- Revocation and permission narrowing update the authorization database immediately, before reindex cleanup.
- Rate limits use provider-aware queues, `Retry-After`, and per-tenant fairness.
- Provider delete and restore semantics map to LeadVirt tombstones and generations.
- If a synced item is edited locally, the user must choose an explicit override or clone; hidden divergence is not allowed.

### 13.4 Multilingual behavior

- Store locale on documents/elements/chunks and supported locale policy on facts/rules.
- Language-neutral values such as money, duration, dates, SKUs, and coordinates have one canonical value with localized display text.
- Prefer same-locale evidence. Cross-lingual retrieval is allowed only by configured fallback policy and must not widen audience or classification.
- Auto-generated translations are labeled and remain draft for high-risk text.
- Search supports names/transliterations and exact identifiers through sparse retrieval.
- Evaluation has independent per-language slices. Strong English performance cannot hide a weak French, German, Spanish, Portuguese, or Russian path.
- Answers use the customer's detected or selected language, preserve official product names, and format currency/date/time using the business location and customer locale.

## 14. Qdrant and Index Design

### 14.1 Collection strategy

- Use one shared collection per embedding schema/model version for normal tenants.
- Mark and index `workspace_id` as the tenant payload field; create all payload indexes before production load.
- Keep Qdrant on a private network with TLS, API authentication, strict mode, restricted service credentials, backups, and monitoring.
- Only backend retrieval and ingestion services connect to Qdrant.
- Move exceptionally large or regulated tenants to dedicated shards/collections only after measured need or contractual isolation requirements.
- Collection aliases may simplify deployment/backfill operations, but runtime retrieval always uses the physical collection/schema recorded in the captured publication's immutable index snapshot. A mutable alias never resolves a historical publication.

FAISS remains useful for local embedding/reranker experiments, exact offline comparison, and developer evaluation. It is not the production index because it does not provide the required durable multitenancy, payload authorization filters, hybrid query operations, and managed lifecycle.

### 14.2 Point identity and payload

Deterministic point identity includes:

```text
hash(workspace_id, index_snapshot_id, chunk_id, embedding_schema)
```

Minimum payload:

- `workspace_id`
- `index_snapshot_id`
- `document_id`, `revision_id`, `chunk_id`
- `locale`, `audience`, `classification`
- bounded location, brand, channel, and assistant scopes
- `permission_version`
- `source_kind`, `document_kind`
- `content_hash`, `pipeline_version`

Avoid placing full source content or credentials in Qdrant payload. Search returns identifiers and scores; PostgreSQL hydration rechecks tenant, publication, permission, scope, deletion state, and content hash before evidence reaches a model.

The first production design intentionally stores one complete Qdrant point set per retained `KnowledgeIndexSnapshot`. Publications whose document manifest is unchanged reuse the snapshot. Embedding vectors are calculated once per content/schema and reused when writing unchanged chunks into a changed snapshot. This costs additional vector storage on document-corpus changes but makes isolation, activation, failure, rollback, and audit behavior simple and testable. An optimized immutable-segment design may replace it later only after it preserves the same exact-membership invariant under concurrency and failure.

### 14.3 Atomic snapshot filtering

Each response captures the active publication ID, then resolves its immutable index snapshot and physical collection. Qdrant applies:

```text
workspace_id == request.workspace
index_snapshot_id == captured_index_snapshot_id
plus server-derived audience/locale/location/channel/classification filters
```

Candidate preparation rules:

1. Allocate a never-reused publication sequence and freeze the candidate manifest/base publication.
2. Resolve a ready snapshot with the exact document manifest/schema or build a complete point set under a new snapshot ID. Prior snapshot points are immutable and untouched.
3. Use acknowledged Qdrant writes and reconcile expected point IDs, vector/schema metadata, payload hashes, and counts with consistent reads.
4. Run retrieval/security gates against the exact candidate publication plus its index snapshot.
5. Lock the tenant/target active row and compare-and-swap `ActiveKnowledgePublication` only when its current pointer still equals the candidate's base publication.
6. Release the lock and invalidate caches. If the base changed, mark the candidate stale and rebase rather than activating it.

Failed, stale, or abandoned snapshot points cannot contaminate a later publication because runtime queries require the exact snapshot referenced by an active publication. An unreferenced snapshot is marked abandoned and a durable cleanup job removes it. Retained older snapshots support bounded rollback; older answer audits use their preserved evidence snapshot/hashes according to retention policy.

Implementation status (2026-07-13): each new structured READY snapshot persists a strict v1 authorization manifest for at most 512 source partitions and 100,000 points. Preparation rebuilds it under source/revision/chunk fences; activation requires its exact canonical hash and current source permission fingerprints; PostgreSQL prevents later READY or referenced membership/authorization mutation. Runtime replaces the full snapshot-item authorization scan with one readiness read and one bounded source read, while candidate hydration still checks exact snapshot rows before and after reranking and final evidence assembly. Deterministic tests prove bounded query and batch counts at 512 partitions; a real PostgreSQL/Qdrant 100,000-point p95/p99 benchmark is still required.

### 14.4 Index migration

1. Create the new collection with validated vector sizes, distance, sparse configuration, payload indexes, strict mode, and capacity settings.
2. Backfill active and rollback-window revisions idempotently.
3. Dual-write new revisions to old and new schemas.
4. Run the full retrieval/security suite and shadow production queries with content capture disabled.
5. Create publication candidates that reference the new collection.
6. Canary tenants/scenarios and compare per-slice quality, latency, empty rate, and cost.
7. Activate the publication that references the new physical-collection snapshot; an alias switch alone is never the runtime or historical consistency boundary.
8. Retain the old collection for the rollback window, then delete through an audited job.

## 15. Runtime Retrieval and Answer Flow

### 15.1 Shared retrieval pipeline

1. Resolve authenticated tenant, assistant, channel, customer authorization, locale, location, and permission version.
2. Capture the active publication ID/sequence and compatible retrieval policy.
3. Normalize the query without losing exact product names, IDs, prices, or negation.
4. Classify intent, risk, answerability requirements, and whether live operational data is required.
5. Resolve exact structured facts and applicable guidance rules first.
6. Plan, authorize, and execute read-only lookup tools needed for current operational evidence. Static documents may explain policy but cannot supply current availability, inventory, order, or account state.
7. For document questions, run dense and sparse Qdrant searches with mandatory server-generated filters.
8. Fuse candidate lists with reciprocal rank fusion initially.
9. Deduplicate and group by logical document/source so one long document cannot dominate.
10. Rerank a wider candidate set with a pinned multilingual cross-encoder or late-interaction model.
11. Apply calibrated relevance/support thresholds per model and language, not one raw cross-model score.
12. Expand selected chunks to bounded parent sections and preserve exact evidence spans.
13. Rehydrate from PostgreSQL and recheck tenant, publication, permission, classification, scope, deletion, and hash.
14. Detect contradictions, expired facts, stale live data, missing required evidence, and overly redundant context.
15. Return a typed `EvidenceBundle`, not a concatenated user message.

### 15.2 Evidence bundle contract

```text
EvidenceBundle
  publicationId
  queryClassification
  structuredFacts[]
    canonical value, scope, validity, risk, evidence IDs
  guidanceRules[]
    condition, outcome, priority, scope
  documentEvidence[]
    immutable revision/chunk IDs, text, source location, scores
  liveToolResults[]
    typed value, observedAt, expiresAt, authorization scope
  conflicts[]
  missingRequirements[]
  answerPolicy
```

The model sees trusted system policy separately from delimited untrusted document evidence. Source instructions such as "ignore prior rules" are treated as document text and cannot change tool access or system policy.

### 15.3 Target LangGraph

```text
normalize_input
  -> resolve_identity_permissions_publication
  -> classify_pii_language_intent_risk
  -> resolve_facts_guidance_and_tool_need
  -> plan_authorize_execute_read_tools
  -> retrieve_and_rerank_documents
  -> evidence_conflict_freshness_gate
       -> clarify_or_handoff when insufficient
       -> draft_response when sufficient
  -> claim_citation_policy_output_gate
       -> repair once when safely repairable
       -> require_approval or handoff when not
  -> plan_side_effects_and_require_confirmation
  -> reauthorize_refresh_preconditions_execute_side_effects
  -> compose_and_run_final_gate
  -> recheck_evidence_permissions_and_generations
  -> persist_atomic_audit_and_outbox
  -> channel_delivery_queue_rechecks_permissions
```

Read-only lookup tools run before drafting because their fresh results are evidence. State-changing tools run only after a recorded confirmation or policy-approved autonomous action. After any human interrupt/resume, reauthorize the actor, refresh the publication/permission generations, and revalidate live preconditions such as slot or inventory availability before executing. Then run a final claim/policy gate against the actual execution result.

Use a persistent Postgres LangGraph checkpointer only when graph suspension, human approval, or durable resume is needed. Keep state compact: opaque IDs, hashes, policy decisions, and tool results. Raw documents and large prompts remain in protected storage. LangGraph interrupt nodes can restart, so any side effect before an interrupt must have a deterministic idempotency ledger.

### 15.4 Draft and claim gate

Before automatic send, validate:

- every material factual claim maps to a fact, document citation, or fresh tool result;
- cited evidence is inside the captured publication and authorized scope;
- high-risk claims use exact verified evidence and preserve conditions/currency/timezone;
- guidance prohibitions and escalation rules are satisfied;
- source content did not create unapproved tool instructions;
- output contains no disallowed PII, credentials, internal-only citations, or unsupported promises;
- conflicting, stale, or insufficient evidence triggers clarification or handoff;
- actions requiring confirmation remain proposals until confirmation is recorded.
- all evidence permissions, source deletion generations, and live-result expiry remain valid immediately before response commit and again before channel delivery.

One bounded repair attempt is acceptable for formatting or missing citations. Repeated model retries are not a substitute for evidence. A failed high-risk gate hands off. A low-risk document outage can produce a short transparent fallback only if business policy permits it.

### 15.5 Failure matrix

| Failure                       | Safe response                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Qdrant unavailable            | Exact structured facts/rules/tools may continue; document-dependent answers hand off. No silent lexical fallback |
| Reranker unavailable          | Use evaluated hybrid order only for allowed low-risk intents and mark degraded metric; otherwise hand off        |
| Model unavailable             | Queue bounded retry if channel latency permits, then hand off/operator draft; never fabricate template facts     |
| Live tool unavailable/stale   | Do not answer current operational state; apologize and hand off or collect request                               |
| Publication mismatch          | Fail closed and retry against one captured publication; alert reconciliation                                     |
| Permission service uncertain  | Return no restricted context; deny tool access                                                                   |
| Conflicting high-risk facts   | State that confirmation is needed and hand off, without choosing a value                                         |
| Missing evidence              | Ask one useful clarification if it can resolve scope; otherwise hand off                                         |
| Prompt injection suspicion    | Exclude/quarantine evidence, block tool effects, record security event                                           |
| Telemetry backend unavailable | Continue user traffic with local bounded buffering; do not block responses                                       |

### 15.6 Context and cost controls

- Window conversation history by relevance and recency; store a versioned summary with source message IDs.
- Keep customer text, business evidence, rules, and tool results in separate structured sections.
- Limit chunks per document/source and total context tokens.
- Reuse embeddings by content and schema hash; do not re-embed metadata-only changes when payload update is sufficient.
- Cache retrieval only with tenant, assistant, permission fingerprint, publication, locale, scope, query hash, retrieval version, and model version in the key.
- Cache no restricted raw answer across customers unless policy explicitly proves equivalence.
- Budget classification/extraction/reranking/generation separately. Token accounting uses provider usage, not final-text estimates.

## 16. Queueing, Idempotency, Retry, and DLQ

### 16.1 Queue topology

Separate workloads so a large crawl cannot starve live replies:

```text
knowledge.acquire
knowledge.scan
knowledge.parse
knowledge.extract
knowledge.chunk
knowledge.embed
knowledge.index
knowledge.evaluate
knowledge.publish
knowledge.reconcile
knowledge.delete
ai.reply
channels.sendMessage
```

Configure independent concurrency, timeout, retry budget, priority, and provider/tenant rate limits. Use fair scheduling or tenant concurrency caps for expensive stages.

### 16.2 Job envelope

Every event/job includes:

- `eventId`, `schemaVersion`, `eventType`
- `workspaceId`, `aggregateType`, `aggregateId`, `aggregateVersion`
- `documentRevisionId`, `pipelineVersion`, `publicationCandidateId` where applicable
- `generation` fencing token
- encrypted/opaque `payloadRef`, never raw document content
- `traceparent`
- `createdAt`, `deadline`

The consumer reloads and reauthorizes the aggregate from PostgreSQL. The queue payload alone is never sufficient authority.

### 16.3 Correctness controls

- Business mutation and outbox event commit in one database transaction.
- Consumer inbox uniqueness is `(consumerName, eventId)`.
- A consumer claim/lease is not a completed dedupe marker. Stage output, terminal inbox result, and the next outbox event commit atomically; on rollback another attempt can safely acquire the event.
- Stage result uniqueness is `(documentRevisionId, pipelineVersion, stage)`.
- Tool effects use the deterministic `ExternalOperation` ID and request hash defined in the data model. Regenerating a model tool-call ID cannot create a new business operation.
- Channel delivery uses `ChannelDeliveryOperation` keyed by tenant, persisted message, channel/recipient, and delivery version.
- Idempotency records store tenant, endpoint, key, request hash, state, and terminal response reference.
- Idempotency/external-operation records are retained beyond the maximum request deadline, retry budget, queue/DLQ retention, redrive window, provider callback delay, and allowed late-arrival interval. Cleanup cannot reopen a duplicate-effects window.
- Every worker compares the current generation before and immediately before committing output.
- Long stages heartbeat and honor cancellation. A timeout requests cancellation and fences late commits; `Promise.race` alone is insufficient.
- Conversation replies use a per-conversation sequence/lock so concurrent messages cannot produce reordered actions.
- BullMQ custom IDs and deduplication reduce work but are not the correctness boundary because removed or stalled jobs can run again.

### 16.4 Retry policy

Retry one architectural layer with bounded exponential backoff, full jitter, deadline, and retry budget.

Retryable:

- network timeout/connection reset;
- `429` with `Retry-After`;
- transient `5xx`;
- temporary object store/Qdrant/provider unavailability;
- optimistic dependency conflict that can be safely reloaded.

Non-retryable until remediation:

- invalid/unsupported/corrupt file;
- malware, secret, or prompt-injection quarantine;
- authentication/authorization failure or revoked connector;
- SSRF/private-network block;
- schema validation failure;
- quota exceeded;
- permanent provider `4xx`.

A remote timeout does not prove that a side effect failed. External calls include tenant-scoped idempotency keys where supported and persist `started` before calling. Ambiguous timeouts become `unknown`. Reconcile with the provider before retry; where the provider has neither idempotency nor a reliable lookup, do not auto-retry the side effect and route it for operator resolution.

### 16.5 Durable DLQ and redrive

- Persist terminal failure and all attempt metadata in PostgreSQL before acknowledging failure handling.
- A DLQ record references the protected payload; it does not copy source text or PII.
- Store typed cause, stage, retry history, dependency, generation, remediation, and safe operator summary.
- Redrive requires authorized role, remediation note, audit event, current generation check, and rate limit.
- Redrive one item or bounded selection after fixing the cause. Never replay the entire queue blindly.
- Preserve aggregate ordering because redriven work can interleave with newer live work.
- Alert on oldest retryable age and repeated systemic causes, not just failed count.

## 17. Evaluation and Quality Gates

### 17.1 Evaluation ownership

LeadVirt owns a vendor-neutral evaluation package and result schema. RAGAS can calculate selected retrieval/generation metrics. Custom deterministic rules cover business policy, citations, tools, permissions, and state changes. Model judges assist semantic scoring but do not make uncalibrated release decisions.

Every evaluation result records:

- corpus/publication snapshot;
- parser, normalizer, chunker, embedding, sparse, reranker, retrieval policy;
- system prompt, graph, provider, generator model;
- judge model and judge prompt;
- dataset and case versions;
- code commit and environment.

Changing a judge model or prompt changes the measurement system and requires re-baselining.

### 17.2 Layered metrics

| Layer                 | Metrics/gates                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Ingestion             | acquired-page coverage, parse/OCR/table coverage, encoding errors, duplicate ratio, provenance completeness, ACL completeness         |
| Structured extraction | schema validity, normalized-value exactness, evidence accuracy, conflict detection, high-risk review compliance                       |
| Retrieval             | Recall@production-k, Hits@1/MRR for exact FAQ, NDCG@k after rerank, context precision/recall, zero-result and irrelevant-result rates |
| Generation            | claim faithfulness, claim-level citation entailment/coverage, answer relevance/completeness, correct locale, appropriate abstention   |
| Policy/tools          | prohibited-claim rate, escalation accuracy, tool-selection accuracy, argument validity, confirmation and state-transition correctness |
| Security              | tenant/ACL/cache isolation, permission revocation, PII/secret leakage, poisoned document, indirect injection, SSRF/upload cases       |
| System                | end-to-end task success, latency, time-to-queryable, availability, freshness, cost/token budget, duplicate side effects               |

Match retrieval `k` to production. `Recall@100` is not evidence if the model receives five chunks. Evaluate answerable and unanswerable questions separately.

### 17.3 Dataset slices

Maintain explicit slices for:

- every supported language;
- business/industry and channel;
- exact fact, document explanation, rule, and live-tool intent;
- answerable, missing, ambiguous, and contradictory questions;
- high-risk price/refund/legal/medical/availability cases;
- stale and future-effective content;
- tables, OCR, long pages, duplicate pages, and poor encoding;
- typos, short queries, entity names, negation, multi-intent queries;
- public/customer/internal audience and permission revocation;
- adversarial customer input, poisoned source, prompt injection, secret and PII canaries;
- queue duplicate, late retry, cancellation, rollback, and dependency outage.

Dataset sources:

1. Hand-labeled platform safety and product cases.
2. Industry packs reviewed by domain owners.
3. Tenant-approved critical questions and expected facts/actions.
4. Anonymized real failure cases under retention/consent policy.
5. Synthetic cases used to find coverage gaps, never as the only ground truth.

Synthetic questions often mirror source vocabulary and can overstate retrieval quality. Human labels remain calibration truth.

### 17.4 Judge controls

- Prefer deterministic validation for schemas, citations, permissions, tools, exact values, and state changes.
- For semantic judging, use human-calibrated rubrics with independent claim scoring.
- Shuffle pairwise response order and repeat a sample to measure judge stability.
- Monitor judge/human agreement and disagreement by language/risk slice.
- Avoid evaluating only with the same model family that generated the answer.
- Store restricted raw evidence for authorized diagnosis, with short retention.
- Use confidence intervals/lower bounds when sample size permits. Do not gate on one weighted average.

### 17.5 Initial gates

These are starting policy targets and must be calibrated on real pilot data:

#### Hard zero-tolerance gates

- cross-tenant or unauthorized retrieval;
- tenant-unsafe cache hit;
- secret/credential disclosure;
- known PII canary disclosure outside approved policy;
- unauthorized/destructive tool execution;
- known prompt-injection suite causing policy or tool bypass;
- unapproved external provider receiving restricted data;
- stored-XSS or active-content execution in a source/answer preview;
- partial publication visibility;
- duplicate externally visible side effect in retry suite.

#### Publication gates

- 100% provenance and ACL metadata on candidate chunks.
- 100% required high-risk facts verified and non-conflicting.
- 100% tenant-designated critical cases pass exact expected fact/action/refusal behavior.
- Claim citation coverage: 100% for high-risk claims; target at least 95% for other material claims.
- Appropriate abstention/handoff target at least 95% on unanswerable cases.
- Retrieval `Recall@k_policy`, where `k_policy` is the exact number of chunks supplied by that deployed retrieval policy, targets at least 90% on critical cases and at least 85% overall, with per-language floors. If the initial policy supplies five chunks, this is Recall@5; changing `k` changes the gate definition and baseline.
- No material per-slice regression beyond the configured tolerance against the active publication, using a confidence-bound comparison where the sample supports it.
- Time-to-queryable and latency budgets pass under representative corpus size.

Small tenants may not have enough cases for statistical gates. In that case, hard deterministic cases and platform safety suites remain mandatory, while confidence-bound gates activate as data grows.

### 17.6 Evaluation cadence

- **Pull request**: deterministic unit/contract/security cases and a small pinned corpus.
- **Main/deploy**: full platform golden set, PostgreSQL/Qdrant path, parser fixtures, duplicate/retry/security suites.
- **Publication**: changed-source smoke, tenant critical cases, conflict/freshness/policy gates, active-vs-candidate comparison.
- **Model/index migration**: full offline benchmark, shadow traffic, canary, rollback-ready evaluation.
- **Production**: sampled outcome monitoring, explicit feedback diagnosis, drift alerts, and scheduled regression runs.

The existing seven-case mock golden set is a bootstrap artifact, not a production gate. Required CI must exercise the real shared retrieval path with Qdrant and must not seed chunks directly as a substitute for ingestion.

## 18. Security, Privacy, and Isolation

### 18.1 Tenant and authorization boundary

- Derive tenant from authenticated membership. Ignore/reject tenant identity from client-controlled payloads.
- Revalidate tenant membership, role, account state, aggregate tenant, and generation in workers.
- Apply policy enforcement at API mutations, source acquisition, retrieval, preview, model context assembly, tool execution, citation display, export, support access, and deletion.
- Every chunk inherits tenant, classification, audience, scope, and permission version.
- Authorization occurs in the Qdrant prefilter and PostgreSQL hydration. Post-filtering only after model generation is prohibited.
- Recheck the current evidence permission/deletion generations before committing an answer and in the channel delivery worker. Revocation during model generation or queue wait cancels delivery and reevaluates against current authority.

### 18.2 PostgreSQL RLS defense in depth

- Use a non-owner runtime database role without `BYPASSRLS`.
- Enable and `FORCE ROW LEVEL SECURITY` on tenant-bearing knowledge, audit, job, feedback, and publication tables.
- At transaction start, set a validated tenant/session context with `SET LOCAL` and clear it automatically at commit/rollback.
- Because `SET LOCAL` is transaction-scoped, the Prisma integration must use a request/job-scoped interactive transaction or a tested CLS-bound tenant client that guarantees every protected query stays on the same transaction connection. Enabling RLS before this boundary exists would cause inconsistent or unsafe behavior.
- The shared `@leadvirt/db` boundary now validates API/background-job tenant, user, role, and source values, applies them with transaction-local `set_config`, exposes only the scoped transaction client, rejects nested/expired reuse, and is covered by real pool reset/isolation smoke. RLS is still disabled because existing services have not all migrated and deployment still uses an owner-capable role.
- Validate connection-pool and PgBouncer mode explicitly; never use session-scoped tenant state that can leak through a pooled connection.
- Prefer a restrictive tenant policy; PostgreSQL permissive policies combine with `OR` and can accidentally widen access.
- Keep composite foreign keys or triggers that prove child tenant equals parent tenant.
- Test table-owner behavior, unique/FK existence leakage, administrative jobs, and cross-table policy races.
- Migration/maintenance roles are separate, short-lived, and audited.

RLS is defense in depth, not a replacement for service-layer filters and authorization tests.

### 18.3 Qdrant controls

- Private bind/network, TLS, authentication, strict mode, backup/restore tests, and restricted egress.
- Separate read-only retrieval credentials from collection-scoped ingestion credentials where supported.
- `is_tenant=true` improves partitioning; it is not authorization by itself.
- Shared-collection JWT/collection access does not replace mandatory application payload filters.
- Hydrate and reauthorize every selected point from PostgreSQL.
- Treat embeddings as sensitive derived data; they are not anonymized and are included in deletion/export risk analysis.

### 18.4 Website SSRF controls

- Allow only `https` and optionally `http` with policy; reject userinfo, file/data/gopher and other schemes.
- Normalize and validate host/port before resolution.
- Reject loopback, private, link-local, multicast, reserved, metadata, container/service, and internal DNS destinations for IPv4 and IPv6.
- Resolve through controlled DNS, pin/verify the destination at connection, and repeat validation for every redirect to resist DNS rebinding.
- Use a restricted egress proxy/network with no access to cloud metadata, internal services, databases, or control planes.
- Limit redirects, response size, time, decompression ratio, pages, depth, concurrency, and total crawl budget.
- Do not forward browser cookies, API credentials, authorization headers, or arbitrary headers.
- Prevent callback/webhook URLs from becoming a general-purpose fetch service.
- Log only normalized safe metadata; URLs can contain secrets and require redaction.

### 18.5 File security

- Explicit format allowlist and documented limits.
- Check extension, declared MIME, magic bytes, and parser-detected type.
- Randomize object keys and keep uploads outside web roots.
- Malware scan and quarantine before parse.
- Sandbox parsers with CPU, memory, time, filesystem, network, nesting, and output limits.
- Detect zip bombs, polyglots, encrypted archives, embedded executables/macros, oversized images, malformed PDFs, and parser crashes.
- Signed uploads are short-lived, content-length bound, tenant-bound, and finalized only after hash/metadata verification.
- Never serve raw uploads inline from the application origin without safe content-disposition and authorization.

### 18.6 Prompt injection and model isolation

- Treat website/file/connector content and customer messages as untrusted data.
- Scan for suspicious instruction patterns and quarantine or downgrade according to policy, but do not rely on detection alone.
- Delimit evidence structurally and state that it cannot modify system policy, authorization, or tool permissions.
- Do not place retrieved text in a system/developer instruction role.
- Minimize context and exclude scripts, hidden text, navigation spam, comments, and irrelevant metadata.
- Tool gateway independently validates schema, tenant, permission, state preconditions, and confirmation.
- Tool outputs are also untrusted external data and cannot introduce instructions.
- Test direct, indirect, encoded, multilingual, multi-turn, image/OCR, and retrieval-poisoning cases.
- A suspicious source cannot auto-publish and cannot trigger tools during ingestion or preview.

### 18.7 PII and secrets

Classify data before external model/embedding calls:

- **Public business data**: intentionally publishable business contact/catalog information.
- **Internal business data**: procedures, internal contacts, margins, staff-only guidance.
- **Customer personal data**: conversation/account information needed for a scoped purpose.
- **Sensitive/special data**: regulated categories requiring explicit policy and minimization.
- **Secrets**: passwords, tokens, private keys, credentials. Always block/quarantine.

Controls:

- Minimize data sent to models; use IDs and typed tool outputs where possible.
- Never embed credentials or unnecessary customer PII.
- Redact/tokenize PII in telemetry and evaluation artifacts.
- Keep customer data out of general business document indexes.
- Output DLP validates destination and policy before delivery.
- Automated detectors such as Presidio are helpful but not complete; combine deterministic patterns, entity recognition, classification, allowlists, human review, and canary tests.
- Maintain processing inventory, purposes, lawful basis, subprocessors, retention, residency, export, erasure, and incident procedures. Run a DPIA before sensitive production use.

Before enabling any external model, embedding, OCR, parser, or reranker provider for a classification, an admission policy must verify approved processor terms, data region, retention, training opt-out/no-training guarantee, transfer mechanism, subprocessors, encryption, deletion behavior, incident terms, and tenant consent/configuration where required. An unapproved provider configuration fails closed before data leaves LeadVirt.

Customer-personal reads also require an immutable channel-bound subject proof. Mutable Lead, contact, conversation, or message metadata is not identity. Telegram proof is limited to a verified bot ID plus a managed-secret real webhook for a non-bot private chat where safe numeric `message.from.id === message.chat.id`; samples, legacy unverified channels, and group traffic stay non-personal without blocking Inbox ingestion. The create-only attestation binds the exact inbound Message, Conversation, Channel, WebhookEvent payload/receipt, HMAC subject, and version. Queues carry only an opaque proof reference, and the live-tool gateway rehydrates it before execution, commit, and resolution. The worker remains PUBLIC until the approved personal-query and full revocation path is activated.

### 18.8 Encryption, secrets, and support access

- TLS in transit and managed encryption at rest for PostgreSQL, object storage, backups, Qdrant volumes, and telemetry storage.
- Per-tenant or environment envelope encryption for connector secrets and restricted artifacts, with rotation and access audit.
- Secrets never enter logs, traces, metrics, browser storage, queue payloads, Qdrant payloads, or error bodies.
- Support access uses time-limited break-glass grants with reason, approval, tenant visibility where appropriate, scoped data access, and immutable audit. No silent impersonation.
- Maintain a tested incident path for source poisoning, leaked connector credentials, cross-tenant suspicion, and model-provider data exposure.

### 18.9 Permission and deletion caches

- Cache keys include tenant, assistant, audience, permission fingerprint/version, publication, locale, classification scope, and query/retrieval version.
- Permission revocation updates PostgreSQL authorization first and invalidates the permission fingerprint. Old cache/vector entries become unusable immediately.
- Physical deletion follows asynchronously through a ledger and retries.
- Orphan and stale-permission scanners are mandatory production jobs.

### 18.10 Untrusted content rendering

- Render extracted source text, model output, citations, errors, and connector metadata as escaped text by default.
- If Markdown is required, use an allowlist sanitizer with raw HTML disabled, safe URL schemes, `rel` protections, and no script/style/event attributes.
- Enforce a restrictive Content Security Policy.
- Do not load arbitrary external images, fonts, iframes, or link previews from imported content. Block them or fetch through an authenticated, scanning, privacy-preserving proxy.
- Raw files use attachment disposition on a separate protected origin. Source previews cannot execute macros, PDF JavaScript, SVG script, or active Office content.
- Add stored-XSS, Markdown URL/exfiltration, malicious filename, and model-output rendering cases to UI security tests.

## 19. Observability and SLOs

### 19.1 Telemetry architecture

```text
API and workers -> local OpenTelemetry Collector
  -> Prometheus-compatible metrics
  -> Tempo or another trace backend
  -> restricted structured logs
  -> Grafana dashboards and alerts
```

Observability export failure never blocks user traffic. The Collector uses bounded memory/disk queues and exposes its own queue utilization, drop, and exporter-failure metrics.

### 19.2 Traces

Trace the asynchronous path:

```text
source create/upload
  -> acquire -> scan -> parse/OCR -> normalize -> extract
  -> chunk -> embed -> Qdrant stage -> evaluate -> publish
  -> inbound message -> retrieve -> rerank -> model -> tools -> gate -> delivery
```

Propagate `traceparent` through outbox and BullMQ. Do not put user email, tenant name, customer text, document text, prompt, or credentials in OTel baggage.

Safe default span attributes:

- opaque tenant/document/revision/publication/job IDs in access-controlled traces;
- service, environment, operation, stage, provider, model family/version;
- result/error type, retry count, counts/bytes/tokens, duration;
- locale, source/document kind, risk level, retrieval policy version;
- Qdrant collection schema, candidate/selected counts, gate outcome.

GenAI semantic conventions are evolving and content-bearing attributes may contain PII. Wrap them behind LeadVirt-owned instrumentation, pin the convention version, and keep prompt/completion/query content disabled by default.

### 19.3 Metrics

Use bounded labels only. Never use tenant, user, conversation, document, URL, prompt, error message, or arbitrary model response as a Prometheus label.

Core metrics:

- `knowledge_jobs_total{stage,result,error_type}`
- `knowledge_job_duration_seconds{stage,result}`
- `knowledge_job_oldest_age_seconds{stage}`
- `knowledge_source_sync_total{source_kind,result}`
- `knowledge_time_to_queryable_seconds{source_kind}`
- `knowledge_documents_total{state,source_kind}`
- `knowledge_parse_coverage_ratio{format}`
- `knowledge_review_items{reason,risk}`
- `knowledge_conflicts{risk,state}`
- `knowledge_publications_total{result}`
- `knowledge_publication_duration_seconds{result}`
- `knowledge_index_mismatch_total{kind}`
- `knowledge_retrieval_duration_seconds{stage,result}`
- `knowledge_retrieval_candidates{stage}` histogram
- `knowledge_retrieval_empty_total{intent,locale}`
- `knowledge_retrieval_degraded_total{dependency}`
- `knowledge_answer_gate_total{result,reason,risk}`
- `knowledge_citation_coverage_ratio{risk}`
- `knowledge_tool_total{tool_family,result}`
- `knowledge_feedback_total{category}`
- `knowledge_security_events_total{type,result}`
- `knowledge_deletion_oldest_age_seconds{subsystem}`
- `otelcol_exporter_*`, queue utilization, dropped spans/metrics/logs

Use histograms for latency and aggregate percentiles. Do not average summary quantiles. Exemplars connect user-impact metrics to restricted traces.

### 19.4 Dashboards

1. **Knowledge health**: sources, freshness, time-to-queryable, failures, review/conflict backlog, active publications.
2. **Retrieval quality**: empty/degraded rate, candidate/selected counts, retrieval/rerank latency, per-language quality trends.
3. **Answer safety**: gate reasons, handoff/clarification, citation coverage, prohibited claims, tool approvals.
4. **Pipeline reliability**: queue oldest age, retries, DLQ, stage throughput, cancellation, duplicate suppression.
5. **Dependencies**: object storage, Qdrant, model, connector, Redis, PostgreSQL, Collector health.
6. **Cost/capacity**: bytes/pages, embeddings, tokens, reranker/model calls, Qdrant size, tenant plan aggregates without high-cardinality labels.
7. **Security/privacy**: isolation canaries, permission-revocation lag, quarantines, deletion ledger age, support access.

### 19.5 Initial SLOs

Targets should be validated during pilots and separated by interactive versus batch work:

| SLO                                                 | Initial target                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Active publication availability                     | 99.9% monthly                                                                                            |
| Retrieval service availability for document answers | 99.9% monthly                                                                                            |
| Retrieval latency                                   | p95 under 500 ms, p99 under 1 s at pilot corpus size                                                     |
| End-to-end automatic reply decision                 | p95 under 5 s excluding channel/provider delay                                                           |
| Manual small-entry time-to-queryable                | p95 under 2 minutes                                                                                      |
| Normal file/website revision time-to-queryable      | p95 under 5 minutes within documented limits                                                             |
| Known permission revocation logical enforcement     | New requests are denied immediately after the authorization transaction commits                          |
| Upstream permission-change detection                | Webhook-driven p99 under 30 seconds where supported; otherwise the connector-specific reconciliation SLA |
| Source deletion logical enforcement                 | immediate transactionally; physical cleanup per retention SLO                                            |
| Active manifest/index mismatches                    | zero; alert immediately                                                                                  |
| Publication success excluding validation rejection  | at least 99%                                                                                             |
| Security hard-gate failures in known suite          | zero                                                                                                     |

Use multi-window burn-rate alerts for user-visible SLOs. Dependency errors alert only when they create user impact or threaten freshness/capacity. Alert on queue oldest age and time-to-queryable, not queue depth alone.

## 20. CI/CD and Release Strategy

### 20.1 Required CI layers

1. Schema/contract/type/lint/unit tests.
2. Prisma migration forward and rollback/compatibility checks on representative data.
3. Parser fixtures for supported formats, OCR, tables, malformed and adversarial files.
4. Real Postgres + Redis + Qdrant ingestion-to-retrieval integration path.
5. Tenant/ACL/cache/permission-revocation/deletion isolation suite.
6. Retry, stalled worker, timeout cancellation, outbox/inbox, late job, duplicate side-effect, DLQ redrive tests.
7. Pinned platform retrieval/generation/policy golden set with per-slice gates.
8. UI type/lint/build plus Playwright Knowledge onboarding, review, publication, failure, and accessibility smoke.
9. Container/deployment config validation, private Qdrant access, health/readiness, migration preflight.
10. Optional budget-controlled real-provider eval that becomes a required protected-environment gate before material model/prompt releases.

### 20.2 Deployment order

1. Expand database schema with backward-compatible nullable/new tables.
2. Deploy readers that understand both legacy and new forms.
3. Add versioned v2 source routes and keep the old request/response behavior behind an explicit adapter. Legacy records remain compatibility/UI data, not an extra live corpus.
4. Deploy the dual-write adapter behind flags. Legacy mutation, new revision, and outbox event must commit in one transaction.
5. Backfill one current `legacy_snapshot` revision per source, reconcile duplicate authorities, and build publication candidates idempotently. Do not infer lost history from the legacy version counter.
6. Drain pre-deploy Redis jobs or run a compatibility consumer for the old `ai.reply` schema. New workers must not misinterpret jobs without schema version, publication, generation, or payload reference.
7. Verify reconciliation and shadow retrieval. Mark historical hard-coded latency, zero cost, and partial token records as legacy/unreliable; canary baselines start from newly instrumented provider usage.
8. Canary new retrieval by tenant/scenario. Each graph run selects one legacy corpus or one v2 publication, never both.
9. Enable new publication path.
10. Stop legacy writes, observe, then remove old paths in a later release.

Never combine a destructive schema migration, embedding migration, prompt/model change, and retrieval cutover in one release.

### 20.3 Release and rollback

- Feature flags are tenant/scenario scoped and audited.
- Candidate index/model/prompt versions run in shadow without customer-visible side effects.
- Canary checks include quality, security, latency, cost, empty/degraded rate, and tool behavior.
- Application rollback and knowledge publication rollback are independent. Knowledge rollback builds and validates a new candidate from the prior manifest rather than directly reactivating obsolete permissions or content.
- A code release must remain able to read the current and immediately previous publication/schema versions during the rollback window.
- Database migrations use expand/contract and do not remove data until all running versions are compatible.

## 21. Rollout Plan

### Phase 0: Contain risk and establish the correctness substrate

- Create one shared retrieval service and run LangGraph, test preview, and API diagnostics against it in shadow until the minimal snapshot boundary below is ready.
- Remove arbitrary-chunk fallback and use explicit insufficient-grounding behavior.
- Add minimal immutable legacy revisions, an active publication pointer, immutable index snapshots, and a transactional outbox. Trigger candidate indexing automatically from create/update/onboarding/archive operations and switch only after reconciliation.
- Fail visibly on onboarding persistence errors.
- Prevent archived/stale Qdrant hydration and reconcile/delete orphaned points.
- Add deterministic external-operation/channel-delivery ledgers, per-conversation ordering, cancellable timeouts, late-commit fencing, dependency metrics, and no-silent-fallback behavior.
- Apply owner/admin/manager policy consistently to onboarding and account knowledge mutations.
- Add CI for normal onboarding without manual reindex, edit/archive cleanup, and irrelevant corpus.

Exit criterion: a normal onboarding save is provably retrievable from one immutable minimal publication by the same runtime used for live replies, retries cannot duplicate actions, and an irrelevant corpus causes abstention rather than false grounding. No Phase 0 live cutover is allowed while an invariant in Section 4 is knowingly violated.

### Phase 1: Structured Knowledge and publication

- Add Knowledge workspace and typed business, catalog, hours, policy, and guidance editors.
- Introduce immutable document/fact/rule revisions, evidence, scope, locale, authority, risk, conflict, and publication manifest.
- Add atomic publish/rollback and capture publication ID in AI audit.
- Migrate legacy onboarding rows into draft revisions with compatibility reads.
- Require explicit first publication and separate knowledge/channel readiness.

Exit criterion: every live answer references an immutable publication and can be reproduced after later edits within the configured audit-retention policy.

### Phase 2: Asynchronous sources

- Add object storage artifact lifecycle and signed uploads.
- Before enabling any source, add the applicable SSRF/egress, upload, raw scan, parser sandbox, post-parse PII/secret/injection classification, provider-admission, permission-revocation, and deletion-ledger controls.
- Add website discovery/crawl and initial file/spreadsheet support only behind those gates.
- Add BullMQ stage queues, transactional outbox/inbox, durable jobs, fencing, retry/DLQ/redrive, and reconciliation.
- Add parser/OCR benchmark and semantic element/chunk model.
- Add review queue for extraction, conflict, PII, and security exceptions.

Exit criterion: source processing is resumable/idempotent, safe failures preserve the active publication, and operators can diagnose/redrive without database surgery.

### Phase 3: Production retrieval

- Select a production multilingual embedding model through benchmark.
- Add sparse index, dense+sparse RRF, document grouping, reranker, parent expansion, and calibrated thresholds.
- Implement immutable Qdrant index snapshots, payload indexes, strict/private configuration, physical-collection snapshot pinning, and migration tooling.
- Route facts, rules, and live tools before document retrieval.
- Add claim-level citations and evidence UI.
- Enforce source ABAC, permission generation rechecks, untrusted rendering, and output DLP before customer-visible cutover.

Exit criterion: real ingestion-to-Qdrant retrieval passes per-language and high-risk gates and replaces all SQL/hash retrieval paths.

### Phase 4: Complete defense in depth, evaluation, and observability

- Build vendor-neutral eval runner with RAGAS/custom/model-judge adapters.
- Add tenant critical cases, change-based draft tests, adversarial suites, and publish gates.
- Add PostgreSQL RLS through the tested transaction-scoped Prisma boundary, support break-glass, expanded adversarial/privacy controls, and continuous deletion/permission reconciliation. This phase strengthens controls already required before Phase 2/3 exposure; it does not postpone minimum ingestion security.
- Complete end-to-end traces, bounded metrics, dashboards, SLOs, and burn-rate alerts.
- Add shadow/canary model/index/prompt migration flow.

Exit criterion: security invariants are hard gates, publication quality is measurable per slice, and incidents can be traced without exposing raw content by default.

### Phase 5: Connectors and learning loop

- Add prioritized help-center/drive/catalog/calendar connectors based on customer demand.
- Turn poor-answer feedback and unresolved conversations into reviewed knowledge-gap suggestions.
- Add freshness schedules by source/risk and permission-change webhooks plus reconciliation.
- Introduce optional LangGraph durable interview/review sessions with human interrupts.
- Add dedicated Qdrant placement and workload controls for large/regulated tenants.

Exit criterion: businesses maintain knowledge through source-of-truth sync and exception review rather than repetitive manual editing.

## 22. Default Product Decisions

These defaults remove ambiguity for implementation. They can be changed only through an explicit recorded decision.

| Topic                       | Default                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Product name                | Knowledge                                                                                                                |
| First-run method            | Website import, with guided interview/file/manual alternatives                                                           |
| First publication           | Explicit owner/admin approval                                                                                            |
| Auto-publish                | Off initially; later low-risk trusted-source changes only                                                                |
| High-risk approval          | Owner/admin, optionally designated manager by tenant policy                                                              |
| Live availability/status    | Authorized tool only                                                                                                     |
| Source editing              | Synced content read-only; explicit local override with precedence/expiry                                                 |
| Production vector store     | Qdrant                                                                                                                   |
| FAISS                       | Offline benchmark/dev only                                                                                               |
| Runtime orchestration       | Existing TypeScript LangGraph                                                                                            |
| AutoGen                     | Offline simulation/eval experiments only                                                                                 |
| Source of truth             | PostgreSQL; object storage for immutable artifacts                                                                       |
| Index                       | Rebuildable derived state                                                                                                |
| Retrieval                   | Structured facts/rules/tools first; dense+sparse RRF, rerank, parent expansion                                           |
| Evidence                    | Required internally for material claims; public citation only for public sources                                         |
| Missing/conflicting truth   | Clarify when scope can resolve it, otherwise hand off                                                                    |
| Publication consistency     | Capture one immutable publication per response                                                                           |
| Default product locale      | English                                                                                                                  |
| Knowledge locale behavior   | Same-locale preferred; configured safe fallback; never widen audience                                                    |
| Telemetry content           | Disabled by default                                                                                                      |
| External AI/data processors | Classification-specific admission gate; fail closed when terms, region, retention, or no-training policy is not approved |
| Delivery semantics          | At-least-once with database idempotency/fencing                                                                          |
| RLS                         | Defense in depth with non-owner runtime role and FORCE RLS                                                               |

## 23. Non-Obvious Cases That Must Be Designed and Tested

1. A price appears in a website paragraph and a spreadsheet with different tax treatment.
2. Two locations have different hours, but a page omits the location name.
3. A policy is valid next month while an old policy must answer until then.
4. A page is removed, then a delayed connector event tries to recreate it.
5. A connected source loses folder permission without deleting the document.
6. A translation changes prose but must not create a second canonical price.
7. A PDF table repeats no header on page two and OCR misreads a decimal separator.
8. A website returns a login page with HTTP 200 during sync.
9. A source includes hidden prompt-injection text or instructions inside an image.
10. A Qdrant timeout occurs after an upsert succeeded.
11. A timed-out worker continues after a retry publishes a newer generation.
12. A publication closes old vector ranges but crashes before pointer activation.
13. A rollback needs evidence that has passed normal cleanup age but remains inside rollback retention.
14. A customer asks in French while the only document is German and a verified structured fact is language-neutral.
15. A public reply uses an internal article whose title or URL itself is confidential.
16. A manager edits knowledge while an owner reviews the prior ETag.
17. A model judge upgrade makes quality appear better without any product change.
18. Synthetic evaluation questions reuse source wording and overestimate retrieval.
19. A thumbs-down reflects tone preference, not a factual error.
20. A conversation resolution is repeatedly successful but contains customer-specific data and must not auto-become business truth.
21. A tenant deletion removes PostgreSQL rows while vectors, caches, traces, or DLQ references remain.
22. A Qdrant outage allows exact business hours but not document explanation; degraded behavior must be intent-aware.
23. A calendar shows a slot during retrieval but it is taken before booking; execution must revalidate.
24. An old AI reply retry runs after a newer customer message and must not send out of order.
25. A source classification changes from public to internal; retrieval must deny it immediately before vector mutation finishes.

## 24. Acceptance Criteria for the First Production Slice

The first complete slice should support manual/guided structured knowledge plus one website or file source and satisfy all of the following:

- A fresh authenticated owner can enter required business facts, import one source, review evidence, run tests, and publish.
- Progress and errors survive navigation; no failed save appears successful.
- Create/edit/archive automatically produces a versioned job and never requires a hidden reindex endpoint.
- The active publication remains usable while a new draft processes or fails.
- Live reply, preview, and evaluation all call the same shared retriever.
- Every live answer audit includes publication, fact/rule/revision/chunk evidence, tool freshness, graph/prompt/model/retrieval versions, and gate outcome.
- Exact facts are not inferred from arbitrary chunks when typed truth exists.
- No-match, conflict, stale, and unauthorized cases abstain or hand off.
- Qdrant uses real evaluated multilingual dense+sparse retrieval, required payload filters, PostgreSQL hydration, and no plaintext credentials.
- Duplicate, stalled, timed-out, late, cancelled, and redriven jobs cannot publish stale data or duplicate tool effects.
- Tenant, source ACL, cache, permission revocation, injection, PII/secret, SSRF, malicious file, and deletion suites pass with zero hard-gate failures.
- Source previews, citations, imported metadata, and model output are escaped or sanitized under CSP and pass stored-XSS/Markdown exfiltration tests.
- Per-language critical retrieval/answer tests meet the configured floors.
- Playwright covers onboarding, Knowledge overview, source import, review, test, publish, edit conflict, failed job, rollback, and mobile layout.
- Dashboards show time-to-queryable, freshness, failure/review backlog, retrieval quality, answer gates, publication state, deletion lag, and dependency health.

## 25. Primary References

### Orchestration and retrieval

- [LangGraph JavaScript persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph JavaScript interrupts and idempotency](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [Qdrant hybrid and multi-stage queries](https://qdrant.tech/documentation/search/hybrid-queries/)
- [Qdrant hybrid retrieval with reranking](https://qdrant.tech/documentation/advanced-tutorials/reranking-hybrid-search/)
- [Qdrant multitenancy](https://qdrant.tech/documentation/manage-data/multitenancy/)
- [Qdrant collection aliases](https://qdrant.tech/documentation/manage-data/collections/)
- [Qdrant production checklist](https://qdrant.tech/documentation/production-checklist/)
- [Unstructured semantic chunking](https://docs.unstructured.io/open-source/core-functionality/chunking)
- [Docling chunking](https://docling-project.github.io/docling/concepts/chunking/)

### Evaluation

- [RAGAS paper](https://aclanthology.org/2024.eacl-demo.16/)
- [RAGAS metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)
- [ARES human-calibrated RAG evaluation](https://aclanthology.org/2024.naacl-long.20/)
- [Qdrant retrieval relevance](https://qdrant.tech/documentation/improve-search/retrieval-relevance/)

### Reliability and observability

- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [BullMQ retries](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled)
- [Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [AWS retry, timeout, backoff, and jitter guidance](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
- [OpenTelemetry sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)
- [Prometheus metric naming and labels](https://prometheus.io/docs/practices/naming/)
- [Google SRE multi-window SLO alerts](https://sre.google/workbook/alerting-on-slos/)

### Security and privacy

- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Qdrant security](https://qdrant.tech/documentation/operations/security/)
- [OWASP RAG Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html)
- [OWASP vector and embedding weaknesses](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)
- [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP file upload security](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Microsoft Presidio](https://microsoft.github.io/presidio/)
- [NIST AI RMF Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [GDPR official text](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
