# Decision Log

## 2026-07-18: Request Managed Integrations Without Inventing Connectivity

Decision: Non-self-serve integrations accept an owner/admin connection request, notify a monitored operator recipient, and expose only the durable requested state. Requests serialize per tenant and provider, preserve any historical integration status/settings, and may be submitted again only after the requested lifecycle is explicitly cleared.

Context: Planned integration cards previously explained manual setup but offered no working action. A naive request upsert could send duplicate emails under concurrency or overwrite existing integration evidence.

Consequences:

- `ExternalOperation` is the durable delivery authority; `IntegrationAccount.settings` projects the current client-visible request lifecycle, while audit events remain evidence.
- The serialized transaction persists the integration request and a unique lifecycle reference before a dispatcher sends email outside the transaction.
- A claimed or ambiguous delivery is never resent automatically. SMTP uses a deterministic message ID for the persisted lifecycle, and UniSender receives a unique `ref_key` for each renewed request.
- Client state distinguishes pending delivery, confirmed delivery, and an ambiguous outcome that requires manual review; a synchronous wait timeout is durably fenced as unknown before the API responds.
- Requests require a reachable non-internal user email or saved user/business phone. Terminal delivery evidence retains identifiers and provider references but removes the operator recipient, message body, and requester contact details.
- Production readiness requires an explicit valid `INTEGRATION_REQUEST_EMAIL`; the request fails closed instead of falling back to the sender mailbox.
- Telegram and Webhook/API remain the only self-serve integrations; a request never presents another provider as connected.

## 2026-07-18: Expose Only Verifiable Product Actions And Plan Benefits

Decision: Product actions, analytics recommendations, onboarding promises, and pricing benefits are shown only when the current runtime can execute or verify them. Demo content follows the same Telegram/website-widget pilot boundary.

Context: Several controls implied CRM sync, bookings, tasks, downstream automation, advanced analytics, or service guarantees that had no provider-backed implementation.

Consequences:

- Lead actions follow the implemented pipeline state machine and stop after qualification or closure.
- Public and account pricing retain only shared numeric limits and implemented basic analytics.
- Demo channels, business information, operational labels, and readiness remain localized without rewriting live customer content.

## 2026-07-18: Keep Mobile Setup Paths Explicit

Decision: On compact screens, multi-section settings use one labeled selector that always exposes the active section. First-run product surfaces show the next setup action before diagnostics or explanatory empty states.

Context: Deep-linked Settings sections could be active outside an invisible horizontal tab strip, an empty Inbox had no route to channel setup, and Integrations placed readiness diagnostics before the cards needed to resolve them.

Consequences:

- Desktop navigation remains unchanged while mobile Settings avoids hidden active tabs.
- Empty Inbox state links directly to Integrations.
- Integration setup cards precede readiness diagnostics, and compact Knowledge metrics use a stable two-column grid.

## 2026-07-18: Keep Live Customer Content Verbatim

Decision: Locale switching may translate only system labels and records carrying the reserved demo identity. Names, requests, messages, manager-entered values, and exported transcripts from a live workspace remain exactly as stored.

Context: The six-locale demo catalog is intentionally based on exact fixture phrases. Applying it through shared API adapters without a demo boundary could silently translate a real customer message that happened to match a common fixture value such as `Consultation`.

Consequences:

- Demo seed localization is gated by reserved demo tenant or entity identity.
- Stable event types, activity codes, and explicit system source labels remain locale-aware in every workspace.
- Unknown or customer-authored content is never inferred, translated, or rewritten by the UI.

## 2026-07-18: Describe Only The Available Pilot

Decision: Public acquisition copy describes the current self-service pilot: Telegram and website widget intake, answers from published Knowledge, Inbox and lead capture, operator handoff, analytics, and explicit Webhook delivery. It does not promise provider-backed bookings, reminders, inventory, order status, estimates, or direct CRM completion until those boundaries exist.

Context: The primary landing copy had been made truthful, but the hero status chips and industry examples still implied unavailable downstream actions. Demo readiness also linked guests into the protected app, and selected pricing intent remained invisible during signup.

Consequences:

- Hero and industry examples end in a captured request, Inbox review, operator handoff, or Webhook handoff instead of fabricated completion.
- Demo readiness actions retain `/demo` routing and never redirect a guest to login.
- Signup visibly confirms the selected plan and provides a direct way to change it before authentication.

## 2026-07-18: Keep Business Information Canonical

Decision: Business Information in Knowledge is the only editor for business identity, type, description, and timezone. Settings shows those fields read-only and edits only workspace logo and contact details.

Context: Two editors exposed different business-type and timezone choices and could overwrite the same canonical profile with stale or incomplete values.

Consequences:

- Business-profile writes retain their ETag-fenced workflow in Business Information.
- Settings contact and logo writes omit canonical business fields and do not require the profile ETag.
- Settings links directly to the canonical editor in app and demo modes.

## 2026-07-18: Share One RUB Billing Catalog

Decision: The public pricing page, billing API, and demo runtime derive plans from one catalog in `@leadvirt/types`. Until a global currency strategy is implemented, published prices and invoices are explicitly Russian rubles (`RUB`).

Context: Public, API, and demo prices and limits had diverged, and the Corporate price wrapped its currency onto a separate line.

Consequences:

- Plan codes, prices, limits, and popularity cannot drift between the three surfaces without changing the shared catalog.
- Public prices use locale-aware number formatting with an explicit `RUB` code.
- Operational lead values preserve their own currency and mixed-currency pipeline totals are never summed together.

## 2026-07-18: Preserve The First Customer Request

Decision: Telegram, webhook, and website-widget intake stores the first shortened inbound message as the lead's customer request. Later messages update the conversation but do not overwrite that request.

Context: The UI called the field a service even though intake continuously replaced it with raw message text. Removing the value entirely would also break request visibility because no automatic lead-classification writer exists yet.

Consequences:

- Operational UI labels the field as Customer request and falls back explicitly when it is unavailable.
- The conversation remains the source for the latest message.
- A future classifier or a manager can refine the lead request through the normal lead update path without later inbound messages undoing it.

## 2026-07-18: Keep Onboarding Canonical, Protected, And Truthful

Decision: `/onboarding` is the single auth-gated onboarding route. It preserves only an allowlisted acquisition plan through login or signup, records requested channels and CRM preferences without claiming unavailable integrations are connected, and describes completion as saved initial setup. The next real action is Billing when a plan was selected and Knowledge otherwise; `/app/onboarding` redirects to the canonical route.

Context: Two onboarding URLs could diverge, an expired session lost acquisition intent, planned integrations looked selectable as if available, and the final screen claimed the AI administrator was ready before business information, publication, channel connection, and inbound evidence were complete.

Consequences:

- Children do not load onboarding state until the current session passes the shared auth check.
- Only the canonical route interprets acquisition intent; malformed plans are removed before auth and routing.
- Selecting a requested or planned integration saves intent only and never counts as a live connection.
- Onboarding completion hands the customer to the next verifiable setup step instead of claiming automatic replies are ready.
- Progress, selection state, required fields, save activity, and mobile navigation expose accessible semantics.

## 2026-07-18: Deliver Manual Billing Requests Before Confirming Them

Decision: A manual plan selection succeeds only after LeadVirt sends an operational email containing the workspace, requested plan, and available requester contact details. The request is then stored as an audit record. Subscription state and limits remain unchanged until an operator activates the plan, and the API returns no invoice rows without actual invoice or payment evidence.

Context: The first manual billing flow stored only an audit row while the UI promised follow-up, so nobody outside the customer workspace received the request. It also derived three paid invoices from a subscription period without any payment record. Suspended and cancelled workspaces could read Billing but could not submit the new reactivation request.

Consequences:

- `BILLING_REQUEST_EMAIL` is the preferred recipient; an already configured SMTP/UniSender sender account is the fallback.
- Production never accepts mock operational delivery; it chooses the first ready real provider from `EMAIL_PROVIDER` and `EMAIL_OTP_PROVIDER`.
- Delivery failures return an error and create no successful plan-selection audit record.
- `POST /api/billing/plan-selection` remains available to inactive tenants with owner/admin authorization.
- Billing history stays empty until the data model contains authoritative invoice or payment evidence.

## 2026-07-17: Preserve Pricing Intent Through Auth And Manual Billing

Decision: Public plan CTAs authenticate before onboarding, preserve only allowlisted plan and return destinations, and hand the selected plan to Billing after successful onboarding. Billing records an auditable manual activation request and never creates an active subscription without a real checkout or operator confirmation.

Context: Anonymous CTAs opened a protected onboarding page, the selected plan was lost, production could return an empty catalog, and the UI described absent subscriptions as unlimited. Corporate also fell back to an email addressed to `noreply`.

Consequences:

- `start`, `pro`, `business`, and `corporate` are the only accepted acquisition plan aliases; malformed or external return destinations fall back safely.
- The server-owned catalog is available independently of optional database seed rows.
- A plan request keeps the current subscription unchanged, reports that checkout is unavailable, and requires manual confirmation.
- Corporate uses the same request flow unless an explicit `NEXT_PUBLIC_CORPORATE_CONTACT_URL` is configured.

## 2026-07-17: Derive Client Readiness From Verified Structured State

Decision: Dashboard owns one seven-step launch journey derived from current API evidence. Structured services and enabled working days are required for profile readiness; legacy text notes cannot replace them. Technical and unavailable controls stay outside primary client navigation.

Context: Business Profile, Knowledge, channels, automatic replies, and inbound tests exposed separate and sometimes contradictory states. Raw audit events, public keys, server IPs, inactive API keys, and planned integrations competed with the next client action.

Consequences:

- Unknown API evidence is labeled as needing verification instead of being treated as complete or empty.
- The first unresolved step is the single primary action; later steps remain visible for orientation.
- Business Profile surfaces repair actions and note/structure conflicts before customer replies are considered ready.
- AI audit, inactive API keys, infrastructure IPs, and raw readiness identifiers are not shown in the main client workflow.
- Planned integrations remain discoverable through a collapsed section and do not inflate the available count.

## 2026-07-17: Keep Automation Builder Actions Truthful And Reviewable

Decision: New Automation slots use neutral workflow names, the builder offers only executable condition and manager-handoff steps, and every duplicated workflow is created `PAUSED` for review instead of being published automatically.

Context: The three named template tabs produced the same generic workflow, the add-step action silently added only a manager handoff, and copying an active workflow immediately made a second live automation. The UI also exposed a nonfunctional drag handle, workflow run IDs, and archived workflow versions.

Consequences:

- Managers explicitly choose each available runtime step and can still remove unsupported legacy steps.
- A copied workflow cannot begin processing inbound messages until a manager reviews, enables, and saves it.
- Client-facing test and archive feedback no longer exposes internal run IDs or workflow versions.
- Mobile controls use stable touch targets and the workflow canvas no longer animates through newly displayed blocker notices.

## 2026-07-16: Keep AI Identity Behind The Active Publication

Decision: Business Profile writes may update workspace metadata immediately, but Structured V2 AI generation resolves business name and type only from the active `workspace-v2` publication. If the active publication has no identity facts, AI receives a neutral identity. Legacy V1 retains its existing Tenant-based behavior. Profile synchronization commits before dispatch; a failed immediate dispatch is logged and left to the existing durable outbox drain instead of returning a false failed-save response.

Context: The editable Tenant identity is also used by the product shell, while Structured V2 facts remain drafts until review and publication. Reading live Tenant fields in AI generation bypassed that boundary. Immediate outbox dispatch can also fail after the database transaction has committed, making Settings and onboarding appear to fail even though retrying with the old ETag cannot be correct.

Consequences:

- Conversations, webhook, widget, and worker AI paths share one publication-backed identity resolver.
- Draft name/type changes cannot reach customer AI responses before publication.
- Committed profile writes return their committed state; pending outbox events remain observable and retryable.
- Settings and onboarding carry the profile concurrency token in their response body rather than misusing it as the ETag for the complete composite representation.
- Existing fallback-only profiles reconcile on the next profile/scenario write; a separate one-time rollout backfill is tracked for tenants that must reconcile without user action.

## 2026-07-16: Keep Business Profile UI Mutations Scoped

Decision: The Business Profile editor submits a field-level partial patch against its normalized baseline. A weekly schedule is sent as a normalized seven-day snapshot only when the user changes the schedule. Settings and onboarding keep a profile ETag bound to the exact hydrated form and advance it only after that form's profile save or a full reload. Logo-only Settings writes update shared account state without rehydrating unrelated local form fields. Demo exposes the profile through its own read-only `/demo/knowledge` route.

Context: Expanding sparse schedules for display made an unrelated edit persist every missing day as explicitly closed and changed AI hours evidence. A logo response could replace unsaved input or carry a newer ETag over stale fields; onboarding completion and navigation responses had the same token-laundering risk. The demo Settings link also left the local demo for protected `/app`.

Consequences:

- Absent and partial schedules retain their stored meaning until the user intentionally edits schedule controls.
- Idempotency signatures cover the exact partial profile patch sent to the API.
- Logo upload/removal preserves the current unsaved Settings draft.
- Logo, workflow, completion, and navigation responses cannot authorize a stale profile overwrite; a concurrent profile edit returns `412` until explicit reload.
- Demo navigation and Settings remain inside the local demo runtime and expose the populated profile without edit permissions.

## 2026-07-16: Make Business Profile The Canonical Editable Aggregate

Decision: Business identity and operating details are edited through one canonical Business Profile aggregate stored with onboarding data and a dedicated revision/ETag. The Business Profile API, Settings account fields, and profile-affecting onboarding steps use the same transaction and optimistic-concurrency boundary. Structured services and weekly schedules are canonical; legacy Knowledge text is a deterministic compatibility projection. Structured V2 projections remain drafts and still require explicit review, test, and publication.

Context: Business details were split across onboarding, Settings, legacy Knowledge sources, and advanced fact editors. A successful onboarding flow could therefore leave the Knowledge Sources screen looking empty, and independent edits could silently overwrite one another or publish data without the normal governance flow.

Consequences:

- `GET/PATCH /business-profile` exposes the authoritative profile with a strong ETag; patches require `If-Match` and an idempotency key.
- Settings and the business/company onboarding steps reuse that revision. Logo-only and navigation-only updates remain narrow writes and do not mutate the profile revision.
- A `412` preserves the local draft until the user explicitly reloads the authoritative profile; retryable failures reuse the same mutation identity.
- Knowledge opens the customer-oriented profile editor first. Existing fact and language controls remain available as advanced tools.
- Updating the profile advances draft Knowledge state but never bypasses review, testing, approval, or publication.

## 2026-07-16: Make Remote Deployment Completion Explicit

Decision: The remote wrapper consumes the complete heredoc before executing it from an argument, passes a run token positionally, clears any inherited export attribute before assigning it, and accepts the SSH step only after observing the matching release-SHA/token completion marker. Compose wrappers and child deployment scripts also detach fd 0 from `/dev/null`.

Context: The workflow streams a remote Bash program over SSH stdin. `docker compose run -T` disables TTY allocation but remains interactive, so repeated dependency probes consumed the rest of that program while ClamAV initialized. Remote Bash then reached EOF after a successful probe and returned zero before candidate preflight, journal creation, drain, migration, or release activation; GitHub reported a false-successful deploy.

Consequences:

- The inner deployment program starts only after SSH stdin is exhausted, so no child can consume unparsed deployment code. Compose, pre-gate helpers, and every installed-journal call additionally receive `/dev/null`.
- A zero SSH exit without the final marker fails the GitHub step instead of masquerading as a complete deployment.
- The token is a run-correlation nonce against accidental truncation, not a trust boundary against code already executing as the deploy user.
- The marker is emitted only after commit, roll-forward health checks, journal clearing, pruning, and archive cleanup.
- Release readiness verifies all four Compose wrappers, exercises the stdin-drain regression, and locks marker ordering.

## 2026-07-16: Pin Production ClamAV To A Verified Digest

Decision: Production uses the patch-compatible full `clamav/clamav:1.4.5` runtime image pinned to its verified OCI index digest and explicitly targets `linux/amd64`. Scanner provenance reports `clamav-1.4.5`.

Context: Docker Hub no longer exposes the configured `1.4.2` tag. Verify passed, but deployment failed before candidate preflight while Compose tried to start stateful dependencies. The production host is `linux/amd64`, and the exact 1.4.5 digest is available and preserves port 3310 plus `/var/lib/clamav` volume compatibility. No ClamAV Compose container exists on the host, so the next `--no-recreate` start will create the pinned image instead of retaining an older daemon.

Consequences:

- Releases no longer depend on resolution of the removed tag or on a mutable ClamAV tag.
- The existing persistent signature volume and full runtime startup behavior remain unchanged across the patch update.
- Release readiness locks the exact digest; changing ClamAV requires an explicit manifest verification and test update.
- Remaining stateful images still need digest pins and provisioning-time pulls.

## 2026-07-16: Isolate The Deployment Environment Validator

Decision: The production staging-env validator runs before journal installation in a digest-pinned Node 24.18.0 container, not in the VPS host runtime. The one-shot container uses the deploy UID, no network, a read-only root, no capabilities or privilege escalation, bounded resources, and read-only binds for only the validator file and production env file.

Context: Verification passed, but the first real deployment failed before validation because the VPS intentionally had no host `node` executable. The validator is a standalone standard-library script and does not require the application image, Compose network, release tree, or secrets directory.

Consequences:

- Deploy behavior no longer depends on a host Node installation or host PATH.
- Production secrets are readable only through one file mount and are not copied into the image, passed through `--env-file`, or attached to a networked container.
- Invalid files or configuration still fail before journal creation, builds, migrations, drain, or promotion.
- VPS provisioning should cache and verify the pinned image so registry availability is not part of the release critical path.

## 2026-07-16: Keep Secret Queries Outside Processor Admission

Decision: Knowledge diagnostic queries use `SENSITIVE` processor admission and its personal-data minimization. `SECRET` remains categorically denied before query embedding, reranking, Qdrant access, or any external processor call. Acceptance policies grant the deterministic local provider only the matching `SENSITIVE` ceiling.

Context: The diagnostic endpoint labeled every query `SECRET`, while processor-query admission intentionally rejects that classification. Mocked diagnostic tests hid the contradiction, so the real fresh-owner retrieval could never run regardless of tenant reranker policy.

Consequences:

- Diagnostic retrieval can exercise the real structured runtime while retaining minimization for personal identifiers.
- Secret-bearing queries remain fail-closed and cannot be enabled by widening a tenant policy or environment ceiling.
- Diagnostic contract tests assert `SENSITIVE`, while the dedicated processor-admission smoke continues to assert that `SECRET` is denied.

## 2026-07-16: Persist Publication Blockers Before Requiring Index Evidence

Decision: Publication validation records a blocked draft as `FAILED` without requiring an index snapshot when projection blockers prevented preparation. A document-bearing validation still requires an exact READY snapshot whenever preparation occurred or the transaction observes no blockers.

Context: Fresh-owner validation correctly skipped index preparation for a missing tenant default scope, but the transaction then unconditionally required a snapshot and converted the actionable blocker into a misleading reconciliation `503`.

Consequences:

- Clients receive exact readiness blockers as a successful validation resource instead of a false dependency outage.
- Blocked drafts do not create unnecessary Qdrant snapshots.
- The transaction remains fail-closed if blockers disappear after preflight or a prepared snapshot cannot be authorized.

## 2026-07-16: Contain Horizontal Tabs At Their Scroll Boundary

