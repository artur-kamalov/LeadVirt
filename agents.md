Use less comments and descriptions in answers

# Agent Working Rules

These rules apply to Codex work in this workspace.

## Local Ports

- Always run LeadVirt web on `localhost:3001`.
- Always run LeadVirt API on `localhost:4001`.
- Use `NEXT_PUBLIC_API_URL=http://localhost:4001/api` when starting the web app locally.
- When starting the API manually, include `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public` and `REDIS_URL=redis://localhost:6380`; Prisma reads `DATABASE_URL` from the process environment at startup.
- Do not use the old LeadVirt defaults `localhost:3000` / `localhost:4000` unless the user explicitly asks for a one-off exception.

## Task Tracking

- Keep an up-to-date checklist in `docs/CHECKLIST.md`.
- Mark completed work immediately after verification.
- Add new tasks when follow-up work is discovered.
- Keep incomplete tasks concrete and actionable.

## Documentation

- After each meaningful task, update relevant documentation.
- If no domain document fits, update `docs/CHECKLIST.md` with status and notes.
- Keep documentation short, practical, and connected to actual implementation.

## Decision Log

- Record architectural, workflow, or product decisions in `docs/DECISION_LOG.md`.
- Each entry should include the date, decision, context, and consequences.
- Prefer recording decisions when they affect future implementation, routing, data flow, UI behavior, dependencies, or testing.

## UI/UX Work

- Treat `apps/web/src/design` as the current production UI source of truth.
- Preserve the design system, animations, Tailwind classes, and component structure unless a fix is necessary for Next.js compatibility.
- Use Playwright screenshots and interaction smoke checks after meaningful UI changes.

## Verification

- For `apps/web`, use these checks when relevant:
  - `corepack pnpm --filter @leadvirt/web typecheck`
  - `corepack pnpm --filter @leadvirt/web lint`
  - `corepack pnpm --filter @leadvirt/web build`
  - `corepack pnpm --filter @leadvirt/types typecheck`
  - `corepack pnpm --filter @leadvirt/api typecheck`
  - `corepack pnpm --filter @leadvirt/api lint`
  - `corepack pnpm --filter @leadvirt/api build`
  - `corepack pnpm run qa:api`
  - `corepack pnpm run qa:ui:smoke`
  - `corepack pnpm exec playwright test artifacts/playwright/dashboard-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/auth-flow.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/onboarding-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/analytics-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/integrations-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/automation-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/settings-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/channels-widget-settings.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/billing-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/widget-api.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/inbox-empty-state.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/inbox-actions.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/conversation-actions.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/conversation-status-actions.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/conversation-ai-draft.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/conversation-events-timeline.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/conversation-export.spec.ts --reporter=line`
  - `corepack pnpm exec playwright test artifacts/playwright/product-layout-identity.spec.ts --reporter=line`
- Restart the Next dev server after production builds if continuing UI QA on `localhost:3001`.
