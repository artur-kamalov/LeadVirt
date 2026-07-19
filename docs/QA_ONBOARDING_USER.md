# Onboarding QA User

The onboarding QA user is created directly in PostgreSQL. It does not add an API route or bypass normal authentication in the application.

Fixed identity:

- Email: `qa.onboarding@leadvirt.test`
- External auth ID: `qa:onboarding:direct-session:v1`
- Tenant slug: `qa-onboarding`
- Role: `OWNER`
- Session lifetime: 7 days

## Commands

Run from the repository root:

```bash
corepack pnpm qa:onboarding:user status
corepack pnpm qa:onboarding:user provision
corepack pnpm qa:onboarding:user reset
corepack pnpm qa:onboarding:user revoke
```

`provision` creates the exact-marked workspace on first use. Later runs preserve all business and operational data, revoke prior QA sessions, and print a new `leadvirt_session` token once.

`reset` is deliberately disabled because direct database cleanup cannot safely replace the product's integration, channel, workflow, and knowledge cleanup operations. `revoke` invalidates all active sessions for the current marked user and tenant.

The script refuses identity, slug, membership, or tenant-marker collisions. It never prints `DATABASE_URL` or its password.

## Production

Production and non-local databases require explicit acknowledgement:

```bash
LEADVIRT_QA_ONBOARDING_ALLOW_PRODUCTION=true corepack pnpm qa:onboarding:user provision
```

Production provisioning follows the same non-destructive contract. Cleanup must use the product's channel, integration, workflow, and knowledge domain operations.

Set the printed token as the `leadvirt_session` cookie for `leadvirt.com`, with path `/`, `Secure`, `HttpOnly`, and `SameSite=Lax`, then open `/onboarding`. The token is not recoverable from the database; run `provision` again to rotate it.