Decision: Horizontally scrollable tab rows own their overflow inside a width-constrained viewport. The viewport may scroll on the x-axis, but its page wrapper clips propagated x-overflow and the shared `scrollbar-none` class has explicit Firefox and WebKit behavior.

Context: Linux Chromium measured the `390px` Knowledge mobile page at `394px` while Windows Chromium remained at `390px`. The only intentional oversized descendant was the Knowledge tab row, whose `min-w-max` content depended on an undefined scrollbar utility and lacked explicit inline containment.

Consequences:

- Knowledge tabs remain horizontally scrollable without widening the document or exposing a platform-specific scrollbar.
- The tab viewport is explicitly `min-w-0`/`max-w-full`; its row spans at least the viewport and grows only inside that scroll boundary.
- Mobile acceptance keeps the strict document-width assertion rather than tolerating platform-specific overflow.

## 2026-07-16: Pin Browser QA To The Workspace Toolchain

Decision: Browser QA uses a lockfile-pinned root `@playwright/test` dependency and `pnpm exec playwright`. CI explicitly installs Chromium and its Linux dependencies from that same version before acceptance.

Context: The deploy gate invoked floating `pnpm dlx @playwright/test` commands without installing their matching browser. A runner with no cached revision failed every browser-backed test before application code ran.

Consequences:

- Test runner and Chromium revisions remain aligned across local and CI environments.
- Acceptance no longer depends on GitHub runner browser cache state or the latest registry version at command time.
- CI pays an explicit browser-install cost before tests instead of failing late in acceptance.

## 2026-07-16: Resolve Cross-Platform Smoke Paths On The Host

Decision: Smoke fixtures that require absolute filesystem paths derive them with the host `node:path` implementation instead of embedding a Windows or POSIX root.

Context: The review-decision fixture used `C:\\leadvirt-review-decision-smoke`. It passed local Windows admission, but Linux correctly treated it as relative and rejected source synchronization as unconfigured before `CORRECT_SOURCE` could run.

Consequences:

- Local and Linux CI exercise the same source-action behavior.
- Production absolute-path validation remains unchanged and fail closed.
- Fixture portability no longer depends on the developer operating system.

## 2026-07-16: Test Live Idempotency Claims Separately From Stored Replays

Decision: The Knowledge v2 idempotency smoke deterministically verifies a retryable conflict while an identical claim is `IN_PROGRESS`, then verifies the stored replay only after the winning request completes.

Context: Claim creation and mutation run in separate advisory-lock transactions. A naked concurrent `Promise.all` could therefore produce either a valid live-claim `409` or a completed replay depending on scheduler order, making Linux CI disagree with faster local runs.

Consequences:

- Production keeps returning `409 KNOWLEDGE_CONFLICT_IDEMPOTENCY_IN_PROGRESS` with `retryable: true` for a live identical claim.
- Completed identical requests still replay the stored response without repeating mutation effects.
- The required Phase 0 gate no longer depends on operating-system scheduling.

## 2026-07-16: Keep Phase 0 QA On Serving-Eligible Structured Fixtures

Decision: Required Phase 0 checks use only supported Structured V2 publication, capability, query-hash, and snapshot-authorization contracts. The obsolete legacy graph smoke is removed from the release gate, and the grounded publication suite runs once through its canonical command.

Context: After the deployment-journal and AI quality fixes, CI exposed fixtures that manually created response hashes, query identities, rollback manifests, and `READY` snapshots using retired contracts. Production correctly rejected those fixtures. Bypassing the checks would hide real serving requirements.

Consequences:

- Production automatic-reply, rollback, and snapshot admission remain fail closed.
- Manual Structured V2 snapshots must insert exact membership, build the versioned authorization manifest from that membership, and only then transition from `PREPARING` to `READY`.
- Legacy publish/retrieve behavior remains covered directly, but only serving-eligible Structured V2 fixtures may exercise automatic replies.
- The grounded evaluation/publication suite remains available through both package aliases for compatibility, but deploy invokes it once.

## 2026-07-16: Bind The Required AI Gate To Structured Runtime Contracts

Decision: The required `qa:ai:quality` deployment gate composes the AI reply reliability and Structured V2 reply suites. The legacy golden-set harness is removed from the deploy path until it uses the same structured publication, capability, operational binding, channel activation, and durable outbox contracts as production.

Context: Strict automatic-reply admission correctly rejected the legacy harness because it created an unactivated channel, published only a legacy `workspace` corpus, and fabricated runtime event identity. Allowing a test-only bypass would weaken the production fence, while the required structured reply and reliability suites already exercise the current contract.

Consequences:

- Production automatic-reply admission remains fail closed and unchanged.
- Reliability and Structured V2 reply coverage run once in the dedicated quality step instead of being duplicated later in the workflow.
- The legacy niche golden set remains migration input, not release evidence. Restoring retrieval metrics and sanitized golden-set reports requires a production-representative Structured V2 harness and is tracked as incomplete work.

## 2026-07-15: Activate Password Reset Tokens Only After Delivery

Decision: Production credential recovery uses only a ready SMTP or UniSender provider and a reset origin that exactly matches the deployed frontend origin. A token is staged as unusable, then activated only after provider acceptance and credential-state revalidation under the shared per-user PostgreSQL lock.

Context: Returning a reset URL or treating mock/manual delivery as successful could expose production credentials. Creating a usable token before a provider attempt left an authentication artifact behind when delivery failed; concurrent accepted requests could leave multiple links active; and a delivery already in flight could activate after another reset or authenticated password change completed. Coupling the request audit to activation also made an already delivered link unusable when only the audit insert failed.

Consequences:

- Production mock, manual, unsupported, and incomplete providers fail before token creation. Non-production mock retains token-bearing responses and logs for local QA.
- SMTP and UniSender send the reset link through the shared delivery abstraction. Provider errors are sanitized; the public response remains generic and the staged token remains unusable.
- Activation, reset confirmation, and authenticated password changes take the same advisory and user-row lock. Activation reloads the user and requires the password hash captured before delivery to remain unchanged.
- Accepted requests serialize activation per user, invalidate earlier active links, and activate exactly one token. The request audit is attempted after activation and cannot roll back an accepted link; a sanitized operational error records audit failure.
- Production `APP_URL` and `NEXT_PUBLIC_APP_URL` must be matching public credential-free HTTPS origins without path, query, or hash. Production responses and logs contain no reset URL.
- Reset requests have a normalized one-minute recipient cooldown, an eight-per-hour recipient limit, and a per-IP limit. Delivery remains synchronous, so generic wording and these limits do not remove the account/provider latency oracle; durable asynchronous delivery is tracked separately.

## 2026-07-15: Give Each Frontend Resource One Mutation Owner

Decision: Each mutable frontend resource has one in-browser owner that serializes conflicting writes and reconciles failures against the authoritative API response.

Context: Overlapping optimistic locale, Pipeline, and Team requests could complete out of order. A stale failure rollback could overwrite a newer customer choice, while concurrent membership actions could bypass self-protection assumptions or leave the screen inconsistent with the server.

Consequences:

- Locale persistence coalesces queued changes to the latest selection while `CurrentUser` updates optimistically.
- Pipeline updates serialize per lead, preserving concurrency between different leads. Team membership changes serialize across the roster and reject self-demotion or self-removal in the UI before submission.
- A failed request re-fetches or applies authoritative state only while it still owns that resource; it never restores an older optimistic snapshot over a newer action.

## 2026-07-15: Synchronize Development QA On Semantic Readiness

Decision: Protected-route Playwright tests wait for `domcontentloaded` with a 45-second navigation ceiling, then wait on a route-specific semantic ready element with a 15-second baseline. Multi-route suites may raise their aggregate or semantic bound while keeping the same synchronization model.

Context: Measured Next development cold compilation regularly exceeded Playwright's default five-second assertion window and occasionally approached the default navigation timeout. `networkidle` and loader text describe transport activity, not whether the tested product state is ready.

Consequences:

- Tests synchronize on stable product elements and keep assertions about the actual behavior under test.
- Suites that intentionally visit several cold routes receive an explicit aggregate budget instead of inheriting a timeout that cannot cover their route count.
- The web development command uses an 8 GB Node heap ceiling. Next 15 restarts the dev child at 80% of its heap limit; the default ceiling was reached during the full route suite even while the host still had ample free memory.
- These development-only bounds absorb compilation variance; they are not a production navigation or performance budget.

## 2026-07-15: Treat Telegram Bot Replacement As An Identity Cutover

Decision: A replacement bot receives a fresh secret bound to its bot ID. Connect, disconnect, health, and the complete inbound pipeline share the same workspace/bot advisory-lock boundary; only the active secret may process updates.

Context: Reusing one secret let a delayed update from the retired bot pass after the channel identity changed, minting evidence for the wrong bot. Accepting a staged secret also allowed traffic before credentials and bot identity were atomically promoted.

Consequences:

- Pending-secret traffic returns a retryable cutover response before claim or persistence. Retired and unknown secrets return unauthorized.
- Active, pending, and retired bindings store explicit bot IDs. Incomplete or same-secret legacy retirement state fails closed until forced cleanup succeeds.
- Retired bot webhooks are deleted with `drop_pending_updates=true` and are never restored; active disconnect retains its drain-aware behavior.
- Webhook update and message identifiers include the active bot ID. Queue admission rejection completes the AI stage without a queued lead event or fallback enqueue.
- Message recency is the deterministic `(createdAt, id)` tuple in Telegram writes, conversation history/previews, and lead previews.

## 2026-07-15: Bind Knowledge Cutover To Snapshot And Runtime Policy Identity

Decision: Legacy-to-structured cutover validates the exact raw content hash, inherited scope generation/hash, snapshot-specific authorization manifest, and approved runtime processor-policy versions. Publication capability evaluation runs only after index preparation.

Context: Canonical content hashing could disagree with the migrated raw value; inherited scope was not fully represented in cutover validation; chunk point IDs were incorrectly compared with publication snapshot point IDs; and a pre-index capability baseline or hard-coded policy label could authorize a different runtime than the published one.

Consequences:

- The forward PostgreSQL migration enforces snapshot-specific cutover identities without weakening existing guards.
- Publication and activation reject scope, authorization, retrieval-policy, or prompt-policy drift.
- Final grounded citations and gate outcome populate the retrieval metadata used by acceptance and operational audit.
- The coordinated clean migration/publication/cutover/grounded-delivery acceptance passes end to end.

## 2026-07-15: Present One Operational Surface Per Channel

Decision: Each live channel has one customer-facing connection authority. Telegram connection lifecycle lives in Integrations; Website and Webhook/API configuration lives in Settings > Channels; Webhook endpoint inspection may be repeated elsewhere but mutations may not be.

Context: Settings offered a generic Telegram status toggle that could not register or remove the provider webhook. Integrations offered Webhook source, sync, and notes controls that the API intentionally discarded. Channel list failures also appeared as disconnected providers with active controls.

Consequences:

- Telegram rows link to Integrations and have no generic connection toggle. Dedicated automatic-reply activation remains available for an already connected channel.
- Website and Webhook/API are the only Settings rows with direct connection toggles; non-live providers show coming-soon state without no-op controls.
- Webhook endpoint details and internal sample remain visible in Integrations, while target, authentication, secret, and lifecycle changes route to Settings.
- Loading and failed channel reads expose no connection actions; retry is explicit and stale absence is never presented as authoritative.

## 2026-07-15: Resume Webhooks By Fenced Stage, Not Whole-Attempt Replay

Decision: Webhook receipt evidence is immutable, processing ownership uses a separate expiring token, and Telegram retries resume durable intake, AI-dispatch, and workflow-dispatch stages. Message-triggered workflows use a unique event key and execute their supported database effects in one transaction.

Context: A `FAILED` event restarted the whole Telegram handler, so a later workflow failure could replay an already queued AI reply. A long-running `RECEIVED` event also used its original receipt time as the stale-claim clock, allowing another request to steal an active attempt. A crash after a workflow commit but before webhook finalization could create a second workflow run, audit, lead event, and usage charge.

Consequences:

- `receivedAt` remains authentication evidence; `processingAttempt`, `leaseToken`, `leaseAcquiredAt`, and `leaseExpiresAt` govern ownership independently.
- Stage completion renews the current lease, and every stage/final transition is conditional on its token. An expired owner may finish local work but cannot publish state.
- Telegram inline AI sending is removed; intake persists the queue request, and a retry skips a completed AI stage.
- Workflow retries return the existing terminal run for the same event/input. Supported workflow effects, events, audit, lead projection, usage, and terminal status commit atomically.

## 2026-07-15: Keep Telegram State Inside One Managed Lifecycle Boundary

Decision: Telegram connection state changes only through the integration connect, test, and disconnect lifecycle. Each operation is serialized first by workspace and then by sorted provider bot identities.

Context: Generic channel mutations could mark Telegram active or disabled without registering or removing the provider webhook. Per-bot connect locking prevented two workspaces from claiming one bot, but did not serialize different-bot replacements in one workspace or a health repair racing disconnect. Managers could also change write-only Webhook/API outbound targets and credentials through the broader channel patch permission.

Consequences:

- Generic Telegram create and status/settings updates fail with guidance to use Integrations; harmless display-name updates and dedicated automatic-reply controls remain separate.
- OWNER/ADMIN authorization is rechecked from the patch payload before any Webhook/API outbound target, authentication, timeout, or removal is persisted.
- Telegram connect, replacement, cleanup, health repair, and disconnect hold one workspace lock and all relevant active, candidate, and retired bot locks across remote and local state changes.
- A test queued behind a completed disconnect reports disconnected without calling Telegram or reviving retained reconnect credentials.

## 2026-07-15: Treat Channels As Connection Authority And Expose Only Live Integrations

Decision: Telegram and Webhook/API connection state comes from a fully configured active channel. Every other catalog provider is non-operational until it has a live provider adapter.

Context: `IntegrationAccount.status` could drift from channel state, block a working Webhook sample, or claim success without an endpoint. Several request/coming-soon providers still accepted direct API calls that wrote or tested only local rows.

Consequences:

- Webhook connect and test reconcile against an active channel, samples ignore stale companion status, disconnect disables the channel, and incomplete public keys or secrets fail closed.
- Integration metadata cannot mutate channel settings outside the channel update path that validates outbound configuration and fences automatic replies.
- CRM, social, Email inbox, Calendar, commerce, and custom providers return stable non-retryable unavailability before persistence; legacy rows remain redacted for recovery.
- Transactional email authentication remains a separate SMTP/UniSender subsystem.

## 2026-07-15: Key Telegram Intake By Bot And Message Identity

Decision: Telegram bot ownership is serialized globally by the provider bot ID, while inbound side effects are keyed by the channel-scoped update claim and normalized Telegram message ID.

Context: Telegram may retry one update while its first request is still running, deliver an edit under a new update ID, or receive two simultaneous attempts to connect one bot to different workspaces. Prematurely acknowledging in-progress work can lose a later failure; treating every update ID as a new message can duplicate AI/workflow effects; and Telegram permits only one webhook per bot.

Consequences:

- An update claim still in `RECEIVED` returns a retryable service failure so Telegram keeps retrying; processed replays remain successful duplicates and stale/failed claims remain resumable.
- A new update ID for an already persisted message cannot repeat AI or workflow effects. `edited_message` replaces that message's persisted text and raw evidence without producing a second reply.
- Late message delivery preserves the greatest conversation/lead activity timestamp, and Inbox reply-needed state is derived from the latest message direction rather than any open status.
- Per-bot database advisory locking makes the duplicate-workspace check and managed webhook lifecycle one serialized operation across API instances.

## 2026-07-15: Derive Webhook Delivery State From Channels

Decision: Webhook/API Settings reads and changes the actual `WEBHOOK` channel. Stored integration-account status is not evidence that an outgoing destination works.

Context: The generic integration connection test can succeed from a persisted status alone. Customers need to configure, exercise, and disable outgoing webhook delivery without exposing stored URLs or credentials or disrupting inbound intake.

Consequences:

- Target and authentication badges come only from the redacted channel projection; target URL and secret replacement remain write-only.
- A test creates one real sample lead through the webhook channel pipeline. Only `sent` is described as delivered; `queued`, `skipped`, `failed`, and request errors remain distinct retryable outcomes.
- Disabling outgoing delivery removes its target and authentication through the channel patch API. The channel, inbound endpoint, and server-managed inbound secret stay active.

## 2026-07-15: Fail Closed For Unimplemented Worker And AI Runtime Paths

Decision: Every declared worker queue either runs a real processor or fails terminally. Production API and worker processes may not instantiate the deterministic mock AI provider.

Context: Five reserved queues returned a successful `placeholder` result without doing work, malformed extraction jobs substituted demo identities, and a missing or disabled production AI configuration silently selected mock output.

Consequences:

- Reserved queues remain declared for contract compatibility but their jobs are dead-lettered as non-retryable until a processor is implemented.
- Malformed AI reply, extraction, and channel-delivery payloads are permanent contract failures; no demo tenant, conversation, or text fallback is synthesized.
- Production requires an enabled OpenAI provider with a configured key. The mock provider is available only when explicitly selected outside production.

## 2026-07-15: Expose Email And Calendar Only With Live Adapters

Decision: The customer Email inbox and Google Calendar remain visible as unavailable catalog entries until provider-backed connection, health, inbound/delivery, and booking implementations exist.

Context: Both integrations could persist `CONNECTED`, successful tests, logs, and timestamps without contacting any external provider. The Email channel adapter was also a placeholder, and Calendar had no production adapter.

Consequences:

- Connect, disconnect, settings, test, and sample boundaries fail before database or provider access with `501/INTEGRATION_NOT_AVAILABLE` and provider-specific capability metadata.
- Legacy rows remain stored for recovery but project as `COMING_SOON` without operational timestamps, logs, public settings, or credential state.
- Email channel and Google Calendar adapter calls reject with a stable non-retryable unavailable error instead of inventing provider identifiers or success.
- Transactional email OTP uses its separate SMTP/UniSender subsystem and is unchanged.

## 2026-07-15: Preserve Legacy Telegram Webhook History

Decision: A tenant's Telegram integration history reads both the current scoped provider key `telegram:<channelId>` and the historical tenant-scoped key `telegram`.

Context: Webhook storage moved to channel-scoped provider keys, but prior successfully processed updates remained under `telegram` and disappeared from recent integration history.

Consequences:

- Telegram history queries and projections merge both keys under the tenant boundary.
- Telegram webhook registration, verification, connection, and delivery behavior is unchanged.

## 2026-07-15: Send Clients To The Verified Telegram Bot

Decision: A successful Telegram connection keeps the setup dialog open and makes the provider-verified bot username a direct `t.me` action in both the dialog and connected integration card.

Context: Telegram can only deliver messages addressed to the configured bot. Production records showed the reported manual updates were accepted and persisted, while the prior UI closed immediately and left users to find a bot independently, making wrong-bot testing indistinguishable from an inbound failure.

Consequences:

- The server-returned `botUsername` is the customer-facing identity; the submitted token is cleared and never rendered.
- The direct chat target includes the exact username and a stable start parameter. Users no longer need to search Telegram or remember which bot token they connected.
- Inbox remains visibility-aware and polls live data; Telegram health still validates and repairs the managed webhook separately from the direct chat action.

## 2026-07-15: Reconcile Interrupted Deployments From A Durable Journal

Decision: Production deployment records one versioned, fsync-safe journal before candidate preflight or drain. `precommit` recovery restores the recorded `current` path and exact prior container IDs/running states; `committed` recovery can only run the candidate migration and promotion path.

