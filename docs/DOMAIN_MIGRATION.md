# LeadVirt.com Domain Migration

Status on 2026-07-10: complete and live at `https://leadvirt.com`. Apex and `www` resolve to `193.187.92.88`, Let's Encrypt TLS is active, and Telegram OAuth opens with the `.com` origin. The former `.ru` origin is retired without redirects or API compatibility.

## 1. DNS

In Beget DNS, replace the current A records with:

```text
leadvirt.com      A  193.187.92.88
www.leadvirt.com  A  193.187.92.88
```

Wait until both names return the VPS IP from public resolvers.

## 2. Deploy

Run `.github/workflows/deploy-leadvirt-com.yml` after DNS propagation. Before changing the active release, it:

1. verifies DNS and HTTP ACME routing;
2. issues the `.com` certificate;
3. updates public URL/CORS values in the server env;
4. validates the candidate nginx configuration.

The equivalent manual command from a release containing the migration files is:

```bash
cd /opt/leadvirt/current
sh deploy/enable-leadvirt-com-https.sh
```

## 3. External Services

- BotFather `/setdomain` is set to `leadvirt.com` for `@LeadVirtAi_bot`.
- Master Budet sends its LeadVirt webhook traffic to `leadvirt.com`.
- The production database contains no stored `.ru` URLs, and the login bot has no Telegram webhook.
- Delete the former domain's apex and `www` DNS records in Beget; there is no compatibility window.

## 4. Verify

```bash
curl -fsS https://leadvirt.com/health
curl -sS -o /dev/null -w '%{http_code}\n' https://leadvirt.com/api/auth/me
curl -sSI https://www.leadvirt.com/
```

Expected: `.com` health `200`, auth `401`, and `www` redirects `308` to the `.com` apex. Then run `qa:pilot:public` against `.com`, smoke email OTP, and verify the website widget plus the managed Telegram business channel independently.
