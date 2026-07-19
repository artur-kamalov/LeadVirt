# Email Authentication

LeadVirt uses passwordless email authentication for the public login and signup UI, plus provider-delivered password recovery for credential accounts.

## Current Product Contract

- `/login` and `/signup` expose email OTP only. An unavailable email provider produces a retryable error and never falls back to Telegram account authentication.
- Telegram account authentication is a legacy server capability. It is disabled by default and requires explicit server-side enablement; it is not offered in the public UI.
- Existing sessions with `authMode: "telegram"` remain recognizable during the migration window. This compatibility does not permit creating a new Telegram-authenticated session while the capability is disabled.
- Telegram bot integrations for customer conversations are a separate product boundary. Bot connection, webhook ingress, Inbox delivery, and outbound replies are unchanged.
- The 2026-07-19 production predeploy inventory found 2 legacy Telegram-authenticated users and 21 sessions. Each user needs a verified deliverable email mapping or explicit retirement, and the sessions need an explicit revoke-or-expire decision before legacy compatibility can be removed.

## Flow

- `GET /api/auth/email-otp/config` reports availability and resend timing.
- `POST /api/auth/email-otp/request` creates a 6-digit, 10-minute challenge and sends it through the configured provider.
- `POST /api/auth/email-otp/verify` consumes the challenge once, creates or resolves the workspace, and sets the normal HTTP-only session cookie.
- New verified emails create a trial workspace; existing emails open their first active workspace.

Codes are HMAC-hashed with `AUTH_EMAIL_OTP_PEPPER`, limited to five verification attempts, invalidated after use, and never logged. Requests have per-IP/email limits plus a database-backed 60-second resend lock.

Production requires `AUTH_EMAIL_OTP_ENABLED=true`; provider credentials alone do not enable the feature.

## Beget SMTP

Beget SMTP is the active production path while the new domain is not eligible for UniSender sender verification.

```dotenv
AUTH_EMAIL_OTP_ENABLED=true
AUTH_EMAIL_OTP_PEPPER=<at-least-32-random-characters>
EMAIL_OTP_PROVIDER=smtp
EMAIL_PROVIDER=smtp
EMAIL_FROM=LeadVirt.ai <noreply@leadvirt.com>
SMTP_HOST=smtp.beget.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@leadvirt.com
SMTP_PASSWORD=<mailbox-password>
SMTP_FROM_NAME=LeadVirt.ai
SMTP_FROM_EMAIL=noreply@leadvirt.com
```

Store the mailbox password only in `/opt/leadvirt/secrets/.env`. Port `465` uses TLS from connection start. Run a transport authentication check and a real inbox OTP smoke before exposing the email option.

## UniSender

The classic UniSender `sendEmail` API remains supported as a later fallback. It requires a verified sender email and a contact-list ID.

```dotenv
AUTH_EMAIL_OTP_ENABLED=true
AUTH_EMAIL_OTP_PEPPER=<at-least-32-random-characters>
EMAIL_OTP_PROVIDER=unisender
EMAIL_PROVIDER=unisender
EMAIL_FROM=LeadVirt.ai <noreply@leadvirt.com>
UNISENDER_API_KEY=<rotated-key>
UNISENDER_LIST_ID=<authentication-list-id>
UNISENDER_SENDER_NAME=LeadVirt.ai
UNISENDER_SENDER_EMAIL=noreply@leadvirt.com
```

`EMAIL_OTP_PROVIDER` is separate from `EMAIL_PROVIDER`. Both support `smtp`, `unisender`, and non-production `mock`; production password reset rejects `mock`, `manual`, unsupported providers, and incomplete provider configuration before creating a usable token.

## Password Reset

- `POST /api/auth/password-reset/request` requires credential auth to be enabled and a ready SMTP or UniSender provider in production.
- Reset tokens are stored only as hashes and staged as unusable while delivery is pending.
- Provider acceptance can activate the token only while the captured password hash is still current. Activation, confirmation, and authenticated password changes share one PostgreSQL lock, so an in-flight delivery cannot activate after a completed password change.
- Delivery failure returns the same generic response as an unknown account and leaves the staged token invalid. Delivery is still synchronous, so request duration can differ; durable queued delivery remains required to remove that timing oracle.
- The request audit is attempted after activation. Audit failure is logged without URL/provider details and does not invalidate an already delivered link.
- Production responses and logs never contain the reset URL. Non-production `EMAIL_PROVIDER=mock` retains the reset URL response and log for local QA.
- Requests are limited to one per normalized recipient per minute and eight per hour, with an additional per-IP limit.
- `POST /api/auth/password-reset/confirm` consumes the token once, changes the password, and revokes active sessions.

In production, `APP_URL` and `NEXT_PUBLIC_APP_URL` must resolve to the same public HTTPS origin. Credentials, paths, queries, hashes, localhost, and mismatched hosts are rejected before token creation.

Before enabling production:

1. Update `/opt/leadvirt/secrets/.env` and restart the API service.
2. Verify SMTP authentication without sending a message.
3. Run a real inbox delivery smoke.
4. Confirm one-time code consumption and `/api/auth/me` returns `authMode: "email"`.
5. Re-run the legacy Telegram identity/session inventory and resolve every remaining user and session explicitly.

UniSender enforces at least 60 seconds between emails to one recipient. The classic API also adds recipients to the configured list; move to UniSender Go if authentication volume or transactional-delivery requirements outgrow this API.

## Verification

```powershell
corepack pnpm run qa:auth:smtp-contract
corepack pnpm run qa:auth:unisender-contract
corepack pnpm run qa:auth:email-otp
corepack pnpm run qa:auth:team-security
corepack pnpm run qa:auth:staging-ready
corepack pnpm exec playwright test artifacts/playwright/auth-flow.spec.ts --reporter=line --workers=1
```