Context: Shell traps do not run after `SIGKILL`, power loss, or host reboot. Losing in-memory phase and container state after writers or nginx stop could leave production unavailable, while guessing the phase after a possible migration could restart incompatible old code.

Consequences:

- The journal binds candidate SHA, release path/image tag, Compose project, env/public routing, exact prior link/path identity and backup, plus canonical API/worker/web/nginx IDs and running flags. Atomic replacement syncs the journal file and parent directory.
- `current` and its parent are synced before an identity-fenced `precommit` to `committed` rewrite. No migration runs before that durable commit point, so recovery never guesses whether old-code rollback remains legal.
- The same fail-closed reconciler runs at the start of every deploy and from an enabled systemd oneshot after Docker and the network start. Failed recovery retains the journal and holds nginx stopped.
- Successful precommit recovery proves prior API, active worker, web, public health, root, and unauthenticated auth before clearing the journal. Committed recovery rechecks stateful dependencies, migration/key coverage, normal API, paused/activated worker, web, nginx, and public routes before clearing it.
- Pruning recognizes only marker-valid managed releases. Current/journal paths, top-level symlink targets, and every stopped or running Compose container label are references; image tags remain while any journal, release marker, or container names them.
- Local verification covers Bash syntax, static recovery/order assertions, mocked journal write and duplicate-attempt fencing, and mocked fail-closed pruning. A disposable Linux Docker/systemd `SIGKILL` and reboot matrix remains required before treating abrupt-process and host-loss recovery as operationally proven.

## 2026-07-15: Snapshot Capability Configuration And Evaluation At Publication

Decision: Every structured publication binds canonical capability-set and requirement-evaluation-set hashes and stores one immutable `KnowledgePublicationCapability` row for each enabled capability, linked to the exact validation and write-once requirement evaluations.

Context: Mutable tenant capability settings cannot explain or authorize a historical answer after configuration, templates, evidence, or autonomy changes.

Consequences:

- Publication activation re-evaluates the candidate and rejects new blockers or configuration drift, plus any mismatch between the publication and its stored validation/evaluation identities.
- Published capability type, autonomy, configuration hash, validation identity, and evaluation hash remain reproducible without reading current draft settings.
- At least one capability must be enabled; disabled capabilities are not copied into the serving snapshot.

## 2026-07-15: Separate Draft Capability Readiness From Serving Readiness

Decision: Draft readiness is computed from current capability configuration and candidate evidence. Serving readiness is reconstructed only from the active publication's immutable capability and validation records.

Context: Showing current draft settings as serving state would make an unpublished edit appear live and could hide what the runtime is actually authorized to do.

Consequences:

- Knowledge Overview presents published serving capabilities separately from editable draft controls.
- A draft change can block validation and revoke automation, but it never mutates the active publication's historical readiness.
- Runtime authority comes from the publication captured by the reply run, not from mutable capability rows.

## 2026-07-15: Preserve Knowledge Validation Attempts As Immutable History

Decision: Candidate/version/policy identity is an index, not a uniqueness boundary. Each validation attempt receives a new row, and its requirement evaluations are write-once for that validation.

Context: Reusing or overwriting one validation row destroys evidence about prior capability configuration, evaluation results, actor, timing, and publication attempts.

Consequences:

- Pending and passed unpublished validations become `EXPIRED` when capability configuration changes; they are not rewritten into the new decision.
- Publications retain an exact validation reference, while later attempts can evaluate the same candidate under newer capability or policy state.
- Migration checks require the final nonunique history index and reject the former unique constraint or malformed partial state.

## 2026-07-15: Revoke Automation When Capability Authority Changes

Decision: A semantic capability change revokes automatic replies bound to the old capability set and fences affected queued/running work. Structured runtime classifies the customer intent against the captured publication; disabled capabilities and explicit handoff requests take the deterministic human-handoff path without retrieval or model execution.

Context: Editing enablement or autonomy after channel activation must not let already-authorized work continue under stale business authority.

Consequences:

- Revocation clears channel publication/capability bindings, advances automation and conversation generations, supersedes affected runs, and dead-letters only affected-channel reply outbox work.
- Admission, retry, and delivery require the same publication capability-set hash captured by the run.
- V1 freezes allowed autonomy in the publication. Authoritative tool/permission evidence and action-by-action autonomy enforcement remain required before broader external actions can execute.

## 2026-07-14: Commit Before Database Migration And Recover Forward

Decision: Production deployment preflights a writer-free API, paused worker, and web while the prior stack remains live. It then drains exact prior writers, stops nginx, switches `current`, disarms old-code rollback, and only then runs migrations and retained-key coverage. Any later failure handled by the deployment process reruns those gates and promotes only the candidate release.

Context: Restoring old code after a successful schema migration can make old writers corrupt or misinterpret the new database. Candidate boot checks after the drain also created avoidable downtime and left recovery unable to distinguish stopped canonical containers from containers stopped by the deployment.

Consequences:

- Existing releases recover their Compose project from a validated marker or an unambiguous stopped-or-running container label; the candidate persists the project marker and stateful services use `--no-recreate`.
- PostgreSQL, Redis, Qdrant, and ClamAV readiness is proven before candidate preflight. Precommit rollback restores the exact prior path and only previously running containers, holds nginx until prior API/web readiness, and verifies public health, root, and unauthenticated auth.
- Postcommit recovery reruns migration/key gates, force-recreates candidate API/paused worker/web, activates the worker only after the final key gate, validates nginx, and keeps nginx stopped unless public health, root, and auth all pass.
- The 2026-07-15 durable journal decision above supplies the recovery mechanism; the disposable-host crash and reboot drill remains the operational proof gate.

## 2026-07-14: Preserve Compose Identity In Standalone TLS Operations

Decision: Each active release may identify its validated Compose project through `.leadvirt-compose-project`. Certificate renewal and active-nginx validation pass that project explicitly; marker absence retains the legacy lookup, while malformed markers fail closed. A first TLS cutover may bind a temporary nginx only when the ACME token is not already served.

Context: Release directories no longer imply a stable Compose project name, and a first install has no nginx to serve Certbot's webroot. Out-of-band certificate scripts could target no container or fail before the initial certificate existed.

Consequences:

- The temporary server remains alive through certificate issuance and is removed by an exit trap. Existing port `80` listeners are never stopped or replaced.
- Renewal targets the nginx service belonging to the active release instead of deriving project identity from its directory name.

## 2026-07-14: Keep Candidate API Preflight Writer-Free

Decision: The isolated candidate API starts with `API_DEPLOYMENT_PREFLIGHT=true`, which disables every API startup outbox, reconciliation, publication, review, and Test-run drain. Its health contract must report preflight mode before deployment can commit. Canonical Compose forces the flag to `false`, and promotion requires health to report normal mode.

Context: Starting the candidate API after old writers drain but before the release commit could process shared PostgreSQL outboxes or publish queue jobs with candidate code. A successful HTTP boot alone did not prove writer isolation.

Consequences:

- Invalid preflight flag values fail startup. Release readiness inventories and classifies every API `OnModuleInit` hook so a new writer cannot silently bypass the guard.
- Prisma connection and read-only dependency probes remain active for boot validation; no API background writer schedules or performs work in candidate mode.
- Normal API behavior is unchanged, and the deployment-only override cannot leak into canonical services.

## 2026-07-14: Bind Query Evidence To Tenant-Scoped HMAC Keys

Decision: Structured original, processor, and Test query evidence uses domain-separated HMAC-SHA256 bound to tenant, purpose, version, and key ID. One active key writes new hashes; prior configured keys are verify-only. An immutable database registry binds each key ID to its version and non-secret key check.

Context: Raw unsalted query hashes permit offline dictionary matching and cross-tenant correlation. Rotation also becomes unsafe if a retained record can be relabeled with missing or changed key material.

Consequences:

- Query-hash metadata persists and is revalidated across retrieval, grounding, live tools, precommit, and delivery. Legacy versions and mismatches fail closed.
- A key ID and its material are immutable. Rotation adds a uniquely named active key while retaining every old verifier required by persisted records.
- The drained-writer deployment gate rejects legacy rows without HMAC metadata, missing retained verifiers, key material that disagrees with the registry, and referenced but unregistered IDs. It registers only configured keys that have no retained references, preventing silent first-use adoption.
- Query-hash columns remain nullable during the expand phase for old-writer rollback compatibility. After those writers are permanently retired and legacy rows are explicitly remediated, a contract migration will require key ID and version metadata.

## 2026-07-14: Serialize Custom Migrations And Preserve The Query-HMAC Expand Phase

Decision: The custom migration runner acquires one PostgreSQL advisory transaction lock in the maintenance database, keyed by target database, before database creation, state checks, or DDL. Query-HMAC metadata state requires the exact eight nullable, default-free text columns and the exact validated check constraint on each intended table.

Context: Separate manual entrypoints could both observe an absent migration and race into the same DDL. Name counts also accepted weakened constraints or a same-named constraint attached to the wrong table. The metadata columns must remain nullable during rolling compatibility with old writers.

Consequences:

- Concurrent runner processes serialize; the first applies and later processes re-evaluate state and skip.
- Partial or altered query-HMAC metadata fails closed instead of being skipped or replayed.
- This is the expand phase only. After old writers are permanently retired, a later contract migration must remediate legacy rows and reject missing key ID/version metadata.

## 2026-07-13: Bind Snapshot Authorization Before Query Time

Decision: Every new structured READY index snapshot stores a strict versioned authorization manifest and canonical hash covering its exact tenant, snapshot, document revisions, source permission partitions, membership, schema, and point count. Publication activation binds that manifest, while runtime validates current source permission state with one bounded partition query and retains row-backed candidate hydration.

Context: Reconstructing permission partitions by scanning every snapshot item on every request was safe but linear in corpus size. Trusting Qdrant payloads or a preparation-time check alone would make permission revocation, snapshot reuse, and concurrent activation unsafe.

Consequences:

- Canonical identity uses locale-independent code-unit ordering. A v1 manifest allows at most 512 source partitions and 100,000 points, rejects unknown or noncanonical fields, and binds exact revision and membership hashes.
- Index preparation rebuilds the manifest under locked source/revision/chunk fences before READY. READY and publication-referenced snapshot authorization/membership are immutable in PostgreSQL, and publication attachment rechecks a locked READY parent.
- Activation requires exact document revisions and current source permission version/fingerprint. Runtime permits source-generation advance but denies regression, permission drift, deletion, tombstone, malformed identity, or revision mismatch before Qdrant access.
- Runtime performs one snapshot-readiness query and one bounded source query, then preserves exact snapshot-row hydration before and after reranking plus final evidence revalidation.
- Legacy null-version snapshots are not reused and fail closed. The contract migration requires old index writers to be drained unless deployment is split into an explicit expand/deploy/contract sequence.
- Deterministic 512-partition tests prove bounded authorization query count. Real PostgreSQL/Qdrant latency at the 100,000-point ceiling remains a separate release benchmark.

## 2026-07-13: Version Tenant-Default Knowledge Scope

Decision: Knowledge v2 stores an optional canonical tenant-default scope with a monotonic generation and policy-specific hash. Null-scoped fact and guidance versions inherit that policy; explicit versions must contain a nonempty audience and do not depend on it.

Context: Facts and guidance previously failed closed when their scope was null because no persisted tenant default existed. Treating null as public would create an implicit authorization wildcard and make later policy changes impossible to fence reliably.

Consequences:

- Existing tenants remain unset and receive no `PUBLIC` backfill. Owners/admins choose the default audience through client-safe settings controls.
- Publication materializes inherited effective scope and binds the default generation, hash, and authorization fingerprint. Runtime, evidence revalidation, and delivery require those pins to match the current policy.
- A semantic default change increments the generation and immediately makes inherited active items unavailable until a new publication activates. Explicitly scoped items retain their existing authorization identity.
- Empty or malformed explicit/default audiences fail closed. Legacy unbound inherited items cannot serve.
- Document scope behavior is unchanged because document audience, classification, revision scope, and source permission are independently enforced.

## 2026-07-13: Authenticate Customer Identity At Telegram Ingress

Decision: Customer-personal authorization requires a versioned, immutable ingress attestation. Telegram can create it only after managed-secret verification for a real private bot chat whose safe numeric `message.from.id` equals `message.chat.id` and whose sender is not a bot.

Context: Lead and conversation records are mutable CRM state, Telegram group chat IDs identify a room rather than a person, and internal samples use synthetic private-shaped updates. None of those values can prove who is asking for an order or booking status.

Consequences:

- Internal samples, groups, supergroups, malformed senders, mismatched private chats, and channels without a verified bot ID remain non-personal without blocking Inbox ingestion. A contact phone is accepted only when `contact.user_id` matches the authenticated sender.
- One create-only `AuthenticatedCustomerIdentity` binds the exact tenant, channel, conversation, inbound message, WebhookEvent, processed payload, receipt time, HMAC subject, and attestation. Queue data carries only its opaque ID, version, and hashes; the raw Telegram subject is not added to the job contract.
- Webhook retries preserve the original receipt time and reuse the same identity. `CUSTOMER_IDENTITY_HMAC_KEY` must remain stable across API and worker deployments; rotation requires a versioned migration.
- Live-tool policy v2 requires the exact proof and revalidates the stored Telegram payload, channel binding, run fence, permission generation, encrypted ledger result, and proof again before commit or resolution. Rows created without identity cannot resolve.
- The worker remains PUBLIC even when the queue contains a valid proof. Customer-personal execution is a separate activation task requiring approved query processing, processed-event ordering, and end-to-end revocation proof.
- AI reply run creation follows `KnowledgeCorpusSelector`, capturing `workspace-v2` for structured tenants and `workspace` for legacy tenants.

## 2026-07-13: Use Shared Structured Retrieval For Search Diagnostics

Decision: `GET /knowledge/sources/search` captures the exact active `workspace-v2` publication and calls the shared structured runtime. The legacy retriever, corpus selector, SQL/hash fallback, and legacy source/chunk response are not part of this endpoint.

Context: API diagnostics still queried the legacy `workspace` target and could fall back to database retrieval even after live replies, Test runs, and evaluations had moved to Knowledge v2. That produced different evidence and authorization behavior from production.

Consequences:

- Owner/Admin diagnostics use an INTERNAL audience with PUBLIC, INTERNAL, and SENSITIVE evidence classifications. Manager/Agent diagnostics are PUBLIC-only; Viewer is denied. No customer-personal identity, arbitrary scope simulation, or live-tool execution context is inferred.
- Free-form diagnostic text is always classified `SECRET` for query-processor admission because role and evidence visibility do not classify user-entered data. Document retrieval therefore requires explicit tenant and deployment approval for `SECRET` query processing; otherwise exact local evidence may degrade safely and document-only diagnostics fail closed.
- The response exposes only bounded authorized fact, guidance, document, conflict, and diagnostic projections. Insufficient grounding is explicit; unavailable dependencies and changed targets/evidence fail closed with stable content-free errors.
- Evidence and the exact current conflict set are revalidated before return, and responses are private and non-cacheable. The shared runtime deletes newly created restricted query artifacts on every post-storage failure until it transfers a trace cleanup handle; the endpoint then cleans transferred artifacts on grounded, insufficient, and unavailable paths. The existing `limit` query parameter caps only the response projection because structured retrieval depth is policy-owned.
- This supersedes the 2026-07-05 decision that allowed `/api/knowledge/sources/search` to fall back to database vector similarity and the earlier implicit Viewer access to this diagnostic action.

## 2026-07-13: Make Managed Telegram Health Self-Healing

Decision: Telegram connection health uses `getMe` and `getWebhookInfo`, evaluates the registered relay URL, pending backlog, and delivery errors, and attempts one managed `setWebhook` repair before reporting readiness. Synthetic Inbox samples remain available but are explicitly identified as internal processing checks.

Context: The internal sample bypassed Telegram, TLS, the FR relay, and public ingress. A matching webhook URL was previously reported as healthy even while Telegram accumulated timed-out updates. Bot replacement also persisted a new secret before external registration succeeded, which could invalidate the still-active bot after a failed replacement.

Consequences:

- Stale URLs, delivery failures, missing secrets, and exact `message`/`edited_message` subscription drift are repaired with the server-owned secret and allowed-update policy, then verified again; a remaining backlog, error, or policy mismatch reports failure. Candidate secrets are row-locked, credential-fenced, and accepted alongside the active secret before `setWebhook`, so Telegram can immediately drain queued updates without receiving `401`.
- Telegram webhook ingestion denies channels without a managed secret. Clients still enter only the BotFather token.
- Ordinary bot replacement reuses the active webhook secret and does not change stored credentials until channel activation succeeds. The retired bot credential remains encrypted and redacted until health confirms its queue is empty and Telegram confirms webhook deletion; historical `last_error_*` fields describe the most recent error and do not block cleanup once pending updates reach zero. Disconnect checks the queue before deletion, confirms it remains empty afterward, and restores the active webhook if an update races with removal. Failed cleanup stays visible and retryable. Staged secret rotation remains available for explicit recovery.
- The public FR relay applies a per-IP `50` requests/second limit with a burst of `100`; API-side secret verification remains authoritative and relay request logging remains disabled.
- Production and staging route outbound Bot API calls and inbound webhooks through the FR gateway. Deployment rejects persistent-env drift and probes the external relay before completing. The Telegram readiness action is a live health check; synthetic traffic is labeled as an internal sample.

## 2026-07-13: Fail Closed on Persisted Knowledge Authorization

Decision: Persisted Knowledge v2 scopes, document audiences, and delivery authorization filters are parsed as bounded typed policy. Malformed policy denies access. Facts and guidance cannot use a null tenant-default scope until that policy is stored and versioned; documents may omit additional scope only because tenant, classification, and audience remain independently enforced.

Context: Lossy JSON parsing converted malformed arrays and fields into empty wildcard policy. Chunk scope was mutable without being tied to its revision, permission partitions stopped after 513 rows rather than 512 unique partitions, and API-valid scope values could fail only after content reached the embedding boundary.

Consequences:

- Explicit scopes reject unknown fields, mixed values, duplicates, reserved wildcard values, excessive cardinality, and invalid IDs, segments, audiences, channels, or locales. API, trace, and Qdrant limits share the same contract.
- Publication, index preparation, hydration, and delivery require each chunk and manifest scope to equal the revision/document scope. Document audience and locale payload filters must be at least as restrictive as that scope.
- Permission partitions are derived by deterministic paging across every snapshot row and fail closed above 512 unique partitions. Invalid metadata is rejected before processor admission or embedding.
- Existing null-scoped facts and guidance stop serving and require an explicit audience. A later tenant-default feature must be persisted, versioned, included in fingerprints, and revalidated rather than reintroducing implicit wildcards.

## 2026-07-13: Resolve Authoritative Evidence Before Document Retrieval

Decision: Structured facts, guidance, and authorized read-only live tools resolve before document embedding, Qdrant search, and reranking. A document dependency failure cannot erase valid authoritative evidence, and missing mandatory live evidence stops before document query disclosure.

Context: The retriever previously queried documents first. Embedding, processor-policy, sparse, Qdrant, or reranker failure could block a valid order or booking lookup, while a live-required query with no usable tool result was still sent to document processors even though static text could not answer it.

Consequences:

- Exact local and live evidence may continue through grounding with a stable degraded dependency reason; document-only questions still fail closed without SQL or lexical fallback.
- Live-tool authorization, immutable ledger resolution, expiry, precommit revalidation, and delivery revalidation remain unchanged and mandatory.
- The worker reports a grounded answer with document degradation as `degraded`, not `empty`; persisted retrieval filters retain the content-free degradation code for audit.

