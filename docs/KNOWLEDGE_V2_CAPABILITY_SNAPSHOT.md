# Knowledge v2 Capability Snapshot V1

## Scope

Capability Snapshot V1 applies to `STRUCTURED_V2` and target `workspace-v2`. It persists eight platform capability templates:

- general FAQ;
- lead qualification;
- pricing;
- appointment discovery;
- appointment booking;
- order/account support;
- commerce recommendation;
- regulated topics.

General FAQ starts enabled with `ANSWER_ONLY`; all other capabilities start disabled. Platform requirement definitions are immutable, versioned, and server-owned.

## Draft and serving state

- Draft readiness evaluates current capability settings against the exact candidate facts, guidance, documents, connectors, locales, and saved evaluation results.
- Serving readiness is reconstructed only from the active publication's persisted capability snapshots and requirement evaluations.
- A draft capability change never rewrites the active publication or its serving readiness.
- `GET /api/knowledge/v2/capabilities` returns current settings and the canonical capability-set hash.
- Owner/admin `PATCH /api/knowledge/v2/capabilities/:capabilityType` requires `If-Match` and `Idempotency-Key` and can change enablement or allowed autonomy.

A semantic change increments capability and draft generations, expires unpublished pending/passed validations, and revokes automatic replies bound to the prior capability set. Affected queued/running replies and conversation fences are invalidated in the same transaction.

## Evaluation and publication

The shared `knowledge-capability-snapshot-v1` evaluator deterministically handles fact, rule, document, connector, tool, permission, locale, and evaluation-case requirements. It records status, reason, evidence references, remediation, and canonical hashes for every requirement and capability.

Validation requires at least one enabled capability and no enabled blocker. Validation attempts remain separate historical rows. Their requirement evaluations are write-once for that validation.

Publication stores:

- `capabilitySetHash` and `requirementEvaluationSetHash` on validation and publication;
- one `KnowledgePublicationCapability` row per enabled capability;
- the exact autonomy, capability configuration hash, validation, and requirement evaluation hash used at publication time.

Activation re-evaluates current candidate evidence and rejects new blockers or changed capability configuration. It also rejects any mismatch between the publication and its stored validation/evaluation identities before switching the active pointer.

## Runtime

Automatic-reply activation binds the exact publication, publication ETag, capability-set hash, and channel fingerprint. Admission, retry, and delivery recheck those values.

Operational requirements are projected from the exact server-owned tool registry, supported executor bindings, permission generation, and only the provider connections used by supported executors. Publication and channel activation persist the resulting dependency and binding hashes. Permission, tool-registry, provider-capability, publication, or channel drift revokes authorization and fences queued/running work.

The structured worker classifies EN/RU/ES/FR/DE/PT customer intent into the published capability set. A disabled capability or explicit human-handoff request returns the localized handoff path without retrieval or model-provider execution.

The published `allowedAutonomy` value is enforced by one shared effect policy in both tool planning and execution. The supported product surface is intentionally limited to `ANSWER_ONLY`, `COLLECT_INFORMATION`, and `PROPOSE_ACTION`; commit actions remain denied because no server-owned confirmation or autonomous-action proof is available.

Every publication-bound successful reply run stores an immutable `AUTO_SEND` or `HANDOFF` disposition and exact reply-content hash. Handoffs additionally bind a versioned localized server template. Delivery accepts handoffs without grounded-answer evidence only when this immutable run outcome and exact content match; automatic answers still require the complete grounded audit. Final revalidation and the bounded provider send execute while the same transition locks are held, and a human message, assignment, status change, or handoff supersedes pending AI work first.

## UI

Knowledge Overview shows published serving capabilities separately from editable draft controls. Owner/admin controls use switches and autonomy selectors with per-row saving, success, conflict, retry, and error states. Viewer roles remain read-only. The surface is localized across EN/RU/ES/FR/DE/PT and covered at desktop and mobile widths.

## Remaining work

- Add server-owned confirmation receipts and autonomous-action approval policy before exposing `ACT_WITH_CONFIRMATION` or `AUTONOMOUS_ACTION`.
- Add provider-backed executors and permission models for the registry entries that intentionally remain unsupported.
- Extend persisted capability targeting beyond `workspace-v2` and expose reviewed tenant additions that can strengthen, but never weaken, platform requirements.
- Extend classification and evaluation to compound questions that require multiple capabilities.

## Verification

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public'
$env:REDIS_URL='redis://localhost:6380'
$env:AI_REPLY_MODE='queue'
corepack pnpm run qa:knowledge:v2:capability-snapshot-migration
corepack pnpm run qa:knowledge:v2:validation-history-migration
corepack pnpm --filter @leadvirt/knowledge qa:capability-intent
corepack pnpm --filter @leadvirt/knowledge qa:capability-snapshot
corepack pnpm --filter @leadvirt/knowledge qa:capability-runtime-evidence
corepack pnpm --filter @leadvirt/knowledge qa:capability-autonomy
corepack pnpm run qa:knowledge:v2:capability-api
corepack pnpm run qa:knowledge:v2:capability-runtime
corepack pnpm run qa:knowledge:publication
corepack pnpm run qa:channel:automatic-replies
corepack pnpm run qa:ai:structured-reply
corepack pnpm run qa:channels:structured-delivery
corepack pnpm exec playwright test artifacts/playwright/knowledge-workspace.spec.ts --grep "capability controls" --reporter=line
```