## 2026-07-13: Bind Operational Answers To Immutable Live Evidence

Decision: Operational answers may use only server-owned read tools whose result is committed to an encrypted, immutable PostgreSQL ledger after a serializable authorization recheck. No generic client-callable tool endpoint is exposed.

Context: Static knowledge cannot prove current order, booking, availability, inventory, or account state. Opaque caller-provided references were insufficient because authorization, connector permissions, conversation identity, and payload integrity could change before commit or delivery.

Consequences:

- Ledger rows contain hashes, policy identities, authorization generations, object metadata, and exact runtime bindings; values and answer content remain encrypted in object storage.
- Authorization generations advance on tenant, membership, channel, and integration permission changes and cannot be rolled back or directly deleted. Old evidence can never become valid again.
- The resolver uses its server clock and rechecks the exact tenant, run, attempt, conversation fence/status, lead, channel, permission generation, connector version, expiry, ciphertext, and envelope before every use. Final commit/delivery checks take share locks through the caller transaction so revocation cannot commit across the provider boundary.
- Only authenticated-customer internal order and booking readers are currently registered. Public or unsupported requests hand off until authoritative identity and provider adapters exist.

## 2026-07-13: Localize Settings Chrome Without Rewriting Stored Content

Decision: Settings and Billing localize LeadVirt-owned labels, actions, validation, statuses, and formatting in the web client. Tenant-authored widget content and provider-authored plan descriptions/features remain verbatim.

Context: The shared Settings component mixed hardcoded Russian with API values. Translating stored business content in the browser would silently change what operators review or later persist.

Consequences:

- EN/ES/FR/DE/PT/RU use one typed Settings catalog and locale-aware date, number, RUB, usage, session, API-key, and invoice formatting.
- Stable billing modes/statuses and the manual-invoice workflow map to client-owned copy; plan and tenant content remain API data.
- Locale changes do not alter Settings API payloads, subscriptions, channel configuration, security actions, or downloaded invoice identities.

## 2026-07-13: Keep Public Widget Chrome Separate From Tenant Content

Decision: Localize LeadVirt-owned public widget controls from the tenant's configured widget locale while rendering tenant-authored chat content and branding verbatim.

Context: The public widget mixed Russian control text with configurable tenant content. Browser language is not authoritative when a tenant embeds one configured widget across customer sites.

Consequences:

- EN/ES/FR/DE/PT/RU and their BCP-47 tags select typed widget chrome; invalid tags fall back to English.
- Tenant title, subtitle, welcome message, suggested replies, consent, colors, position, and powered-by text are never machine-translated in the browser.
- The standalone demo page chrome and missing-key frame use the browser locale; the widget inside the demo still follows its fetched tenant configuration.

## 2026-07-13: Keep Dashboard API Labels Locale-Neutral

Decision: Dashboard summary returns stable audit action codes and Monday-based weekday indices. The web client owns display labels and weekday formatting for all six product locales.

Context: The API previously embedded Russian activity prose and weekday abbreviations, forcing other locales to reverse-map server text.

Consequences:

- Known Dashboard activity is localized from action codes; optional legacy titles remain a compatibility fallback for older or mocked responses.
- Trend points carry weekday indices, so clients format them with their own locale rather than translating Russian abbreviations.
- Additional workflow, billing, integration, and event prose will move to the same stable code/value pattern separately.

## 2026-07-13: Return Analytics Insight Codes Instead Of Fixed Prose

Decision: Analytics overview returns bounded insight codes. The web maps those codes to six-language recommendations and accepts optional legacy free text only for compatibility.

Context: Four deterministic recommendations were emitted as Russian sentences, so non-Russian interfaces displayed server-owned Russian content.

Consequences:

- API responses are locale-neutral and bounded to four documented insight codes.
- The client controls translated display text without changing analytics calculations or CSV behavior.
- Unknown future codes degrade to a readable code label rather than silently selecting another locale.

## 2026-07-13: Persist Explicit User Locale Without Overriding Legacy Browser Choice

Decision: Store a nullable six-language locale on the user. A signed-in saved preference overrides the browser cookie; a null preference preserves the current cookie until the user explicitly chooses a language.

Context: Cookie-only localization did not follow users across browsers. Defaulting every existing user to English would unexpectedly replace their current browser language on the first authenticated load.

Consequences:

- The language switch updates the browser immediately and persists the authenticated preference on a best-effort API call.
- `/auth/me` returns the saved preference so the product shell can apply it on another browser.
- The API allowlist and database constraint accept only EN/ES/FR/DE/PT/RU, and each successful change writes a tenant-scoped audit entry.

## 2026-07-13: Bulk Resolve Only Exact Homogeneous Low-Risk Review Sets

Decision: Bulk Review resolution is limited to owner/admin-selected sets of 1-50 exact LOW-risk items sharing one READY source, reason, suggested action, and target schema. A private/no-store preview issues a five-minute actor/tenant-bound, domain-separated HMAC over every ID, generation, and ETag.

Context: Query-wide or heterogeneous bulk actions could silently include newly arrived, restricted, higher-risk, conflicting, or incompatible work and leave partial terminal state when a later follow-up failed.

Consequences:

- Conflict-linked, restricted, unsupported, stale, cross-tenant, mixed-source/reason/schema, and non-LOW items never receive an executable preview.
- Execute requires the explicit selected IDs, every ETag, preview hash/expiry, and an Idempotency-Key. It reauthorizes the current actor and locks all rows in stable order.
- Review terminal states, hashed audits, metadata-only jobs, and outbox events commit in one transaction. Any stale item or enqueue failure rolls back the full batch; replay reuses the receipt without duplicating follow-up work.
- The UI offers only explicit visible-row selection to owners/admins, retains selection while reloading rejected or stale state, and never presents optimistic or partial terminal success.

## 2026-07-13: Separate Real Knowledge Quality From Deterministic CI

Decision: run multilingual real-provider Knowledge v2 quality only as a manually approved staging workflow, while PR/main CI verifies the same slice and privacy contract with deterministic observations.

Context: the existing real-provider evaluator uses the legacy corpus and can use database retrieval. The production Knowledge gate must prove normal structured-v2 ingestion, an immutable Qdrant hybrid snapshot, the shared PUBLICATION evaluator, real processor admission, and grounded answers without making ordinary CI depend on external credentials or fabricating a local pass.

Consequences:

- A dedicated staging tenant owns reviewed multilingual sources and an exact pinned test-case-set hash.
- The protected runner re-syncs sources and evaluates a DRAFT but never publishes it.
- Missing credentials, processor consent, Qdrant reconciliation, locales, behaviors, hashes, or per-locale floors fail closed.
- Reports expose only safe identities, hashes, aggregates, latency, and usage/cost; raw questions, evidence, answers, tenant/source IDs, and credentials remain protected.
- Global and English aggregates cannot mask a failed locale, and tenant-critical pass rate is fixed at 100%.

## 2026-07-13: Hydrate Conflict Values Only At Authorized Detail And Execution Boundaries

Decision: Restricted conflict candidate values are decrypted only for authenticated private/no-store conflict detail and immediately before a value-selecting decision executes. Lists and durable operations retain hashes and opaque metadata only.

Context: Candidate selection was unavailable when a protected replacement value existed because no reader could safely connect its encrypted object to current tenant, actor, source, revision, evidence, permission, audience, classification, and deletion state.

Consequences:

- Managers remain limited to claimed low/medium-risk public or internal material; owners and admins retain elevated-risk access. Present malformed audience policy denies every role instead of falling back.
- Resolution admission validates every candidate. The queued target stores an authorization hash plus exact generation/content pins, never plaintext or an object reference.
- Execution reauthorizes the actor, rehydrates the selected object, and compares the exact authorization hash before creating an immutable fact successor. Missing, corrupt, stale, revoked, or changed material fails closed.

## 2026-07-13: Commit Onboarding And Selected-Corpus Projection Atomically

Decision: Serialize onboarding mutations, migration/cutover, public legacy writes, and legacy activation with one tenant-scoped PostgreSQL corpus-transition lock. Onboarding state, tenant identity, legacy compatibility sources, structured draft projection, outbox events, and audits commit in one transaction. Migration start backfills the current onboarding state and enables structured dual-write through failed or stale replacement attempts and after cutover. Generated onboarding compatibility sources remain one-way legacy transport/UI data: public update/archive is rejected and they never become structured document evidence; typed facts and guidance are the structured authority. Cutover recomputes the current legacy manifest, requires the active structured validation generation to match the current draft, and rejects unresolved onboarding ownership reviews or retired onboarding documents. After `STRUCTURED_V2` is selected, public legacy mutations are read-only and delayed legacy publications terminate without pointer activation. Structured onboarding drafts never auto-publish. Dispatch begins only after commit. A successful authenticated launch opens `/app/knowledge?welcome=1` for review, testing, and explicit publication; demo launch still opens Dashboard.

Context: The previous request path committed onboarding state before updating the tenant, knowledge sources, outbox, and audit. After structured cutover it also continued updating only the inactive legacy corpus, so onboarding edits were invisible to runtime retrieval. The Dashboard handoff hid the required structured review, test, and publish steps. Concurrent API replicas could also overwrite disjoint onboarding patches.

Consequences:

- Concurrent patches read and merge only after acquiring the same tenant lock, so separate answers are retained.
- Deterministic semantic keys append successors only when onboarding-owned material or exact projection evidence is stale. Explicit content-free onboarding and editor provenance prevents later onboarding saves from overwriting manual successors; same-text scope, risk, condition, or priority differences create HIGH-risk, actionable review items and block cutover until resolved.
- Empty values archive or disable successors, already-current saves create no work, and stale projection policy repairs idempotently. Free-text catalog content remains HIGH/PUBLIC and operational availability HIGH/INTERNAL, so a manager cannot approve arbitrary price, discount, refund, guarantee, or availability claims.
- Direct public update/archive of exact generated compatibility rows fails with `KNOWLEDGE_CONFLICT_ONBOARDING_SOURCE_MANAGED`; ordinary manual legacy sources retain their pre-cutover behavior.
- Exact generated onboarding compatibility sources are excluded from migration and candidates. Stale `LEGACY_ONBOARDING` documents block cutover, while runtime hydration, evidence revalidation, and persisted-reply revalidation reject any pre-fix active item.
- Any selected-corpus projection or audit failure rolls back the full mutation and cannot dispatch an uncommitted event.
- A post-commit dispatcher failure leaves the durable outbox and complete business state available for bounded retry. Exhaustion/deadline terminalization conditionally owns a claimable or expired lease and completes related inbox, job, and attempt state without overwriting a concurrent success.
- Unrelated later draft generations do not invalidate valid reconciliation work; exact resource generation/version/hash still rejects same-resource predecessors.
- Exactly one corpus remains live. Post-cutover legacy CRUD/reindex fails with `KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER`; queued legacy activation is cancelled and dead-lettered with `KNOWLEDGE_PUBLICATION_LEGACY_CORPUS_INACTIVE`.
- Manifest drift, unresolved review work, or a stale validation generation blocks cutover; structured onboarding changes stay reviewable until the normal explicit publication gate advances the active pointer.

## 2026-07-13: Gate History Publishing On The Exact Evaluation Target

Decision: History enables its explicit publish confirmation only when a server-issued validation ID and a recovered `PUBLICATION` evaluation match the current draft candidate ID, version, manifest hash, and evaluation test-set hash. A completed run is sufficient only when every critical result passed.

Context: Evaluation execution success does not mean quality success, and candidate or saved-test changes can make an otherwise successful run stale. Component-local state also disappears during navigation while the server-owned run continues.

Consequences:

- Exact runs are recovered newest-first through the evaluation list API before new work is created; nonterminal details use one visible, bounded, non-overlapping poller.
- Failed, cancelled, critical-failure, and stale results remain visible with aggregate diagnostics and Test/Review actions, but never authorize publishing.
- The final publish confirmation remains explicit, and the server publication gate remains the concurrent-change fence.

## 2026-07-13: Recover Knowledge Work From Server Job State

Decision: Knowledge publication history and source views reconstruct tracked work only from matching `PUBLICATION` or `SOURCE` references in the loaded readiness and overview job state. Polling stays visible, bounded, and single-job, while monotonic status merging prevents stale parent snapshots from downgrading newer observations.

Context: Component-local job state disappeared on navigation, hiding accepted work and terminal failures even though the server still owned the operation.

Consequences:

- Nonterminal jobs resume bounded polling after remount without starting a duplicate poller.
- Terminal failures retain their server error and open the existing guarded retry flow; the UI never infers success from disappearance or elapsed time.
- Dismissal remains local to the mounted view, while future server-authoritative work can be rediscovered.

## 2026-07-13: Export Knowledge Health Without Tenant Or Content Labels

Decision: The API metrics scrape refreshes global Knowledge v2 health gauges from PostgreSQL using only bounded lifecycle, risk, reason, category, subsystem, and source-kind labels. Tenant, user, source identity, URLs, prompts, messages, and error text are excluded.

Context: Durable jobs, reviews, conflicts, publications, feedback, answer gates, freshness, and deletion lag were persisted but not visible to operations. High-cardinality or content-bearing Prometheus labels would create disclosure and reliability risks.

Consequences:

- Each successful refresh replaces the previous gauge series from one repeatable-read snapshot so resolved work does not remain visible as stale state.
- Scrapes share one bounded cached refresh. PostgreSQL failure sets explicit stale/age/last-success gauges, increments a content-free failure counter, and returns existing metrics instead of blocking the scrape path.
- Tenant-specific diagnosis remains in authorized product/audit views; Prometheus receives only global operational aggregates.
- Grafana provisions a dedicated Knowledge health dashboard for the bounded operational signals; restricted diagnosis remains in product and audit surfaces.

## 2026-07-13: Execute Review Decisions As Fenced Follow-Up Work

Decision: A terminal Knowledge v2 Review or Conflict decision atomically enqueues a versioned job and outbox event. The dispatcher reauthorizes the deciding actor, fences the decision generation and exact target version, and invokes an idempotent domain mutation. It never publishes knowledge directly.

Context: Closing a review without producing its separately validated outcome loses operator intent, while embedding values in queue payloads or mutating inline would weaken authorization, retry, and restricted-data boundaries.

Consequences:

- Approve/reject and conflict choices create immutable fact or guidance successors; source correction, retry, exclusion, and permission checks enqueue their existing durable source workflows.
- Unanswerable and handoff decisions create explicit draft guidance policies. Protected replacement values use the later authorized detail/execution hydration boundary and otherwise fail closed.
- Duplicate, late, stale, failed, and crash-redriven events reconcile through downstream idempotency records or exact source job keys without duplicating outcomes.

## 2026-07-13: Pin Feedback To Exact Knowledge Outcomes

Decision: Knowledge v2 feedback records exact tenant-scoped response, retrieval trace, evaluation result/run, and publication references whenever those links exist. Only cited or evaluated evidence can be attached, notes live in encrypted restricted storage, and risk is the maximum of category, referenced content, document classification, and the client-supplied level.

Context: Unpinned or client-classified feedback could diagnose a different knowledge snapshot, attach cross-tenant evidence, leak free text through retries/audits, or down-classify sensitive failures.

Consequences:

- Current membership is checked before preparation and again in the final transaction; viewers and removed members are denied.
- Idempotent responses are role-independent and redact non-public evidence. Newly prepared note objects are removed when the final transaction fails, while reused deterministic objects are retained.
- Feedback remains review input only. It never mutates or publishes knowledge directly.

## 2026-07-12: Pin Runtime Retrieval To Tenant Consent And Physical Snapshot Identity

Decision: Structured-v2 retrieval captures one immutable publication or validation and uses it only when the exact Qdrant collection, canonical index schema, embedding/sparse identities, and tenant retrieval-processor policy match the configured runtime. Missing, revoked, rotated, or classification-incompatible processing fails before query disclosure.

Context: A historical publication could otherwise query a newer physical collection or send customer text to globally configured providers without current tenant consent.

Consequences:

- Query embedding and reranking reauthorize exact provider, deployment, model, version, region, policy hash, classification, and process ceiling immediately before each external call.
- Knowledge Test runs pin the validation and nullable snapshot identity, reauthorize role/target before decrypt and commit, and fence success/failure by the current attempt lease.
- Fact-only targets carry a null snapshot and never query Qdrant. Structured-v2 generation remains fail-closed until a separate tenant model-processor policy and shared grounded claim gate are implemented.

## 2026-07-12: Prepare Exact Knowledge Snapshots Before Publication

Decision: Safe source ingestion ends with a non-queryable `CHUNKING` draft and a successful ingestion job. Candidate validation prepares the exact immutable dense+sparse snapshot, reconciles its snapshot-only Qdrant partition, then atomically marks chunks/revisions/sources ready. Publication and rollback cannot become `READY` until that exact snapshot is attached.

Context: Treating chunk persistence as an indexing failure produced false failed jobs, while reusing mutable vectors or publishing before reconciliation could expose stale permissions or a different document set.

Consequences:

- Qdrant point identity includes workspace, snapshot, chunk, and index schema; READY reuse verifies stored point fingerprints without calling the provider, and missing/corrupt partitions rebuild only after exact membership comparison.
- External indexing and retrieval processors are nullable, tenant-approved, exact deployment policies with environment classification ceilings. Consent is rechecked immediately before every external batch and durable cache/index write.
- Embeddings are encrypted in object storage; PostgreSQL stores metadata only. Cache identity includes tenant, content, locale, deployment/schema, and policy, with immutable first-writer-wins publication and expiry independent of source references.
- Idempotency records use a short renewable `IN_PROGRESS` lease and extend to response retention only after a terminal result, so crashed preparation can be taken over safely.

## 2026-07-12: Keep Knowledge Test Results Server-Authoritative

Decision: The Knowledge Test browser submits either a question or saved-test identifier against one exact published or draft target, then renders only the server run result. It does not infer draft readiness, reconstruct evidence, or convert a failed or incomplete run into a successful answer.

Context: A client-computed preview could disagree with the live retrieval and delivery gates, expose restricted test input, or imply that an unready draft is safe to serve.

Consequences:

- Active runs poll only while the page is visible and focused, with one request in flight and the server delay clamped to 2-15 seconds.
- Protected test input is hydrated only through its authorized no-store endpoint; conditional mutation reloads preserve dirty input without exposing it elsewhere.
- Stable result, stage, reason, and support codes are localized in the browser. Stored strings remain text, and only validated public HTTPS anchors become links.

## 2026-07-12: Deny Framing Except For The Public Widget

Decision: LeadVirt web responses use an allowlisted Content Security Policy and baseline browser security headers. Product, auth, and marketing routes deny framing; `/widget/frame` is the only route that permits embedding by customer sites.

Context: Imported knowledge, model output, connector metadata, and source anchors are untrusted display data. React escaping remains required, but browser policy must also constrain script execution, active objects, framing, network destinations, and external media if a rendering defect occurs.

Consequences:

- Telegram Login Widget scripts/frames, the configured API origin, local development sockets, self-hosted assets, and the existing Unsplash images remain explicitly allowed.
- Inline event attributes and plugins/objects are blocked. Normal routes use `frame-ancestors 'none'`; the public widget frame uses `frame-ancestors *` and does not receive `X-Frame-Options`.
- Stored-XSS, unsafe-link, and CSP-console checks remain required in Knowledge source/Test browser acceptance; headers do not replace text escaping and URL validation.

## 2026-07-12: Gate Qdrant With Protocol And Real-Service Tests

Decision: Hybrid index changes must pass both a deterministic Qdrant v1.15 protocol suite and an isolated smoke against the pinned real Qdrant service.

Context: A mocked transport proves request structure, retries, and malformed-response handling, but cannot prove that collection schema, strict mode, named dense/sparse vectors, RRF queries, or payload indexes are accepted by the actual server.

Consequences:

- CI runs `qdrant/qdrant:v1.15.5` and exercises physical collection creation, acknowledged upsert, exact reconciliation, authorization-filtered hybrid query, and partition cleanup.
- The real smoke uses a unique workspace/publication/snapshot partition and removes it after the assertion path.
- Broader retained-snapshot, archive deletion, outage, and staging-isolation acceptance remains a separate required gate.

## 2026-07-12: Treat Review Resolution As An Audited Decision

Decision: Review and conflict endpoints record a scoped decision and terminal queue state; they do not directly edit facts, guidance, sources, index snapshots, or publications. Resolution actions must match the review reason and target, while unresolved linked conflicts close their review items only through one atomic conflict decision.

Context: A review action such as correcting a source or choosing a conflicting value can require separate versioned content work. Treating a queue click as that content mutation would bypass its own validation, evidence, publication, and rollback controls.

Consequences:

- Managers must claim low/medium-risk work before resolving it. High/critical decisions require an owner or administrator.
- Strong ETags, tenant-scoped idempotency, row locks, generation increments, and audit rows make concurrent claims and terminal outcomes deterministic.
- Raw payloads, rationales, restricted references, and unavailable candidate values are not returned or copied into audits. Value-selecting conflict outcomes fail closed unless an authorized safe display value exists.
- Bulk resolution uses the later exact homogeneous LOW-risk preview/execute contract; all other selections remain single-item only.

## 2026-07-12: Keep Test Questions In Server-Managed Restricted Storage

Decision: Knowledge v2 test-case mutations accept question text and optional restricted expected values, but the API immediately hashes and encrypts them under deterministic tenant/idempotency object keys. Only hashes and opaque references enter immutable versions; responses, idempotency records, and audits exclude both plaintext and references.

Context: Requiring browser clients to manufacture encrypted object references would expose storage internals and leave no usable customer flow. Storing raw questions in test-case, audit, or retry records would leak realistic customer prompts and expected answers.

Consequences:

- Owner/admin can manage tenant test cases; managers have read access and lower roles are denied.
- Repeated idempotency keys reuse the same encrypted object only when plaintext hashes match; conflicting restricted input fails closed.
- Test-case versions and expectations are immutable, while metadata uses conditional ETags and archive state.
- Playground runs remain unavailable until they can execute through the shared structured retriever against an explicitly pinned publication or draft target.

## 2026-07-12: Fence Website Ingestion At Durable Worker And Source Generations

Decision: `knowledge.ingest` reloads the runtime event, tenant, source, durable job, and requesting owner/admin before work, then checks the source generation again before database output. BullMQ delivery and retries transport work; PostgreSQL job attempts, source generations, immutable lineage, and deletion ledgers decide what may commit.

Context: A timed-out fetch, duplicate delivery, revoked actor, permission change, or cleanup retry must not publish stale content, duplicate artifacts, resurrect denied chunks, or erase an active publication. Queue payloads also cannot carry website content, URLs, or credentials.

Consequences:

- Import/sync uses pinned HTTPS acquisition, isolated parsing, content quarantine, encrypted deterministic raw/extracted objects, and one transaction for artifact/document/revision/element/chunk draft lineage.
- Successful acquisition and chunking do not imply queryability: safe drafts stay `CHUNKING` while the ingestion job succeeds. Exact candidate validation prepares and reconciles the immutable snapshot before readiness or publication can advance.
- Reconciliation never fetches the source; it denies old permission generations and creates reindex-pending immutable successors.
- Deletion is tombstone-first and ledger-driven. Missing object storage or required Qdrant cleanup remains failed/retryable instead of being reported complete, while hashes, manifests, and deletion evidence remain.
- Runtime expiry, final DLQ state, audits, logs, and metrics use stable codes and opaque identifiers only; active publication pointers are never changed by ingestion or cleanup failures.

## 2026-07-12: Separate Source Ingestion From Permission Reconciliation

Decision: Source import and explicit sync use ingestion jobs, while scope, classification, locale, and revision-exclusion changes use `RECONCILE` jobs. Permission versions and tombstones deny stale content immediately; vector/cache ledger rows preserve cleanup proof until reconciliation completes.

Context: Policy changes and exclusions must not refetch a website or depend on external egress and object-store readiness. Reusing `SYNC` would make urgent permission narrowing fail when acquisition is disabled and would blur generation-fencing semantics.

Consequences:

- Website URL/config admission runs before database transactions; workers repeat admission before network access.
- Material policy changes increment source permission and generation values in the same transaction as ledger, job, outbox, and audit records.
- Internal source classification requires an explicit internal audience in both create and partial-update paths; the browser cannot widen this invariant.
- Paused sources defer background work in `NEEDS_REVIEW` but still record the immediate deny and pending cleanup proof.
- Revision exclusion rejects the revision and chunks immediately, then queues reconciliation without fetching external content.

## 2026-07-12: Keep Website Imports Disabled Until Every Acquisition Gate Is Ready

Decision: Website source jobs are accepted only when application enablement, restricted-egress readiness, an absolute artifact store, and a valid artifact encryption key are all configured. API admission and workers share the same public-address and redirect policy. Workers connect to an admitted IP directly while preserving TLS SNI and hostname verification.

Context: URL syntax checks alone do not prevent DNS rebinding, redirect pivots, metadata access, decompression abuse, parser exhaustion, hidden prompt injection, or raw-content leakage. A partially configured import feature would create jobs that cannot finish safely.

Consequences:

- Only HTTPS on the standard port is admitted; userinfo, internal destinations, query-bearing root or redirect URLs in the first slice, unsafe redirects, compressed bodies, unsupported MIME, and oversized responses fail closed.
- HTML parsing runs in a memory-limited worker thread with a hard deadline and no script execution. Hidden content is excluded from evidence but retained as bounded security-review signal.
- Secret, sensitive, and prompt-injection findings scan bounded visible text, hidden text, and decoded link metadata; they store codes and counts, not snippets, and quarantine content before publication.
- Raw and extracted artifacts use opaque tenant/source keys and AES-256-GCM atomic storage; queues, logs, audit payloads, and public errors never carry content or raw URLs.
- Production remains disabled until the host/network egress policy, encryption secret, dense+sparse indexing, immutable snapshot preparation, and publication gates are provisioned and verified.

## 2026-07-12: Bind Structured Source Lineage And Snapshot Corpus In PostgreSQL

Decision: Structured sources, artifacts, documents, immutable revisions, elements, chunks, snapshot memberships, jobs, and deletion entries use separate v2 records with composite tenant lineage. Index snapshots and their item tables carry `corpusKind`, and publications reference snapshots through tenant, snapshot, and corpus together.

Context: ID-only relations could associate a child with the wrong tenant/source/document, and a structured publication could otherwise point to a legacy index snapshot even while its manifest contained v2 facts and rules.

Consequences:

- Database constraints reject cross-tenant/source/document/revision associations and mixed-corpus snapshots.
- Publication document items bind the exact v2 revision content hash.
- Legacy source and revision relations remain intact during migration; v2 jobs use separate source/revision fields.
- Source deletion is tombstone-first. Its deletion ledger uses `NO ACTION`, so physical cleanup cannot erase the proof needed for reconciliation and audit.

## 2026-07-12: Derive Fact Authority From Provenance And Verification

Decision: Client-created facts always begin with `MANUAL` authority. Authority cannot be edited directly. Owner or admin verification creates an immutable successor with `OWNER_VERIFIED` authority; source ingestion will assign imported authority from server-owned provenance.

Context: Accepting authority from a browser would let an editor bypass the publication gates for trusted and high-risk knowledge. Risk, expiry, evidence, and verification still remain separate controls.

Consequences:

- Explicit attempts to create or update a fact with a stronger authority fail with `KNOWLEDGE_VALIDATION_AUTHORITY_READ_ONLY`.
- High and critical facts require owner/admin verification, derived owner authority, evidence, and a future expiry before publication.
- Authority changes remain reproducible in immutable fact history rather than mutating an existing version.

## 2026-07-12: Keep Active Conversations Fresh With Visible Polling

Decision: The Inbox and open conversation refresh every four seconds while the document is visible and refresh immediately when the window regains focus. Refreshes keep the last successful state after transient failures, never apply responses made stale by a concurrent mutation, and do not disturb a manager reading message history.

Context: Telegram updates were reaching the relay, API, database, and Inbox query, but the client fetched only once on mount. A message received after the page opened remained invisible until navigation or reload.

Consequences:

- New inbound messages appear without a full page reload.
- Hidden tabs stop polling, and overlapping requests are suppressed.
- Locale changes preserve existing Inbox data when their first refresh fails.
- Unchanged message data keeps the existing array, while changed data auto-scrolls only when the manager was already near the bottom.
- Sends and conversation or lead actions advance a mutation epoch; older poll responses are discarded.
- This is the bounded pilot transport until a shared server-push channel is justified.

## 2026-07-12 - Isolate Structured Knowledge v2 From the Legacy Corpus

**Decision:** Add immutable typed facts, guidance, evidence, validation, and publications as `STRUCTURED_V2` while retaining the Phase 0 onboarding corpus as `LEGACY_V1`. Structured candidates publish explicitly to `workspace-v2`; legacy automatic publication continues only through its compatibility adapter. Runtime selection will capture one corpus and publication at graph start and never merge both.

**Context:** Changing the existing `/knowledge/sources` contract or reusing its automatic publisher would make a v2 publish mean "whatever is current" and could expose partially migrated data. The new client also needs durable idempotency, conditional writes, exact manifests, and rollback without directly reactivating stale permissions.

**Consequences:** Publication rows and items carry a database-enforced corpus discriminator and typed hash-bound references. Public and manual v2 writes require `Idempotency-Key`; existing resources require `If-Match`. The internal onboarding projection is tenant-serialized, uses deterministic semantic keys, and queues its own reconciliation idempotency key. The first v2 publication is explicit, rollback creates and validates a new sequence, and the legacy live path remains unchanged until a separate audited cutover passes retrieval, isolation, quality, and rollback gates.

## 2026-07-12: Separate Business Truth And Publish Immutable Knowledge Snapshots

Decision: LeadVirt Knowledge separates verified structured facts, versioned documents, behavioral guidance, live operational tools, and conversation context. PostgreSQL is authoritative, object storage preserves immutable artifacts, and Qdrant stores rebuildable immutable index snapshots referenced by an atomic active publication.

Context: The prototype stores profile, catalog, availability, FAQ, policy, and escalation as mutable source text. Onboarding does not index it automatically, live replies bypass Qdrant, old vectors can remain searchable, and a source edit cannot be reproduced reliably. Exact prices, policies, and current availability also need different authority and freshness rules from semantic documents.

Consequences:

- Product UI is called Knowledge and reports deterministic readiness per enabled capability instead of one opaque confidence score.
- Typed facts, rules, source evidence, authority, risk, locale, scope, effective dates, conflicts, and immutable revisions replace arbitrary JSON/text as the long-term truth model.
- A draft or failed import never replaces the current publication. Activation is a compare-and-swap of `ActiveKnowledgePublication` after its manifest and index snapshot pass reconciliation and quality gates.
- Rollback creates and validates a new publication from an older manifest; it cannot reactivate revoked, deleted, expired, or incompatible content directly.
- Dynamic availability, inventory, order, and customer state come from authorized tools at response time and are not embedded as authoritative truth.
- Answer reproducibility is guaranteed within the configured audit-retention period; lawful erasure and retention expiry retain only permitted hashes, manifest metadata, and deletion evidence.
- `docs/BUSINESS_KNOWLEDGE_SYSTEM_DESIGN.md` is the implementation contract and rollout sequence for this system.

## 2026-07-12: Use One Shared Retrieval Path And Deterministic Worker Boundaries

Decision: LangGraph, preview, diagnostics, and evaluation use one tenant-aware retrieval service. Production document retrieval uses Qdrant multilingual dense+sparse fusion, grouping, reranking, and PostgreSQL authorization hydration against one immutable index snapshot. LangGraph orchestrates response decisions and human review; deterministic ingestion remains idempotent BullMQ workers. AutoGen and FAISS remain offline research/evaluation tools.

Context: API search can currently call Qdrant, while the production reply worker scans 40 SQL chunks using token overlap and returns arbitrary chunks on no match. Create/update/onboarding do not enqueue indexing. Retry timeout does not cancel work, tools execute before final persistence, and the current audit/DLQ path is not enough to prevent duplicate side effects.

Consequences:

- Silent fallback to an unrelated lexical corpus is prohibited. Document-dependent answers hand off when the evaluated retrieval path is unavailable or insufficient.
- Read-only live lookup tools run before drafting; state-changing tools run after recorded confirmation, refreshed preconditions, deterministic operation idempotency, and authorization.
- Business mutation/outbox and consumer result/inbox/next-outbox commit atomically. Generation fencing, per-conversation ordering, durable DLQ, and explicit `unknown` external outcomes handle at-least-once delivery.
- Minimum SSRF, upload, parser sandbox, post-parse PII/secret/injection, provider-admission, permission, and deletion controls precede any website/file/model exposure.
- Evaluation uses production-k per-language/risk slices, hard zero-tolerance isolation/security cases, tenant critical cases, and human-calibrated semantic judges.
- OpenTelemetry/Prometheus/Grafana record bounded metadata by default; prompt, document, and customer content capture remains disabled unless separately authorized.
- Phase 0 must establish minimal revisions, publication/index snapshot, outbox, shared retrieval, and side-effect fencing before any live cutover.

## 2026-07-12: Make PostgreSQL Authoritative Across Reply Queue Boundaries

Decision: AI reply intake, manual channel sends, worker consumption, internal tool effects, and channel delivery use PostgreSQL outbox/inbox records, deterministic operation identities, deadlines, and conversation generation/sequence fences. Redis/BullMQ transports work but does not decide whether work exists or may execute.

Context: Direct Redis publishing, synchronous fallback, retryable graph execution, and external provider timeouts could lose a committed inbound message, duplicate a side effect, send an old reply after newer customer input, or silently replay an ambiguous provider outcome.

Consequences:

- In queue mode, inbound message, reply run, captured publication, reply sequence/fence, and outbox event commit together; Redis outage never triggers an unfenced synchronous reply.
- Consumers authorize the exact persisted queue envelope, suppress duplicate execution through an inbox lease/result, enforce event deadlines, and dead-letter poison or exhausted work while updating the related reply/message terminal state.
- Conversation creation and inbound processing are serialized by external identity. Tenant/conversation/message/channel relationships are also enforced by composite database references and an active external-conversation uniqueness constraint.
- Final AI channel delivery holds the same conversation row lock used by inbound intake while rechecking the reply fence and starting the provider call.
- Tool and channel operations in `STARTED` or `UNKNOWN` are not resent automatically. An operator reconciliation/redrive path is required before those outcomes can continue.
- This provides at-least-once processing with deterministic suppression; it does not claim exactly-once semantics from Telegram, webhooks, or other external providers.

## 2026-07-11: Route Telegram Through The Restricted FR Gateway

Decision: API and worker Telegram Bot API calls use `TELEGRAM_BOT_API_BASE_URL`, while Telegram registers webhooks through `TELEGRAM_WEBHOOK_BASE_URL`; both point in production to the French external API gateway.

Context: The main LeadVirt VPS cannot communicate reliably with Telegram's network. Outbound Bot API calls timed out, and Telegram accumulated pending updates with `Connection timed out` before any request reached LeadVirt Nginx.

Consequences:

- The FR Nginx gateway maps `/telegram/` to `api.telegram.org` and remains restricted to the main VPS source IP.
- The POST-only `/telegram-webhook/` route accepts Telegram updates and forwards the unchanged body and secret header to LeadVirt.
- Telegram access and non-emergency error logging are disabled at the gateway because Bot API paths contain secret bot tokens.
- Local development defaults to direct Telegram access; production config selects the gateway for provisioning, delivery, and inbound webhooks.

## 2026-07-11: Run Integrations From Compiled JavaScript

Decision: The integrations workspace package exposes `dist/index.js` in production and CI imports that exact entry point after building it.

Context: API and worker production processes previously resolved the package to TypeScript source. Node 24 strip-only loading cannot execute all TypeScript syntax and does not resolve the package's `.js` relative imports to `.ts` source files.

Consequences:

- API and worker load ordinary JavaScript from the integrations package in production.
- The package no longer depends on the wider shared-types source tree just to describe adapter channel literals.
- Deployment verification fails before rollout when the built integrations entry point cannot be imported by Node.

## 2026-07-11: Manage Telegram Setup Behind One Bot Token

Decision: Clients provide only the BotFather token. LeadVirt owns Telegram webhook provisioning, verification, security, health checks, reconnect, disconnect, and outbound delivery.

Context: Asking clients for bot usernames, webhook URLs, secret headers, and allowed updates exposed infrastructure details and still did not register the webhook automatically. The channel layer already generated a secure secret, but the integrations form and Bot API lifecycle were disconnected.

Consequences:

- `POST /integrations/TELEGRAM/connect` validates the token with `getMe`, prevents active cross-workspace bot reuse, creates or reuses the tenant channel, calls `setWebhook`, and verifies the exact URL with `getWebhookInfo`.
- Bot tokens are AES-256-GCM encrypted in `Channel.encryptedCredentials`; Telegram webhook secrets remain server-managed and are redacted from channel and integration responses.
- Reconnecting without a token reuses stored credentials. Superseding the original rotation behavior, ordinary bot replacement reuses the active webhook secret so queued updates from the retired bot remain valid; its encrypted cleanup credential is retained until the queue drains and webhook deletion is confirmed.
- Telegram delivery uses the real Bot API when encrypted credentials exist; demo/sample traffic retains deterministic simulated delivery.
- Standard Telegram bots still need to be created in BotFather, but no Telegram infrastructure knowledge is required from the client after token creation.

## 2026-07-11: Keep Product Scrolling Compositor-Safe

Decision: LeadVirt product surfaces use opaque or semi-opaque backgrounds without persistent `backdrop-filter` layers, oversized fixed CSS blurs, or hover blur glows.

Context: Those effects forced continuous repainting and compositing beneath fixed navigation, sticky headers, cards, and modal overlays, producing delayed wheel and trackpad scrolling across the workspace.

Consequences:

- Product layout, cards, dialogs, dropdowns, onboarding, and operational pages retain their existing structure, borders, and color hierarchy with cheaper background fills.
- Browser coverage rejects blur utility layers in the product shell and measures wheel-to-scroll response on both the page and a mobile modal.
- Marketing visuals remain independent from this product-workspace performance rule.

## 2026-07-11: Use Beget SMTP For Initial Email OTP Delivery

Decision: LeadVirt uses authenticated Beget SMTP for production email OTP until `leadvirt.com` becomes eligible for UniSender sender verification. UniSender remains supported behind the same provider boundary.

Context: UniSender blocks SMTP/sender setup for domains registered less than 30 days ago. Beget already hosts the domain mailbox and provides authenticated SMTP over implicit TLS on port 465.

Consequences:

- `EMAIL_OTP_PROVIDER=smtp` uses `smtp.beget.com` with the full mailbox address and a server-only password.
- SMTP delivery uses TLS certificate validation, bounded connection/socket timeouts, and closes each transport after the OTP is accepted.
- Production email OTP was enabled only after authenticated SMTP verification and a controlled provider-accepted OTP request succeeded; manual inbox delivery and OTP sign-in were subsequently verified on `leadvirt.com`.

## 2026-07-10: Add Passwordless Email OTP Through UniSender

Decision: LeadVirt supports email OTP as a passwordless authentication mode alongside Telegram. OTP delivery uses the classic UniSender `sendEmail` API behind a provider adapter, while session authorization continues through database-backed HTTP-only cookies.

Context: International users need an authentication path that does not require Telegram. UniSender requires a verified sender, a contact list, and at least 60 seconds between messages to the same recipient.

Consequences:

- Six-digit codes expire after 10 minutes, are stored only as keyed hashes, allow five attempts, and are consumed atomically once.
- Request throttling is enforced in the API and database; delivery failures do not invalidate an earlier valid code.
- `EMAIL_OTP_PROVIDER` is isolated from password-reset `EMAIL_PROVIDER`, and successfully delivered challenges retain the database resend lock after verification.
- IP-wide throttling uses validated Nginx proxy metadata instead of trusting the first client-supplied forwarded address.
- New verified emails create trial workspaces; existing users retain their workspace and receive `authMode=email` sessions.
- Email OTP does not depend on password auth and does not require TOTP; mailbox possession is the authentication factor.
- Production stays disabled until the exposed setup key is rotated and the configured sender is verified in UniSender.

## 2026-07-10: Use English As The Default Across Six UI Locales

Decision: LeadVirt supports English, Spanish, French, German, Portuguese, and Russian through one typed localization contract. English is the default when no valid `leadvirt-locale` cookie exists.

Context: The `.com` product needs a broadly accessible default and a language menu that scales beyond the initial Russian/English release.

Consequences:

- The shared dropdown exposes all six languages by native name and persists selection in the existing cookie.
- Dates, relative time, weekday labels, metadata, Telegram login, onboarding, the shared product shell, and dashboard follow the active locale.
- Shared brand placements render the `LeadVirt.ai` wordmark with `Virt` in the emerald brand color.
- Deep operational pages remain a tracked localization task.

## 2026-07-10: Start UI Localization With Russian And English

Decision: LeadVirt initially supports Russian and English through one typed client localization contract. This default-locale decision was superseded later the same day by the six-locale English-default decision above.

Context: The production UI was Russian-only, including fixed `ru-RU` formatters and Telegram widget language. The `.com` product needs an English path without duplicating routes or changing existing public URLs.

Consequences:

- Landing, pricing, industry examples, auth, onboarding, product shell, and dashboard switch immediately between RU and EN.
- The root layout sets the HTML language from the cookie; shared formatters use the active locale.
- Existing paths remain canonical without locale prefixes.
- Deep operational pages remain a tracked migration and must not be described as fully localized yet.

## 2026-07-10: Permanently Retire The Former .ru Domain

Decision: The former `.ru` domain is no longer a LeadVirt runtime, redirect, API compatibility surface, CORS origin, or maintained TLS identity.

Context: Production is established on `leadvirt.com`, BotFather uses `.com`, the Master Budet webhook bridge was migrated, the database contains no stored `.ru` URLs, and the Telegram login bot has no webhook.

Consequences:

- nginx rejects unmatched HTTP hosts and TLS handshakes instead of serving or redirecting the former domain.
- Its Let's Encrypt certificate is deleted and no longer renewed.
- The apex and `www` DNS records must be removed from the Beget zone so the names stop resolving after cache expiry.

## 2026-07-10: Serve Master Budet Through The Shared HTTPS Edge

Decision: The LeadVirt-managed nginx edge terminates TLS for Master Budet, proxies the apex to the separately deployed `masterbudet-backend` and `masterbudet-frontend` services through deferred Docker DNS, and redirects `www` to the apex.

Context: Both products run on `193.187.92.88`, where LeadVirt owns public ports 80/443. Master Budet needs an independent certificate and SNI virtual hosts so HTTPS requests cannot fall through to LeadVirt's default server. The authoritative apex and `www` A records now point to the shared VPS.

Consequences:

- Master Budet HTTP traffic and `https://www.masterbudet.ru` redirect to the HTTPS apex, which uses its own proxy routes.
- Master Budet remains a separate Compose project and database; sharing the edge does not merge application ownership or data.
- `/etc/letsencrypt/live/masterbudet.ru` covers both the apex and `www`; the generic certificate renewal job renews it.

## 2026-07-10: Authorize Telegram Login On leadvirt.com

Decision: BotFather `/setdomain` for `@LeadVirtAi_bot` uses `leadvirt.com`.

Context: After the TLS cutover, the live Telegram iframe correctly used the `.com` origin but returned `Bot domain invalid` until the allowed domain was updated.

Consequences:

- The live iframe renders the Telegram login control without a domain error.
- Clicking the real widget opens `oauth.telegram.org/auth` with `.com` origin and return URL parameters.

## 2026-07-10: Use The LeadVirt Logo In Frontend Brand Placements

Decision: `/brand/logo.png` is the shared frontend brand asset. Compact brand placements show its symbol through `BrandMark`; functional AI/bot icons remain unchanged.

Context: The supplied logo combines the symbol and wordmark on a square canvas, while the existing landing, auth, onboarding, and product-shell placeholders are 24–36 px marks beside product copy.

Consequences:

- Landing header/footer, auth, onboarding, and product sidebar use one reusable brand component.
- The compact crop keeps the symbol legible without changing existing layout or product-name text.
- A future standalone transparent symbol can replace the source or crop inside `BrandMark` without editing every surface.

## 2026-07-10: Cut Over Production To leadvirt.com

Decision: `https://leadvirt.com` is live as the canonical production origin on release `1b5246588620`.

Context: Beget DNS was moved to `193.187.92.88`; GitHub Actions run `29088096062` passed all verification and deployment gates after correcting the ACME preflight path.

Consequences:

- Apex TLS is trusted, `www.leadvirt.com` and browser traffic on `leadvirt.ru` redirect to the `.com` apex, and legacy `.ru` API routes remain proxied.
- Runtime/build URLs and CORS use `.com`; certificate renewal covers apex and `www`.
- Public widget routes and intake passed live Playwright checks; Telegram login remains blocked until BotFather allows `leadvirt.com`.

## 2026-07-10: Preserve Master Budet Routes In The Shared LeadVirt Edge

Decision: LeadVirt's repository nginx configuration retains the live `masterbudet.ru` HTTP proxy routes. Master Budet upstream names use deferred Docker DNS so nginx can start when those containers are not attached.

Context: The first `.com` deployment audit found live-only Master Budet routes in `/opt/leadvirt/current/deploy/nginx.conf`. Replacing nginx from the repository without merging them would take that site offline.

Consequences:

- LeadVirt domain deployments preserve Master Budet health, API, uploads, frontend, and ACME routing.
- Missing Master Budet containers produce request-time `502` responses rather than preventing the LeadVirt nginx container from starting.
- Domain migration QA guards the shared route and deferred resolver.

## 2026-07-10: Correct The Canonical Production Origin To leadvirt.com

Decision: `https://leadvirt.com` is the canonical production origin. This supersedes the same-day `leadvirt.ai` migration decision; `LeadVirt.ai` remains the product name and existing staff/test account domain.

Context: `leadvirt.com` was registered through Beget on 2026-07-08. Its apex and `www` records currently point to Beget's `45.130.41.70` placeholder instead of the LeadVirt VPS, and its current HTTPS certificate is not trusted.

Consequences:

- Beget DNS must point both `.com` hosts to `193.187.92.88` before the gated TLS/deploy cutover runs.
- Workflow, nginx, certificate, public env, callback, widget, and operator URLs target `.com`.
- `leadvirt.ru` retains API/health compatibility and redirects browser traffic to `.com` during migration.
- Product copy and existing `@leadvirt.ai` identifiers do not change as part of this domain-only move.

## 2026-07-10: Move The Canonical Production Origin To leadvirt.ai

Decision: `https://leadvirt.ai` replaces `https://leadvirt.ru` as the canonical production origin. The current Russian product moves with the domain; localization remains a separate product decision.

Context: This supersedes the 2026-07-04 domain split. As of 2026-07-10, public DNS and registry RDAP have no `leadvirt.ai` record, so repository preparation must not switch the live release before domain registration and DNS propagation.

Consequences:

- The `.ai` deploy preflights apex and `www` DNS, ACME reachability, certificate issuance, and nginx validity before changing `/opt/leadvirt/current`.
- `leadvirt.ru` keeps its certificate, proxies `/api/*` and health checks, and redirects browser routes to `leadvirt.ai` during migration.
- Server-side public URLs, CORS, OAuth callbacks, widget embeds, Telegram Login Widget configuration, and operator links move to `.ai`.
- Existing `.ru` browser sessions cannot cross the top-level-domain boundary and users must authenticate again on `.ai`.

## 2026-07-09: Use Provider-Specific Integration Setup Dialogs

Decision: Each integration card opens a setup dialog that matches the provider's real connection path. Self-serve providers save their relevant credentials/settings; request-only and soon providers show the required setup data and documentation without saving or marking the integration connected.

Context: amoCRM/Google/Webasyst use OAuth-style setup, Bitrix24/Telegram/Meta/VK use webhook/token flows, RetailCRM/Shopify use API keys, and Email uses IMAP/SMTP. A single generic URL/token form made onboarding misleading.

Consequences:

- Users see the right fields/checklist for each provider before attempting setup.
- Non-pilot providers remain visible as request/soon without dead buttons or fake connection state.
- Future native provider work can reuse the dialog metadata and enable saving when backend support is ready.

## 2026-07-09: Integration Setup Does Not Mean Connected

Decision: Clicking "Connect" on a disconnected integration card opens the settings dialog first. The UI must not mark the integration as connected until the backend returns `CONNECTED`.

Context: During pilot onboarding, entering settings is not proof that an external service is actually connected.

Consequences:

- Disconnected cards stay visually disconnected while users configure credentials or endpoints.
- Saving settings can create/update a disconnected integration row for self-serve providers.
- Real connection status remains owned by the backend integration account state.

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
- Superseded for amoCRM, Bitrix24, and RetailCRM on 2026-07-15: the compatibility QA name now runs the fail-closed CRM truthful-state contract, and those providers cannot create missing rows until live implementations exist.

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

## 2026-07-13: Cut Knowledge Runtime Over Once Per Tenant And Graph

Decision: Legacy knowledge migrates one-way into immutable `legacy_snapshot` revisions, while each tenant selects either `LEGACY_V1` or `STRUCTURED_V2` and every AI graph pins one exact publication at creation.

Context: Mixing legacy and structured results would make answers non-reproducible. Current onboarding, tenant, and settings observations can also disagree even when no legacy knowledge source exists.

Consequences:

- Migration snapshots current source versions only; it never expands the old version counter into invented revision history.
- A system observable snapshot covers zero-legacy tenants, and disagreements create Review/Conflict blockers before publication or cutover.
- Cutover requires a READY migration, an exact active publication, current permissions, reconciled PostgreSQL snapshot membership, and successful physical index verification.
- The selector is one-way, and existing AI runs keep their captured publication through concurrent cutover.

## 2026-07-13: Ground Knowledge Test Answers With Server-Owned Evidence Gates

Decision: Knowledge v2 Test answers use a vendor-neutral structured provider contract, but the server assembles final text only from validated ordered claims and permits auto-send only for exact authoritative support.

Context: Provider citations and prose are untrusted. Tenant consent, evidence membership, current permissions, exact values, guidance, and generation policy can change between retrieval, generation, and commit.

Consequences:

- Every external generation or single repair call requires the current tenant model-processor policy and exact configured provider/model/version/region/classification ceiling.
- Document claims must be exact normalized spans; fact, guidance, and live-tool claims must preserve authoritative content. High-risk document-only support is denied.
- Evidence and processor policy are revalidated in the result transaction; failed gates produce no answer or validated citations.
- Evaluation result JSON and final answer are encrypted separately. `responseHash` identifies final answer text, while `restrictedResultHash` verifies the UI result artifact.
- Provider/model/prompt/policy, provider-output, gate-input, and gate-result hashes are persisted for audit and replay analysis.

## 2026-07-13: Use The Shared Grounded Gate For Live Structured Replies

Decision: Live `STRUCTURED_V2` worker replies use the same grounded-answer service and output gate as Knowledge Test; the legacy provider path remains separate.

Context: Provider prose and citations cannot authorize themselves, and evidence or tenant processor consent can change after generation or persistence.

Consequences:

- Structured generation requires the tenant-selected corpus and exact provider/model/version/region policy before each provider call.
- Structured tools are default-denied, and operational answers require a fresh authorized live-result handoff.
- Evidence, policy, answer, provider-output, gate, and citation hashes are revalidated in the fenced commit and immediately before channel delivery.
- Revocation, mixed corpus, unsupported claims, expired live evidence, or missing audit identity produces handoff/skip without a channel provider call.

## 2026-07-13: Bound Live Knowledge Metrics To Stable Safety Labels

Decision: Live `STRUCTURED_V2` retrieval and answer metrics expose only fixed corpus, backend, outcome, reason, risk, result, and canonical locale buckets.

Context: Retrieval quality and answer safety need operational visibility, but tenant, conversation, evidence, content, URL, provider output, and raw locale labels would leak data or create unbounded Prometheus cardinality.

Consequences:

- Locale is reduced to `en`, `fr`, `de`, `es`, `pt`, `ru`, or `other`; unknown reasons and label values map to fixed fallbacks.
- Retrieval metrics report duration, candidate/selected counts, and grounded/empty/degraded/blocked outcomes.
- Answer metrics report pass/block reason, bounded risk, validated citation count, and evidence-reference coverage.
- Grafana aggregates only these stable labels; deterministic smoke coverage rejects tenant, conversation, evidence, question, answer, provider/model, and raw-locale markers.

## 2026-07-13: Measure Queryability At Durable Publication Boundaries

Decision: Knowledge v2 publication telemetry records success only after the activation outbox transitions from `PUBLISHING` to `PUBLISHED`, and records failure only on the first durable `DEAD_LETTER` transition.

Context: Activation may be retried, replayed, or reconciled after the publication pointer already committed. Measuring service calls or retry attempts would double count and would not represent when content became queryable.

Consequences:

- Published replay and committed-activation reconciliation do not emit another success observation; nonterminal retries do not emit failed outcomes.
- Time-to-queryable measures candidate validation, publication creation, and each immutable fact/guidance/document version against the committed activation time.
- Publication outcomes and durations use only fixed `result`, `operation`, `item_kind`, and `source_kind` labels; source kind is `website`, `manual`, or `other`.
- Tenant, publication, job, content, URL, error-code, and raw source identifiers never appear in labels or dashboard dimensions.

## 2026-07-13: Gate Publication On Exact Critical Evaluation Runs

Decision: Publication activation requires a completed `PUBLICATION` evaluation run against the exact validated draft candidate, with every current critical saved test-case version passed. Tenants with no critical cases are not blocked.

Context: Validation blockers protect manifest integrity, but they do not prove that the current critical behavioral cases still pass through the production retriever and grounded-answer gate.

Consequences:

- MANUAL and PUBLICATION batches reuse the same retriever, evidence revalidation, grounded generation, result persistence, and lease/redrive path as Test playground runs.
- Runs capture the complete ordered ACTIVE test-case version set and exact target identity; target, requester role, or current-version changes fail closed.
- Activation checks the current test-set hash and exact candidate tuple inside the publication transaction before pointer mutation.
- Aggregate APIs expose deterministic safe metadata only; questions, answers, and restricted storage references remain encrypted and redacted.

## 2026-07-13: Evaluate Critical Knowledge Per Locale Before Activation

Decision: Evaluation aggregates publish canonical locale, immutable risk, and pinned critical-status slices, and activation requires every current critical case to pass within its locale. Publish and rollback activation both wait for a durable exact-candidate PUBLICATION evaluation.

Context: A strong global pass rate can hide a failed language. Rollback candidates are generated server-side and therefore also need a server-owned evaluation stage rather than an impossible client preflight or a gate exemption.

Consequences:

- Slice and manifest hashes sort immutable result signatures, so database order cannot change historical aggregate identity.
- Readiness exposes candidate manifest, validation, and current test-set hashes for safe UI recovery; the activation transaction remains the final freshness fence.
- Pending evaluation does not consume publication activation attempts. Failed critical evaluation leaves the active pointer unchanged.
- Mock-provider EN/FR/DE/ES/PT/RU contract coverage is not evidence of real-provider multilingual dense/sparse quality; measured locale floors remain open.

## 2026-07-13: Reconcile Every Manual Content Version Durably

Decision: Every successful manual fact or guidance mutation creates one content-free validation/reconciliation job and outbox event in the same idempotent transaction as its immutable version.

Context: Draft generation changes were durable, but manual edits had no leased processing record proving that the exact new head version was reauthorized and reconciled after commit.

Consequences:

- Queue data contains IDs, hashes, generations, action, actor identity/role, deadline, and an idempotency hash only.
- The dispatcher fails closed when the actor, head version, resource generation, action status, or tenant draft generation changes.
- Leases, attempts, heartbeats, cancellation, expiry, and redrive use the existing Job/Outbox/Inbox tables; no schema change is required.
- Reconciliation jobs appear in Overview and never mutate the active publication pointer or auto-publish content.

## 2026-07-13: Admit Files Before Persistence And Fail Closed Without A Scanner

Decision: File bytes must pass one reusable streaming admission contract before artifact persistence. Production rejects admission unless a production-approved scanner returns CLEAN within the configured deadline.

Context: Persisting first and scanning later creates an avoidable malicious-object window. Filename, MIME, active-content, polyglot, macro, archive, and decompression attacks also require deterministic local gates even when a malware scanner is healthy.

Consequences:

- Only bounded text, CSV, and passive PDF inputs are currently allowlisted; extension, declared MIME, and detected content must agree.
- Rejected files receive stable safe error codes but no SHA/provenance metadata, filename log field, or content-bearing audit field.
- The deterministic scanner is test-only and is rejected by production-mode admission.
- No public upload or FILE source API is added. Signed upload/storage lifecycle, real scanner provisioning, and provider ACL integration remain required before file import can ship.

## 2026-07-13: Exercise The Fresh-Owner Knowledge Path Without Seeding Internals

Decision: The required fresh-owner acceptance gate uses public OWNER APIs, the production website ingestion and publication path, real PostgreSQL and Qdrant, and deterministic acceptance-only network providers. It never seeds chunks, snapshots, vectors, review rows, or publication state.

Context: CI needs a stable end-to-end signal without depending on public DNS, internet content, or paid model providers. Production SSRF rules correctly reject localhost and private addresses.

Consequences:

- A fixed HTTPS URL is resolved to a synthetic public address and served by a pinned transport only when both `APP_ENV=acceptance` and `KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_ENABLED=true` are set.
- Local embedding, reranking, and grounded-answer HTTP fixtures are consumed through the production provider clients; Qdrant remains a real service.
- Safe website content completes in `CHUNKING` with inspectable evidence and an empty review queue; the test does not fabricate review work that the production path did not create.
- CI fails on Qdrant or SQL cleanup errors and removes the dedicated encrypted object-store directory after the acceptance processes stop.

## 2026-07-13: Probe Knowledge Dependencies Outside User Traffic

Decision: Dependency health uses fixed-name, cached, single-flight background probes with hard deadlines. Prometheus scrapes both the API cache and OpenTelemetry Collector internal metrics; user requests never wait for dependency probes.

Context: Knowledge availability depends on PostgreSQL, Redis, Qdrant, object storage, configured model endpoints, and trace export. Running synchronous probes per request or scrape would amplify outages, while writing an object per scrape would mutate production state.

Consequences:

- Probe labels are limited to a fixed dependency enum and failure class; tenant, content, endpoint, provider, model, and region values are excluded.
- Object-storage health uses read-only path access and metadata checks. Network probes are bounded, cached, and reused while a refresh is in flight.
- Probe age and stale gauges distinguish a recent failure from an unobserved dependency; last-known values remain available during refresh.
- OTLP traffic routes through the Collector before Tempo, and Prometheus alerts on Collector exporter send/enqueue failures without exposing Collector or API metrics publicly.

## 2026-07-13: Reconcile Unknown Effects Through Read-Only Evidence

Decision: Owner/admin reconciliation may transition an `UNKNOWN` external, tool, or channel operation only after an adapter read returns authoritative success or failure. Redrive is separate and limited to explicitly proven pre-execution internal work.

Context: Repeating a send or tool mutation after an ambiguous response can duplicate a customer-visible effect. Existing operation ledgers and outboxes already retain the durable state needed for a schema-free operator surface.

Consequences:

- Unsupported, unavailable, pending, or ambiguous provider reads leave the operation `UNKNOWN`; the operator path never calls adapter send/mutation methods.
- Mutations reauthorize the current membership and lock exact tenant, row version, status, and generation behind ETag and idempotency fences.
- External/tool/channel `UNKNOWN` records cannot be redriven. Only allowlisted internal outbox work with a proven-not-executed code creates a new immutable generation; source history is unchanged.
- Responses and audits omit payloads, provider references, request hashes, recipient/channel keys, raw errors, and reasons. Audits retain actor, opaque IDs, stable codes, and hashes only.

## 2026-07-13: Establish The Tenant Transaction Boundary Before RLS

Decision: Tenant-scoped PostgreSQL work will use one validated interactive transaction that applies tenant, user, role, and request/job source through transaction-local `set_config` on the exact Prisma connection. The callback receives only an active scoped transaction client. RLS policies remain disabled.

Context: Prisma root-client queries can use different pooled connections, while session settings can leak across pool reuse. Enabling RLS before all tenant work enters a same-connection boundary would produce inconsistent failures or unsafe bypasses. Current deployment credentials also own tenant tables and local/CI roles are superusers with `BYPASSRLS`.

Consequences:

- Invalid context, nested transactions, and expired scoped-client reuse fail before another transaction or query begins.
- Commit and rollback clear context through PostgreSQL transaction semantics; no session-scoped cleanup query is trusted.
- API requests and background jobs use explicit adapters and always carry tenant, actor user, membership role, and source. Admin role is explicit rather than an implicit bypass.
- Service filters, authorization, membership revalidation, and composite tenant constraints remain mandatory.
- Every tenant-bearing service phase must migrate, external I/O must stay outside bounded DB transactions, and a non-owner `NOBYPASSRLS` runtime role must pass staging posture checks before reviewed policies can be enabled and forced.

## 2026-07-13: Promote One Encrypted Upload Object Into A FILE Artifact

Decision: A FILE upload uses a durable tenant intent, purpose-separated signed bearer token, and one encrypted quarantine object. After exact admission, the same object key becomes the immutable artifact in the atomic source/job commit; the system does not create a second pre-transaction copy.

Context: Local object storage is the deployed capability. Copying admitted bytes to a second final key before the database transaction can leave an unreferenced object when quota, role, lease, or database checks fail. Persisting a raw filename/path or token in a queue/idempotency record would also expand the secret and traversal surface.

Consequences:

- Upload policy pins one allowlisted MIME, exact byte length, 10 MiB platform ceiling, deadline, one-time use, and an opaque server-owned key. Tokens stay in an Authorization header and are never stored in plaintext.
- Receipt state and audit commit together. Scanner/storage preparation stays outside the DB transaction; mutation failure restores the still-referenced encrypted intent object for a new idempotency key.
- Final source, CLEAN/VALID artifact, content-free job/outbox, tenant-composite references, completion state, and audit commit atomically. Worker and deletion fences apply unchanged.
- Only UTF-8 TXT and CSV ship. PDF admission capability does not imply parsing support; the API returns the sandbox-required error before upload intent persistence.
- Production remains disabled until the FILE enable flag, valid encrypted store, and explicitly approved ClamAV endpoint are all configured. Provider ACL/webhook ingestion is not part of this decision.

## 2026-07-13: Upload Knowledge Files Directly And Track Server Work

Decision: Knowledge Sources sends FILE bytes from the browser directly to the exact API URL issued by the upload intent, then moves finalization into the existing persisted job tracker.

Context: Routing file bytes through Next would add an unnecessary buffering and credential boundary. Client-generated progress would also misrepresent scanning and ingestion that continue on the server.

Consequences:

- The client accepts only the issued same-origin FILE upload path, method, authorization, MIME, and exact byte policy; the native request omits ambient credentials.
- The UI reports discrete preparing, uploading, scanning, and processing states without percentages. Durable job status remains server-authoritative and survives navigation.
- Retryable scanner failures repeat finalization against the uploaded intent. Expired, consumed, ambiguous, or rejected uploads request a new one-time intent while retaining the selected local file.
- TXT/CSV limits and PDF unavailability are visible before selection in every supported locale; PUBLIC is the default classification and audience.

## 2026-07-13: Trust Only Server-Resolved Evidence For Operational Answers

Decision: Operational current-state questions fail closed unless every material claim is supported by a fresh live-tool execution resolved from a trusted server ledger. Callers provide only opaque execution IDs, never result payloads.

Context: Static corpus text and caller-supplied tool results could otherwise answer availability, booking, inventory, order, or account questions without proving current state, authorization, or provenance. Multilingual and legacy paths must follow the same rule.

Consequences:

- One EN/RU/ES/FR/DE/PT classifier governs structured retrieval, legacy handoff, worker intent, grounding, commit revalidation, and delivery revalidation.
- Accepted evidence is bound to tenant, canonical query, operational category, execution context, authorization scope and decision, permission and connector generations, typed value/content hashes, tool policy, and a maximum five-minute lifetime.
- Every material operational claim must cite exact `LIVE_TOOL` support; unrelated live evidence cannot unlock static claims.
- Superseded by the later immutable-live-evidence decision above: the ledger, gateway, and resolver are implemented, while production remains handoff-only until inbound customer identity and approved `CUSTOMER_PERSONAL` processor policies are available.

## 2026-07-13: Terminalize Known Publication Evaluation Failures Immediately

Decision: A publication whose critical evaluation is already `FAILED` becomes terminal immediately, even when its activation outbox delivery is deferred.

Context: Waiting for a future outbox attempt left a known-ineligible publication pending and made the publication contract depend on queue timing.

Consequences:

- The dispatcher records the stable `KNOWLEDGE_PUBLICATION_CRITICAL_EVALUATION_REQUIRED` terminal failure without claiming a deferred activation.
- Activation remains impossible and deterministic evaluation/publication tests do not depend on an outbox retry window.

## 2026-07-13: Bind Processor Queries To A Revalidated Admission

Decision: Every structured external query boundary uses one versioned, content-free admission. Retrieval, generation, commit, and delivery bind and rederive the same decision; a mismatch or policy change fails closed.

Context: Verified Telegram identity makes scoped customer-personal reads possible, but the raw inbound question previously reached embedding, reranking, and grounded generation without a shared minimization contract. Persisted delivery also revalidated against the latest conversation message instead of the exact trigger.

Consequences:

- Credentials and `SECRET` queries are blocked. PUBLIC/INTERNAL queries containing personal identifiers are denied instead of silently downgraded.
- CUSTOMER_PERSONAL and SENSITIVE queries retain their classification. Operational questions use identifier-free canonical templates; safe static questions pass through, and detected email, phone, UUID, labeled reference, and long numeric identifiers become typed placeholders only when useful text remains.
- The evidence bundle and retrieval filters store only version, decision/mode, original and processor hashes, and the admission hash. Raw and processor text are excluded.
- Embedding, sparse encoding, reranking, grounded generation, precommit, and persisted delivery use or rederive the admitted processor query. Retrieval processor policy version/hash drift or revocation invalidates delivery.
- The worker becomes AUTHENTICATED_CUSTOMER only with the exact verified Telegram identity reference. Otherwise its audience and query classification remain PUBLIC.
- Structured delivery loads the exact tenant/conversation CUSTOMER inbound `triggerMessageId`, binds it to the AI run, and revalidates that text even when a newer inbound exists.
- At this point raw text still existed in the AI queue/outbox payload. The later exact-inbound hydration decision removes it from new jobs; legacy queue cleanup, tenant-keyed query HMACs, server-owned processor approval/consent, destination-bound output DLP, and restricted-artifact retention GC remain required.

## 2026-07-13: Hydrate AI Reply Content From The Exact Inbound Reference

Decision: Raw inbound text and rehydratable business context exist only in the producer request and PostgreSQL message relation. Durable `ai.reply` outbox and BullMQ jobs carry an exact message reference plus opaque routing, identity, actor, and RuntimeOutbox metadata.

Context: The previous queue contract copied customer text, tenant name, lead state, and receipt data into RuntimeOutbox and Redis. That expanded retention and allowed queue values to drift from the authoritative inbound row.

Consequences:

- Queue creation locks the exact tenant/conversation INBOUND message, compares producer text, derives any authenticated-customer identity from that relation, and explicitly projects the persisted job.
- Generic RuntimeOutbox creation and parsing enforce the same exact content-free `ai.reply` envelope. Alternate fields, legacy `text`, malformed identity attachments, and mismatched event metadata fail before persistence or publication.
- The worker accepts only RuntimeOutbox-backed jobs, verifies the signed-by-storage envelope through RuntimeInbox, locks and hydrates the exact input, and uses that transaction snapshot for the graph.
- Recovery cannot create a run for an inbound that already has a newer message. Commit fencing rechecks the run input hash and exact inbound text hash, so post-hydration edits cancel the reply.
- Existing content-bearing RuntimeOutbox rows and Redis jobs are intentionally incompatible. They must be drained or scrubbed before deploying this worker; mixed old/new rolling deployment is not supported.
- Tenant-keyed query HMACs, server-owned processor approval/consent, destination-bound output DLP, and retention garbage collection remain separate production privacy work.

## 2026-07-14: Separate Channel Connection From Automatic Replies

Decision: A connected channel receives and persists inbound messages but cannot generate automatic replies until an owner or admin explicitly activates it against the current structured knowledge publication and current channel fingerprint.

Context: Treating a successful Telegram/webhook/widget connection as AI authorization allowed seeded defaults or later configuration drift to start replies without proving that the channel and knowledge snapshot were still ready.

Consequences:

- Existing and new channels default to automatic replies disabled; the migration also fences active conversations, reply runs, and queued reply outbox work.
- Activation stores the exact tenant publication id/etag and a fingerprint that includes channel routing/settings plus a digest of encrypted credentials, never the secret itself.
- Admission is rechecked at intake, queue creation, worker retry, and immediately before AI delivery. Channel changes, publication changes, closure, handoff, or deactivation fail closed.
- Final delivery admission and the bounded provider call share the transaction that holds conversation, channel, publication, capability, and permission transition locks. A human action or revocation that commits first prevents the send; a send that acquires the locks first completes before the conflicting transition.
- Inbound message persistence and manual `USER` delivery remain independent, so disconnecting automation does not hide customer messages or prevent an agent response.
- Settings exposes readiness and explicit activation only for supported Website, Telegram, and Webhook/API channels. Server-owned scenario capability requirements and exact published/runtime bindings now participate in readiness.

## 2026-07-14: Keep Review Decisions Nonterminal Until Their Effects Commit

Decision: Accepting a Knowledge v2 review or conflict decision moves it to `IN_REVIEW`. Only the decision worker may write its terminal status, in the same transaction that completes the durable decision records and any exact pinned linked reviews.

Context: Terminalizing a review or conflict before its selected successor existed removed publication blockers during the asynchronous execution window. Failed or unsupported work could therefore leave a publishable draft without the approved effect.

Consequences:

- Publication remains blocked during execution, retry, stale-target failure, and dead-letter handling.
- A committed downstream effect is reconciled idempotently before terminal settlement; settlement failure cannot publish the outbox or partially close linked reviews.
- Conflict settlement pins the exact active linked review IDs and generations. Concurrent additions or changes fail closed.
- `MERGE` and `SPLIT_SCOPE` are persisted historical enum values only. The API request contract and UI do not expose them, and direct service calls reject them before creating a job or outbox event.

## 2026-07-15: Bind Runtime Capability Authority To Operational Generations

Decision: Capability readiness and automatic-reply authorization bind the exact server-owned tool registry, supported executor set, tenant permission generation, relevant provider capabilities, publication generation, and channel generation. Every runtime boundary fails closed when that binding changes.

Context: A publication-level capability decision was insufficient when tool availability, connector permissions, or channel state could change after validation. Volatile observation timestamps and unrelated providers also must not revoke otherwise identical authority.

Consequences:

- Publication and channel activation persist stable operational dependency and binding hashes derived only from supported executors and their relevant providers.
- Capability changes, permission-generation changes, publication changes, and channel changes serialize through the same transition locks and fence queued/running replies.
- Planning and execution share one autonomy policy. The product exposes only `ANSWER_ONLY`, `COLLECT_INFORMATION`, and `PROPOSE_ACTION`; state-changing tools remain denied until server-owned confirmation or autonomous-action proof exists.
- Production reply mode is queue-only, removing the synchronous delivery path from valid configuration.

## 2026-07-15: Persist Reply Disposition Before Delivery

Decision: Every successful publication-bound AI reply run records an immutable disposition and content hash before delivery. Handoffs also record the exact versioned localized server template.

Context: Delivery could not safely infer whether content was an automatic grounded answer or a fail-closed handoff from mutable message metadata or capability classification alone. Human takeover and authorization revocation also needed a final external-effect fence.

Consequences:

- `AUTO_SEND` delivery requires the exact persisted content plus the complete grounded-answer audit.
- `HANDOFF` delivery may bypass grounding only when the run's immutable disposition, content hash, and server template all match.
- Final authorization revalidation and the bounded provider send occur in one transaction while publication, capability, channel, conversation, and permission transition locks are held.
- Human send, assignment, status change, or handoff atomically supersedes active runs, dead-letters pending reply outboxes, and advances the conversation AI fence before committing the human action.

## 2026-07-15: Expose Generic Webhook Secrets Only Once

Decision: Telegram and generic webhook secrets are server-managed and removed by one shared channel-settings projection. A generic webhook secret is exposed only as `oneTimeSecret` when its channel is created or when an OWNER/ADMIN explicitly rotates it.

Context: Channel lists and conversation details previously returned stored settings directly, exposing inbound authentication material to every workspace role. Shallow settings updates could also erase hidden nested secrets, while secretless generic webhooks authenticated successfully.

Consequences:

- Channel lists, channel mutations, conversation previews/details, and integration fallbacks never return stored Telegram or webhook secrets.
- Generic webhook intake rejects missing stored secrets and accepts credentials only through supported headers, never query parameters.
- Generic channel updates cannot rotate secrets implicitly. Partial updates preserve valid secrets and repair malformed state; explicit rotation is audited and disables stale automatic-reply authorization.
- Operators must capture the creation or rotation value immediately. Later reads expose only `secretConfigured`; provisioning rotates explicitly when no known operator-supplied secret is available.

## 2026-07-15: Keep User Credentials Outside Workspace Administration

Decision: Workspace team administration can manage memberships only. OWNER and ADMIN may invite, change roles, and remove members, but ADMIN cannot grant or manage OWNER, and no workspace role can generate or replace another user's global password.

Context: A membership-scoped password-reset endpoint changed the shared `User.passwordHash`, returned the temporary credential to a workspace member, and revoked sessions only in that workspace. Together with unrestricted team mutations and invite upserts, this allowed privilege escalation and cross-workspace account takeover.

Consequences:

- Team mutations reauthorize the current actor from the database inside a workspace-locked transaction; controller metadata is defense in depth.
- Role checks, final-owner checks, membership changes, and audit writes commit atomically. Concurrent owner changes cannot remove the final owner.
- ADMIN cannot invite, promote, demote, or remove OWNER. Reinviting an existing member is rejected instead of changing their role.
- Inviting an existing global user adds only the membership and does not update their name, password, or other profile data.
- The team temporary-password API, product UI, demo handler, API client type, and localized copy are removed. Users recover credentials through self-service password reset.
- Password-reset confirmation conditionally consumes the exact unexpired token before changing credentials, so concurrent reuse has one winner.

## 2026-07-15: Test Telegram Through the Real Bot Chat

Decision: Customer-facing Telegram verification opens the connected bot with a `/start` deep link. The synthetic inbound generator remains an internal QA boundary and is not shown as a Telegram delivery test.

Context: The synthetic action called the inbound service directly, so it could succeed while bypassing Telegram, the public webhook, TLS, and the relay. This made an internal processing fixture look like end-to-end proof.

Consequences:

- Connected customers are sent to the exact bot chat to produce a real Telegram update.
- After a successful connection, the dialog remains on the verified bot identity, clears the submitted token, and makes the real chat the primary next action.
- Telegram menus no longer offer the synthetic sample action.
- Connection health still validates bot identity, webhook registration, allowed updates, backlog, and delivery errors without inventing inbound traffic.
- Automated tests may keep using the internal sample endpoint for deterministic processing coverage, but it is not evidence that Telegram delivered a message.

## 2026-07-15: Channel Adapters Fail Closed Without A Provider

Decision: Production channel adapters may report `queued` or `sent` only after a real provider contract accepts the operation. Missing credentials, unimplemented channels, and internal samples cannot use a synthetic adapter result.

Context: The shared stub adapter generated message IDs and `queued` results without contacting a provider. Telegram inherited that behavior when credentials were missing or sample metadata was present, and the worker exempted `demo-*` channel keys from credential checks. A queued message could therefore be committed as delivered even though Telegram was never called.

Consequences:

- Telegram rejects missing bot credentials, and an absent webhook secret never verifies.
- The delivery worker decrypts and validates credentials before creating or starting the provider operation. Missing or invalid credentials mark the message failed without invoking an adapter.
- Public-key naming is not a security or capability signal; `demo-*` channels receive no production bypass.
- Website and Email adapter placeholders reject unsupported runtime calls. Deterministic tests must inject explicit fake adapters at their test boundary.

## 2026-07-15: Expose CRM Providers Only After Live Implementations Exist

Decision: amoCRM, Bitrix24, and RetailCRM remain visible as unavailable catalog entries, but no customer or internal product boundary may configure, connect, test, disconnect, or synchronize through them until a real provider implementation is shipped.

Context: The previous CRM adapters generated synthetic external IDs and demo URLs. Connect and test actions persisted `CONNECTED`, successful logs, timestamps, and usage without contacting a provider, so the product reported external effects that never occurred.

Consequences:

- Every CRM mutation, test, sample, and lead-sync boundary returns HTTP `501` with stable code `INTEGRATION_NOT_AVAILABLE` before database or provider access.
- Existing CRM rows are retained for audit/recovery but API responses project them as `COMING_SOON`, clear operational timestamps and synthetic logs, and expose only unavailable metadata.
- The production UI has no CRM credential, connect, test, or disconnect controls. It shows non-editable planning requirements and a clear unavailable explanation.
- Synthetic CRM adapter exports are removed. Re-enabling a provider requires a live adapter, authoritative connection verification, provider-backed sync tests, and an explicit catalog capability change.
- Telegram and Webhook/API behavior is unchanged.

## 2026-07-15: Deliver Generic Webhooks Only To Explicit Pinned Targets

Decision: Generic Webhook/API outbound messages are sent only when the channel has an explicit `settings.webhook.outbound.targetUrl` that passes the public HTTPS policy. The adapter may never synthesize a queued or sent provider result.

Context: `WebhookAdapter` inherited the stub sender, so manual and AI replies appeared delivered without a destination or HTTP request. The same channel settings also contain inbound secrets and raw webhook metadata, which cannot be copied into outbound requests or API responses.

Consequences:

- Outbound targets require HTTPS on port 443, no URL credentials or fragments, an allowed public hostname, and DNS answers that are all public. The transport connects to a verified address, preserves TLS hostname verification, and rejects remote-address drift and redirects.
- The versioned outbound body contains only routing identifiers, reply text, and bounded attachments. Raw inbound payloads, stored settings, and credentials are excluded.
- Every request carries a stable delivery/idempotency key. Retryable webhook delivery is at-least-once, so receivers must deduplicate by that key. Optional authentication is a validated `Authorization` or `X-*` header whose secret is moved into the AES-GCM channel credential field and removed from stored settings/projections; target paths and queries are also hidden behind configured-state booleans.
- Missing/invalid configuration and terminal HTTP rejection settle as failed without synthetic success. DNS/connect failures and `408`/`425`/`429`/selected `5xx` responses retry within the queue attempt budget; a post-send timeout or transport failure becomes `UNKNOWN` and is not sent again automatically.
- Response headers and bodies are bounded. A `2xx` remains successful even when its response body is oversized or not JSON; LeadVirt uses the stable fallback provider id instead of reversing an accepted delivery.
- Manual Webhook/API sends validate the local contract before creating a message/outbox event, and automatic-reply readiness requires the same contract. Customer-facing target configuration UI remains follow-up work.

## 2026-07-15: Separate Runtime Liveness From Dependency Readiness

Decision: Redis URLs are parsed once through the shared config/runtime-queue boundary, and process liveness is separate from dependency-backed readiness. The API requires PostgreSQL and Redis; a processor-enabled worker requires the same two dependencies.

Context: Production consumers independently parsed `REDIS_URL`, several defaulted a missing port to the local host mapping `6380`, and some ignored `rediss://` TLS or the database path. API readiness reported only that environment variables existed, while worker health could remain positive after a dependency outage. Redis documents `6379` as its default port and `rediss://` as the TLS URI scheme; TLS deployments that use `6380` or another provider port must state it explicitly.

Consequences:

- Both Redis schemes default to `6379`; explicit ports, ACL credentials, database indices, IPv6 hosts, and TLS intent are preserved consistently for BullMQ.
- `GET /health` is a no-store liveness check. `GET /health/ready` returns `503` unless the required PostgreSQL and Redis probes succeed, without returning URLs, credentials, or failure details.
- Worker readiness permits a connected deployment-paused worker but requires both dependencies; processor-disabled workers mark them `not_required`.
- Probes have hard deadlines and single-flight behavior. API results are cached for one second to bound public readiness amplification.
- Docker Compose, CI acceptance, rollback, promotion, and public cutover gates use readiness instead of liveness.

## 2026-07-15: Derive Product Mutation UI From Authenticated Role

Decision: Authenticated product routes expose one shared current-user and permission source derived from `/auth/me`. UI mutation controls mirror the backend role matrix, while routes without authenticated identity default to VIEWER and remain read-only.

Context: The API rejected unauthorized mutations, but the product still displayed controls that could never succeed and fetched the same identity more than once. This made lower-role workflows confusing and created avoidable identity drift between layout and pages.

Consequences:

- VIEWER can inspect product data but cannot mutate it. AGENT can operate leads and conversations.
- MANAGER can manage workflows, account settings, channels, and integration tests. OWNER and ADMIN retain team, secret, integration configuration, and billing controls.
- Navigation and page controls are hidden or disabled before an impossible action is offered, and mutation handlers keep defensive permission checks.
- Backend authorization remains authoritative; frontend permissions are an interaction model, not a security boundary.

## 2026-07-15: Fail Closed For Inactive Tenants

Decision: `TRIALING` and `ACTIVE` tenants may use normal workspace and public channel runtime paths. `SUSPENDED` and `CANCELLED` tenants fail with HTTP `403` and stable code `TENANT_INACTIVE`, based on the current tenant row rather than session-time claims.

Context: Credential sessions remained valid after a tenant became inactive, and Website, Telegram, and generic Webhook/API channel loaders required only a non-deleted tenant. A suspended workspace could therefore keep reading, mutating, and accepting public traffic.

Consequences:

- Inactive sessions retain `/auth/me`, `/me`, `/current-tenant`, logout, locale preference, credential and 2FA security, session revocation, billing reads, payment-method recovery requests, and subscription plan recovery. Billing cancellation and all unrelated workspace routes remain blocked.
- The auth guard reloads the session, membership, user, and tenant on every request before applying the lifecycle policy, so changing status invalidates normal access without rotating the session token.
- Website config/messages, Telegram webhooks, and generic webhook events validate the tenant before authentication parsing, event claims, lead creation, workflows, AI queueing, or other runtime writes. Widget config is unavailable while the tenant is inactive.
- Credential login and self-service password reset remain available because they do not depend on an active workspace session.
- Liveness, readiness, and metrics routes remain outside workspace authorization.

## 2026-07-15: Keep Tenant API Keys Inert Until A Machine API Exists

Decision: LeadVirt does not mint or authenticate tenant API keys until an explicit versioned external API, machine principal, and scope contract exist. Existing rows are retained only as inert history that OWNER or ADMIN may inspect and revoke.

Context: Settings generated hashed secrets and stored arbitrary scopes, but no request guard or endpoint consumed them. The product therefore created credentials that could not work. Retrofitting them into `WorkspaceAuthGuard` would also expose user-oriented workspace routes without a valid user or role principal and could activate old keys created under weaker authorization.

Consequences:

- Authorized creation fails before database or random-secret access with HTTP `501`, stable code `API_KEYS_NOT_AVAILABLE`, and non-retryable capability metadata.
- Billing no longer lists dormant key rows. A separate cleanup read and revoke boundary is restricted to OWNER/ADMIN; revocation reloads the actor membership inside a tenant-locked transaction and writes an audit record without hash, scopes, or secret material.
- Legacy rows remain tenant-isolated and are marked `INERT`/cleanup-only in reads. Revocation retains the row as history rather than deleting it.
- The production seed no longer inserts an unusable demo key.
- Settings states plainly that API-key authentication is unavailable. OWNER/ADMIN may remove inert history, while creation, secret-copy, usage, integration-impact, and non-admin navigation claims are absent; demo mode follows the same contract.
- A future machine API must use dedicated versioned routes and a separate API-key principal/scope guard. It must revoke legacy rows and require deliberate reissuance instead of silently activating them through `WorkspaceAuthGuard`.

## 2026-07-15: Keep Product Read Failures Distinct From Empty Data

Decision: Product pages track loading, successful data, transport failure, and domain not-found as separate states. A failed initial request exposes retry instead of rendering zero, empty, template, disconnected, or not-found content; a failed refresh keeps the last successful data visible.

Context: Automation, Pipeline, Conversation, and Integrations converted rejected requests into empty arrays or `null`. Operators could not distinguish a real empty workspace or missing conversation from an unavailable API, and periodic or post-connect refreshes could erase usable state.

Consequences:

- Automation workflows and archives, Pipeline summaries, and both Integrations resources render explicit retryable errors until a successful response establishes data.
- Conversation renders not-found only for an actual HTTP `404`; network and `5xx` failures remain retryable errors.
- Pipeline conversation-ID enrichment, locale changes, conversation polling, and post-connect channel refreshes retain the last successful data when their refresh request fails.
- Settings tabs expose loading and retry before rendering account, team, security, or notification controls. Billing loads its required plan, subscription, usage, payment, and invoice snapshot atomically and never substitutes copied prices, dates, quotas, plans, or subscriptions.
- A successful empty billing response remains a real no-subscription/no-plan state. Later refresh failures keep the last successful snapshot visible with an explicit retry.
- Dashboard, Analytics, and AI audit hide metrics until their first successful response. Missing comparison deltas and per-event measurements remain absent rather than becoming zero, while Analytics keeps each retained snapshot bound to its successful period.
- Inbox and Onboarding do not present zero conversations or a fresh first step before hydration succeeds. Product-shell activity is shown as recent activity without invented unread counts because the API has no read-state contract.
- Focused Playwright coverage verifies failure, retry, empty/not-found separation, retained refresh data, and the rendered outage states.

## 2026-07-15: Present The Live Webhook Without API-Key Claims

Decision: The `WEBHOOK_API` provider is presented to customers as an inbound Webhook integration. Integrations does not advertise API keys or link to API-key settings while tenant API keys remain inert.

Context: The same integration surface exposed a real signed webhook endpoint and an unrelated “Open API keys” action. No request authenticates with tenant API keys, so combining them implied a machine API capability that does not exist.

Consequences:

- Webhook endpoint URL, public key, secret header, sample payload, configuration, and internal processing sample remain available.
- Customer-facing card, readiness, modal, status, and section copy refer only to Webhook.
- Reintroducing API-key navigation requires the separate versioned machine API and principal/scope contract recorded above.

## 2026-07-15: Serialize Tenant Settings JSON Updates

Decision: Every partial write to tenant-owned Settings JSON must lock the tenant row, reload the current JSON inside the same transaction, merge only the requested fields, and commit the mutation with its audit record.

Context: Account profile and notification preferences share `Tenant.settings`. Independent read-modify-write calls could start from stale JSON and erase each other's fields or unrelated settings. Profile values also include private contact data that should not be copied into audit payloads.

Consequences:

- Account and notification updates serialize on the tenant row and preserve unknown top-level, profile, and notification fields.
- Account reads project the current tenant row instead of session-time tenant claims.
- Account audits record only which private profile fields changed; they do not store the submitted description, phone, website, or logo value.
- Future writers to `Tenant.settings` must use the same locked merge boundary rather than a detached root-client read followed by a whole-object overwrite.

## 2026-07-15: Never Adopt An Existing Identity During Credentials Signup

Decision: Public credentials signup may create only a new globally unique User. It never assigns a password to, resurrects, or adds a workspace for an existing identity.

Context: Team invitations create passwordless users with immediate memberships. The old signup path reused those users, assigned the submitted password, and retained their memberships, allowing an unverified caller to claim an invited account.

Consequences:

- User creation is the first signup transaction write and uses PostgreSQL uniqueness as the atomic concurrency decision.
- A duplicate email or phone returns conflict with no profile, password, session, membership, audit, onboarding, or workspace side effect, including for deleted users.
- Deliberate identity linking remains limited to a separately verified recovery or email-code path. Production credentials signup stays disabled until unused-email ownership is also proven.

## 2026-07-15: Isolate Public And Candidate Deployment Processes

Decision: Only secret-bearing runtime services receive the production env file. Release-candidate app containers share dependency networking without claiming canonical service aliases, and certificate/env mutations serialize with deployment state.

Context: The public Next container inherited the full secrets file through a shared Compose anchor. Candidate API/Web preflights also used live `api` and `web` aliases before migration commit, while certificate renewal could reload nginx during a deployment and HTTPS setup rewrote the secrets file in place.

Consequences:

- Migration, API, and worker containers receive the secret env file; Web receives only explicit public build/runtime configuration.
- Preflight API, worker, and Web containers remain reachable through `docker exec` but cannot enter live nginx service discovery.
- Certificate renewal waits on the same host deployment lock used by releases.
- HTTPS env changes write a mode-`0600` temporary file, fsync it, atomically replace the target, and fsync the parent directory.

## 2026-07-15: Hold The Channel Fence Across Provider Delivery

Decision: Outbound delivery locks the current Conversation and Channel in that order, reloads current routing and credentials, revalidates all delivery fences, and holds those locks until the provider attempt returns.

Context: The worker loaded Channel before its final Conversation lock. If disconnect committed first, the worker could acquire the Conversation lock afterward and send with the stale active Channel snapshot. Disconnect already used Conversation-then-Channel ordering, so the missing current-state reload was the unsafe gap.

Consequences:

- A disconnect, route change, provider-account change, settings change, credential rotation, deletion, or type change that commits first reconciles the claimed operation as skipped without provider access.
- A provider call that owns the locks finishes before disconnect can commit; it cannot appear after a successful disconnect response.
- The delivery operation retains one-provider-attempt semantics, and unknown provider outcomes remain non-retryable without reconciliation.

## 2026-07-15: Admit Generic Webhook AI Work Once

Decision: Generic webhook inbound persistence and AI outbox admission occur in one database transaction. The committed outbox id is dispatched after commit and is the only queue truth used for the response.

Context: The inbound transaction created an AI outbox event, then the handler called queue admission again. Dedupe rejected the second creation, so the API and audit reported `skipped` while durable work was actually queued.

Consequences:

- Accepted admission reports `queued` using the deterministic job id; policy rejection alone reports `skipped` with its reason in the audit.
- Redis failure or a process crash after commit does not change the accepted result; periodic outbox drain recovers the event.
- Webhook retries reuse the existing dedupe-bound outbox and never re-run admission for already accepted work.
- The queued lead activity record commits with the inbound message and outbox event.

## 2026-07-15: Scope Conversation Async State By Route Generation

Decision: Every Conversation request and mutation captures the conversation id plus a monotonically increasing route generation. State updates, rollback, toasts, and pending cleanup apply only while that scope remains current.

Context: A delayed send or AI draft from one chat could resolve after navigation and restore its text, attachments, messages, or pending flags into another customer conversation. An old mutation count could also block the new chat load.

Consequences:

- Route changes invalidate old loads, sends, drafts, attachment reads, conversation actions, lead actions, and polling, including an A-to-B-to-A navigation sequence.
- Old completions cannot decrement or clear the new conversation's pending state.
- Locale/effect refreshes no longer clear pending attachments when the conversation id is unchanged.

## 2026-07-15: Keep Browser Auth State Cookie-Only

Decision: The HttpOnly session cookie and `/auth/me` are the browser authentication authority. Auth completion removes any legacy `leadvirt.auth.session` localStorage value and does not persist identity data there.

Context: Login stored email, phone, name, tenant, role, auth mode, and expiry in localStorage, but no application path read it. This unnecessarily exposed durable personal data to same-origin scripts. The email-OTP config request also collapsed network failure into a confirmed disabled state and silently switched methods.

Consequences:

- Successful email and Telegram auth leave no identity/session payload in localStorage; logout still removes legacy values.
- Email-OTP configuration now has loading, enabled, disabled, and retryable error states.
- A transient config failure keeps Email selected, presents retry, and never claims that the server disabled the method.

## 2026-07-18: Keep Demo Evidence And Setup Promises Internally Consistent

Decision: The read-only demo represents one complete supported Telegram and website-widget workspace. Inbox filters come from loaded conversations, and assisted or planned onboarding choices are saved only as preferences unless a separate request API succeeds.

Context: The demo advertised unsupported channel and CRM states, its readiness journey could not verify the sample knowledge or inbound delivery, and onboarding copy implied that selecting a future channel sent an operator request when it only persisted a choice.

Consequences:

- Demo knowledge, automatic replies, connected channels, and successful inbound evidence agree on one published sample state.
- Mobile and desktop Inbox filters cannot imply channels or lead states absent from the loaded workspace.
- Assisted setup remains visible without claiming that LeadVirt has received a request.
- Demo-only connection actions lead to account creation instead of looking like enabled controls that silently do nothing.

## 2026-07-18: Keep Localized Product Controls Explicit And Test The Rendered UI

Decision: Customer-facing integration fields and Operations Suite copy use typed locale keys with complete catalogs. Localization acceptance checks both catalog parity and rendered dialogs, while dense mobile controls expose accessible names, 44px actions, and visible overflow cues.

Context: Catalog-only checks passed even though integration setup fields still rendered raw English labels. Several demo controls were technically present but hard to discover or operate on narrow screens and with a keyboard.

Consequences:

- New integration setup fields require a translation key instead of a raw label.
- Operations Suite catalogs fail typecheck when a supported locale misses a key.
- Charts expose localized data summaries, demo read-only surfaces explain their state, and horizontally scrollable workflows and pipelines visibly signal additional content.

## 2026-07-18: Prioritize Outcomes And Reachable Actions On Narrow Screens

Decision: Mobile product views show business outcomes before setup detail, keep secondary journeys collapsed until requested, and reserve at least 44px for every primary navigation or recovery action.

Context: At 320-390px, readiness detail displaced dashboard metrics, onboarding and integration actions could sit behind fixed navigation or safe areas, clipped Inbox filters lacked a reliable cue, and compact public/auth controls were difficult to tap.

Consequences:

- Dashboard metrics precede the readiness journey on mobile while desktop ordering remains unchanged.
- Readiness steps stay collapsed behind an explicit control; the current primary action remains visible.
- Horizontal filter rows expose a measured scroll action, and fixed mobile navigation is included in CTA scroll spacing.
- Demo onboarding can return to its first step without creating a new session, and narrow Knowledge views expose one localized title.

## 2026-07-18: Preserve Mobile Context Without Fabricating Product State

Decision: Narrow product views use explicit selectors or responsive records when desktop navigation and tables cannot remain fully reachable. Read-only demo surfaces tolerate absent authenticated identity, preserve intentional reader scroll, and omit unsupported empty insight sections.

Context: Mobile Knowledge hid the active deep-linked view in an overflowed tab strip, Pipeline List clipped several columns, conversation replay either forced the reader to the end or placed the final reply under fixed navigation, and demo Team crashed because it required a real current user. Analytics also rendered a large empty recommendations card, while public signup did not distinguish Telegram identity authentication from later business-channel setup.

Consequences:

- Knowledge uses a localized mobile selector while retaining desktop tabs and URL-backed browser history.
- Pipeline uses complete mobile lead cards and keeps the dense desktop table keyboard-operable.
- Demo permissions continue to default to read-only instead of receiving a fabricated user context.
- Conversation auto-scroll follows only readers already near the live end and reserves mobile navigation clearance.
- Analytics recommendations mount only for measured insight codes; signup explains Telegram's authentication role, and pricing actions retain 44px targets.

## 2026-07-18: Localize Demo Fixtures Without Overriding Tenant Content

Decision: Explicit demo routes may localize known seeded business, channel, and widget values using the selected product locale. Production widgets continue to use tenant configuration and locale, and arbitrary customer-authored content is never translated implicitly.

Context: The demo Settings and website-widget flows mixed Russian seed values into otherwise localized EN/DE/ES/FR/PT interfaces. Applying the same override to live widgets would silently replace tenant-controlled language and content.

Consequences:

- `/widget/demo` passes an explicit demo locale and translates only recognized demo fixtures.
- Live widget frames preserve the tenant's configured locale, title, greeting, replies, and consent copy.
- Unknown customer messages and tenant-authored values remain byte-for-byte content, while shared widget chrome follows the resolved widget locale.
- Regression coverage exercises all six supported demo locales and separately protects the live tenant boundary.
